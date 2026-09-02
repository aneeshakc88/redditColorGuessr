import { reddit, redis } from '@devvit/web/server';
import { NAMECOLOR_CONFIG, mdEscape } from '../../shared/namecolor-core';

// Scoring for "Name This Color" is upvotes on each name's comment, and a webview
// can't cast or read votes. So the score is whatever a periodic sweep last saw:
// one paginated getComments per post picks up every name AND every score in a
// single chain (getCommentById per name would be ~500 calls a post).

// Keyed by comment id everywhere: names are never merged, so "Blue" and "blu"
// are two entries that voters get to choose between.
export type NameEntry = { raw: string; author: string; permalink: string; at: number };

export const ncKeys = {
  post: (p: string) => `namecolor:post:${p}`,
  sticky: (p: string) => `namecolor:sticky:${p}`,
  entries: (p: string) => `namecolor:entries:${p}`,
  byUser: (p: string) => `namecolor:byuser:${p}`,
  votes: (p: string) => `namecolor:votes:${p}`,
  swept: (p: string) => `namecolor:swept:${p}`,
  announce: (p: string) => `namecolor:announce:${p}`,
  banked: (p: string) => `namecolor:banked:${p}`,
  active: 'namecolor:active',
  stats: 'namecolor:stats',
  wins: 'namecolor:wins:alltime',
  hall: 'namecolor:hall',
  hallMeta: 'namecolor:hall-meta',
  playsAlltime: 'namecolor:plays:alltime',
  plays: (date: string) => `namecolor:plays:${date}`,
};

export type NameColorMeta = { hex: string; createdAt: number; creator: string | null; title: string | null };
export type UserStats = { names: number; bestVotes: number; wins: number };

export async function getMeta(rawPostId: string): Promise<NameColorMeta | null> {
  const str = await redis.get(ncKeys.post(rawPostId));
  return str ? (JSON.parse(str) as NameColorMeta) : null;
}

/**
 * Pull current vote counts for every name on a post. Returns false when the post
 * was swept too recently to be worth re-fetching. Age is never a reason to stop:
 * a color from last month still takes names, and this is what counts them.
 */
export async function sweepPost(rawPostId: string, force = false): Promise<boolean> {
  const [meta, sweptStr] = await Promise.all([
    getMeta(rawPostId),
    redis.get(ncKeys.swept(rawPostId)),
  ]);
  if (!meta) return false;

  const last = sweptStr ? Number(sweptStr) : 0;
  if (!force && Date.now() - last < NAMECOLOR_CONFIG.sweepMinIntervalMs) return false;

  const entriesRaw = await redis.hGetAll(ncKeys.entries(rawPostId));

  if (Object.keys(entriesRaw).length > 0) {
    // Names are direct replies to the sticky, so depth 2 reaches every one of
    // them. Going deeper only spends the listing budget on reply threads hanging
    // off names, which is exactly what pushes real names past the limit.
    const comments = await reddit
      .getComments({ postId: `t3_${rawPostId}`, limit: NAMECOLOR_CONFIG.commentFetchLimit, pageSize: 100, depth: 2 })
      .all();
    const listed = new Set<string>(comments.map(c => c.id));

    // A name whose comment is gone (author deleted it, a mod removed it) used to
    // sit on the board forever at its last score, linking to a dead page. Drop
    // it — but forgetting a name is permanent, so a name is only ever dropped on
    // positive evidence, and never on the mere absence of one:
    //
    //  - a full page came back, so the listing is truncated and says nothing
    //    about what is missing from it;
    //  - the listing shows none of the names we know are on this post, which
    //    means the fetch itself told us nothing — it does not mean the whole
    //    board deleted at once. This is the one that matters: without it, a
    //    single empty response from Reddit would erase an entire post's names;
    //  - the name is inside its grace period, where missing usually just means
    //    Reddit has not indexed it yet.
    //
    // Even past all three, only a few go per sweep. See maxDeletesPerSweep.
    const knownListed = Object.keys(entriesRaw).filter(id => listed.has(id)).length;
    if (comments.length < NAMECOLOR_CONFIG.commentFetchLimit && knownListed > 0) {
      const gone = Object.keys(entriesRaw).filter(id =>
        !listed.has(id) &&
        Date.now() - (JSON.parse(entriesRaw[id]!) as NameEntry).at > NAMECOLOR_CONFIG.deleteGraceMs);
      if (gone.length > 0) {
        await dropEntries(rawPostId, entriesRaw, gone.slice(0, NAMECOLOR_CONFIG.maxDeletesPerSweep));
      }
    }

    const seen = comments
      .filter(c => entriesRaw[c.id] !== undefined)
      .map(c => ({ member: c.id, score: c.score }));
    if (seen.length > 0) {
      await redis.zAdd(ncKeys.votes(rawPostId), ...seen);
      await redis.expire(ncKeys.votes(rawPostId), 400 * 24 * 3600);
      await updateHall(rawPostId, meta.hex, entriesRaw, seen);
    }
    // Credit follows the board, at every age. A name that overtakes on day 40
    // takes the "led this color" credit with it.
    await reconcileCredit(rawPostId, entriesRaw);
  }

  await redis.set(ncKeys.swept(rawPostId), String(Date.now()));
  await maybeAnnounce(rawPostId, meta, entriesRaw);
  return true;
}

/** Every name's last-seen score on this post, by comment id. */
async function readVotes(rawPostId: string): Promise<Map<string, number>> {
  const votesKey = ncKeys.votes(rawPostId);
  const size = await redis.zCard(votesKey);
  const votes = new Map<string, number>();
  if (size > 0) {
    for (const e of await redis.zRange(votesKey, 0, size - 1, { by: 'rank' })) votes.set(e.member, e.score);
  }
  return votes;
}

type AnnounceState = { round: number; sig: string | null; ended: boolean };

/** What the board looks like right now, to the vote. Two identical signatures a
 *  round apart mean nobody named anything and nobody voted. */
async function boardSignature(rawPostId: string, entriesRaw: Record<string, string>): Promise<string> {
  const ids = Object.keys(entriesRaw).sort();
  if (ids.length === 0) return '';
  const votes = await readVotes(rawPostId);
  return ids.map(id => `${id}:${votes.get(id) ?? 0}`).join(',');
}

function rankNames(entriesRaw: Record<string, string>, votes: Map<string, number>) {
  return Object.entries(entriesRaw)
    .map(([commentId, str]) => ({ commentId, ...(JSON.parse(str) as NameEntry) }))
    .map(e => ({ ...e, votes: votes.get(e.commentId) ?? 0 }))
    .sort((a, b) => b.votes - a.votes || a.at - b.at);
}

/**
 * The daily checkpoint, for the first few days of a color's life only.
 *
 * Days 1..recapDays each get one standings comment, skipped on a day where the
 * board did not move (an identical list posted twice is noise). After that the
 * app stops posting for good and the post leaves the hourly sweep — it is not
 * closed, and never will be. Names and votes keep being taken; they surface in
 * the app, in the comments, and in the Hall of Fame, and a sweep still runs
 * whenever someone opens the post.
 *
 * The window is counted in days, not in comments posted, so a color that was
 * quiet early doesn't drag a tail of recaps into the following week.
 */
async function maybeAnnounce(
  rawPostId: string,
  meta: NameColorMeta,
  entriesRaw: Record<string, string>,
): Promise<void> {
  const stateStr = await redis.get(ncKeys.announce(rawPostId));
  const state: AnnounceState = stateStr ? (JSON.parse(stateStr) as AnnounceState) : { round: 0, sig: null, ended: false };
  if (state.ended) return;

  const roundMs = NAMECOLOR_CONFIG.roundHours * 3600 * 1000;
  const round = Math.floor((Date.now() - meta.createdAt) / roundMs);
  if (round <= state.round) return;

  const save = (patch: Partial<AnnounceState>) =>
    redis.set(ncKeys.announce(rawPostId), JSON.stringify({ ...state, round, ...patch } satisfies AnnounceState));

  // Past the recap window: bank where it stands, drop off the cron, stay open.
  if (round > NAMECOLOR_CONFIG.recapDays) {
    await endRecaps(rawPostId);
    await save({ ended: true });
    return;
  }

  const sig = await boardSignature(rawPostId, entriesRaw);
  const isLast = round === NAMECOLOR_CONFIG.recapDays;

  // Nothing moved today (or nobody has named it yet) — say nothing, and let the
  // window keep running down.
  if (sig === state.sig || sig === '') {
    if (isLast) {
      await endRecaps(rawPostId);
      await save({ sig, ended: true });
    } else {
      await save({ sig });
    }
    return;
  }

  const stickyId = await redis.get(ncKeys.sticky(rawPostId));
  if (stickyId) {
    try {
      const ranked = rankNames(entriesRaw, await readVotes(rawPostId));
      const leader = ranked[0]!;
      const board = ranked.slice(0, 5)
        .map((r, i) => `${i + 1}. **${mdEscape(r.raw)}** — ${r.votes} · u/${r.author}`)
        .join('  \n');

      await reddit.submitComment({
        id: (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`,
        text: [
          `**Day ${round}: this color is "${mdEscape(leader.raw)}" for now.**`,
          '',
          board,
          '',
          isLast
            ? `^(${ranked.length} ${ranked.length === 1 ? 'name' : 'names'} so far · last daily recap — naming and voting stay open for good, so keep adding names in the post and upvoting the ones you like)`
            : `^(${ranked.length} ${ranked.length === 1 ? 'name' : 'names'} so far · naming and voting never close · daily recaps run to day ${NAMECOLOR_CONFIG.recapDays})`,
        ].join('\n'),
        runAs: 'APP',
      });
    } catch (e) {
      console.error('namecolor standings comment failed:', e);
    }
  }

  if (isLast) await endRecaps(rawPostId);
  await save({ sig, ended: isLast });
}

export type HallEntry = { name: string; author: string; hex: string; url: string };

/**
 * Put a brand-new name on the cross-post board straight away, at its author's
 * own upvote. Without this the Hall of Fame reads empty for up to an hour after
 * someone's first name — the sweep can't see a comment Reddit's listing hasn't
 * indexed yet — while the post itself already shows it. The next sweep
 * overwrites this score with the real one.
 */
export async function seedHallEntry(
  rawPostId: string,
  hex: string,
  commentId: string,
  entry: NameEntry,
): Promise<void> {
  const id = `${rawPostId}|${commentId}`;
  await Promise.all([
    redis.zAdd(ncKeys.hall, { member: id, score: 1 }),
    redis.hSet(ncKeys.hallMeta, {
      [id]: JSON.stringify({ name: entry.raw, author: entry.author, hex, url: entry.permalink } satisfies HallEntry),
    }),
  ]);
}

/**
 * Push this post's names onto the cross-post board. It is a snapshot, not a
 * record: every sweep rewrites the scores, so a name that picks up votes later
 * climbs, and #1 today can be #4 tomorrow. Trimmed to the head of the list
 * because nothing outside the top few hundred is ever displayed.
 */
async function updateHall(
  rawPostId: string,
  hex: string,
  entriesRaw: Record<string, string>,
  seen: { member: string; score: number }[],
): Promise<void> {
  const members: { member: string; score: number }[] = [];
  const metas: Record<string, string> = {};
  for (const s of seen) {
    const e = JSON.parse(entriesRaw[s.member]!) as NameEntry;
    const id = `${rawPostId}|${s.member}`;
    members.push({ member: id, score: s.score });
    metas[id] = JSON.stringify({ name: e.raw, author: e.author, hex, url: e.permalink } satisfies HallEntry);
  }
  if (members.length === 0) return;

  await redis.zAdd(ncKeys.hall, ...members);
  await redis.hSet(ncKeys.hallMeta, metas);

  const size = await redis.zCard(ncKeys.hall);
  const excess = size - NAMECOLOR_CONFIG.hallSize;
  if (excess > 0) {
    // zRange is ascending, so the bottom `excess` are the lowest-scoring.
    const drop = await redis.zRange(ncKeys.hall, 0, excess - 1, { by: 'rank' });
    const ids = drop.map(d => d.member);
    if (ids.length > 0) {
      await Promise.all([redis.zRem(ncKeys.hall, ids), redis.hDel(ncKeys.hallMeta, ids)]);
    }
  }
}

/**
 * Move the "led this color" credit to whoever is on top right now, and keep
 * each player's best-single-name score current. Idempotent, and runs on EVERY
 * sweep at any post age — that is the whole point. Credit used to be frozen the
 * moment the recaps stopped, so a name that overtook on day 9 showed at the top
 * of the board while the old leader kept the credit. Now the two always agree.
 *
 * Only one player holds a color at a time, so an overtake hands the credit over:
 * minus one from the old holder, plus one to the new.
 */
async function reconcileCredit(rawPostId: string, entriesRaw: Record<string, string>): Promise<void> {
  const entries = Object.entries(entriesRaw).map(([commentId, str]) => ({ commentId, ...(JSON.parse(str) as NameEntry) }));
  if (entries.length === 0) return;

  const scores = await readVotes(rawPostId);

  // Rank is a player's BEST single name — summing would let volume beat quality.
  // Ties break toward whoever said it first, matching the board exactly: if the
  // two disagreed, a tie would credit one player while the screen showed another,
  // and the pair would trade the credit back and forth on every sweep.
  const best = new Map<string, { raw: string; votes: number; at: number }>();
  for (const e of entries) {
    const votes = scores.get(e.commentId) ?? 0;
    const cur = best.get(e.author);
    if (!cur || votes > cur.votes || (votes === cur.votes && e.at < cur.at)) {
      best.set(e.author, { raw: e.raw, votes, at: e.at });
    }
  }

  // Batched, and only written where it actually moved — this runs on every
  // sweep now, so a per-author read/write pair would be the expensive part.
  const authors = [...best.keys()];
  const statsRaw = await redis.hMGet(ncKeys.stats, authors);
  const writes: Record<string, string> = {};
  authors.forEach((author, i) => {
    const raw = statsRaw[i];
    const s: UserStats = raw ? (JSON.parse(raw) as UserStats) : { names: 0, bestVotes: 0, wins: 0 };
    const votes = best.get(author)!.votes;
    if (votes > s.bestVotes) {
      s.bestVotes = votes;
      writes[author] = JSON.stringify(s);
    }
  });
  if (Object.keys(writes).length > 0) await redis.hSet(ncKeys.stats, writes);

  const ranked = [...best.entries()].sort((a, b) => b[1].votes - a[1].votes || a[1].at - b[1].at);
  const top = ranked[0];
  // Nobody holds a color that nothing has voted for. Without this, a board of
  // all-zero names hands the credit to whichever author the hash happened to
  // return first, and re-hands it on the next sweep.
  if (!top || top[1].votes <= 0) return;

  const leader = top[0];
  const held = await redis.get(ncKeys.banked(rawPostId));
  if (leader === held) return;

  if (held) await Promise.all([bumpWins(held, -1), redis.zIncrBy(ncKeys.wins, held, -1)]);
  await Promise.all([
    bumpWins(leader, 1),
    redis.zIncrBy(ncKeys.wins, leader, 1),
    redis.set(ncKeys.banked(rawPostId), leader),
  ]);
}

/**
 * Forget names whose comments no longer exist, everywhere they are held: this
 * post's board, its vote scores, the cross-post Hall of Fame, and the submitting
 * player's own list. `entriesRaw` is pruned in place so the rest of this sweep
 * ranks and announces the board that is actually there.
 *
 * `stats.names` is deliberately left alone — it counts what a player submitted,
 * and a deleted comment was still submitted.
 */
async function dropEntries(rawPostId: string, entriesRaw: Record<string, string>, ids: string[]): Promise<void> {
  const hallIds = ids.map(id => `${rawPostId}|${id}`);
  const authors = new Set(ids.map(id => (JSON.parse(entriesRaw[id]!) as NameEntry).author));

  await Promise.all([
    redis.hDel(ncKeys.entries(rawPostId), ids),
    redis.zRem(ncKeys.votes(rawPostId), ids),
    redis.zRem(ncKeys.hall, hallIds),
    redis.hDel(ncKeys.hallMeta, hallIds),
  ]);

  // Only the affected players' lists are rewritten, so the common case (nothing
  // deleted) never touches this hash at all.
  const byUser = await redis.hGetAll(ncKeys.byUser(rawPostId));
  const writes: Record<string, string> = {};
  for (const author of authors) {
    const raw = byUser[author];
    if (!raw) continue;
    writes[author] = JSON.stringify((JSON.parse(raw) as string[]).filter(id => !ids.includes(id)));
  }
  if (Object.keys(writes).length > 0) await redis.hSet(ncKeys.byUser(rawPostId), writes);

  for (const id of ids) delete entriesRaw[id];
}

/**
 * End of the recap window. This stops the app TALKING and drops the post off
 * the hourly cron — it does not settle anything. Names, votes, the board, the
 * Hall of Fame and the credit above all keep moving forever; they just move on
 * the sweeps that fire when someone actually opens the post.
 */
async function endRecaps(rawPostId: string): Promise<void> {
  await redis.zRem(ncKeys.active, [rawPostId]);
}

async function bumpWins(author: string, delta: number): Promise<void> {
  const statStr = await redis.hGet(ncKeys.stats, author);
  const s = statStr ? (JSON.parse(statStr) as UserStats) : { names: 0, bestVotes: 0, wins: 0 };
  s.wins = Math.max(0, s.wins + delta);
  await redis.hSet(ncKeys.stats, { [author]: JSON.stringify(s) });
}

/**
 * Hourly cron pass, and the only thing left that runs on a timer.
 *
 * Its one job is the daily summary comment, which has to go out on schedule
 * whether or not anybody opened the post that day. So it is scoped to exactly
 * that: posts inside the recap window (younger than recapDays), nothing else.
 * Anything older is evicted from the active set on sight rather than swept —
 * past the window there is no comment left to post, and its votes are counted
 * on demand instead, forever, by sweepPost.
 *
 * Bounded per run so a backlog can never blow the request budget in one go.
 */
export async function sweepActivePosts(maxPosts = 12): Promise<number> {
  const size = await redis.zCard(ncKeys.active);
  if (size === 0) return 0;
  // Oldest first — they're the ones nearest their next recap.
  const ids = await redis.zRange(ncKeys.active, 0, Math.min(size, maxPosts) - 1, { by: 'rank' });

  // Day N's recap posts during round N, which runs from day N to day N+1 — so
  // the last one (day recapDays) is still owed right up to day recapDays + 1.
  // Cutting at recapDays flat would evict the post the moment its final recap
  // came due, and that comment would never be posted. This is a backstop anyway:
  // maybeAnnounce drops the post itself once it has said its last word.
  const windowMs = (NAMECOLOR_CONFIG.recapDays + 1) * NAMECOLOR_CONFIG.roundHours * 3600 * 1000;
  let swept = 0;
  for (const { member } of ids) {
    try {
      const meta = await getMeta(member);
      if (!meta || Date.now() - meta.createdAt > windowMs) {
        await redis.zRem(ncKeys.active, [member]);
        continue;
      }
      if (await sweepPost(member, true)) swept += 1;
    } catch (e) {
      console.error(`namecolor sweep failed for ${member}:`, e);
    }
  }
  return swept;
}

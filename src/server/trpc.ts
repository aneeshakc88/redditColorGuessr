import { initTRPC } from '@trpc/server';
import { transformer } from '../shared/transformer';
import { Context } from './context';
import { context, media, reddit, redis } from '@devvit/web/server';
import { countDecrement, countGet, countIncrement } from './core/count';
import { calculateScore } from './core/game';
import { fetchAllPizzaColors, getDailyColors, PuzzleColor } from './core/colors';
import { createCustomPost, createNameColorPost } from './core/post';
import { getMeta, ncKeys, seedHallEntry, sweepPost, type HallEntry, type NameColorMeta, type NameEntry, type UserStats } from './core/namecolor';
import { checkName, commentUrl, isHex, mdEscape } from '../shared/namecolor-core';
import { setWireDifficultyFlair, updateUserFlair } from './core/flair';
import { z } from 'zod';
import { getDailyMastermind, getMastermindFeedback, mmConfig, MASTERMIND_CONFIG } from '../shared/mastermind-core';
import { getDailyFlagPuzzle, getGauntletRounds } from '../shared/flag-core';
import { getDailyPalette, getStackSequence, runScore, reachedStack, memorizeMs, MEMORY_CONFIG } from '../shared/memory-core';
import { WIRE_COLORS, WIRE_CONFIG, checkSolution, generatePuzzle, getDailyPuzzle, rateBoard, seedFromString, solveWire, wireScore, type WirePuzzle, type WireTier } from '../shared/wire-core';
import { REWIRE_SIZES, generateShuffle } from '../shared/rewire-core';
import { PP_MIN_ROUNDS, PP_MAX_ROUNDS, ppRoundMax, ppScoreFrac } from '../shared/palette-poet-core';
import { EQUINOX_BANK, EQUINOX_BANK_N } from '../shared/equinox-bank';
import { EMPTY, decodePuzzle, equinoxPuzzleNumber, equinoxScore, pickDaily, violations, type EncodedPuzzle } from '../shared/equinox-core';

const t = initTRPC.context<Context>().create({ transformer });

export const router = t.router;
export const publicProcedure = t.procedure;

const rawId = (id: string) => id.startsWith('t3_') ? id.slice(3) : id;

// Deterministic shuffle — stable across polls, so splash order never flickers.
const seededShuffle = <T,>(arr: T[], seedStr: string): T[] => {
  let s = seedStr.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) || 1;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

// Resolve a flag post's puzzle from its per-post snapshot (frozen at creation).
// Progress/leaderboard stay keyed by the resolved date, so multiple posts of the
// same day share one puzzle + leaderboard. Legacy posts (no snapshot) fall back to
// live-computing today's puzzle.
type FlagRounds = ReturnType<typeof getDailyFlagPuzzle>;
async function resolveFlagPuzzle(): Promise<{ date: string; rounds: FlagRounds }> {
  const postId = context.postId;
  if (postId) {
    const rId = rawId(postId);
    const [snapStr, dateStr, gauntlet] = await Promise.all([
      redis.get(`flag:snapshot:${rId}`),
      redis.get(`flag:date:${rId}`),
      redis.get(`flag:gauntlet:${rId}`),
    ]);
    // The gauntlet is a dev tool, not an archive — rebuild it rather than keep every
    // region's copy of its flag SVG in one redis value.
    if (gauntlet === '1') return { date: dateStr ?? 'gauntlet', rounds: getGauntletRounds() };
    if (snapStr && dateStr) return { date: dateStr, rounds: JSON.parse(snapStr) as FlagRounds };
  }
  const today = new Date().toISOString().split('T')[0]!;
  return { date: today, rounds: getDailyFlagPuzzle(today) };
}

// Resolve which Run a post plays: the daily, or a mod-dropped bonus round. Bonus
// posts store { date, n }; they get their own redis key namespace + a seed variant
// so their puzzle and leaderboard are fully separate from the daily.
type MemoryCtx = { isBonus: boolean; variant: number; seedDate: string; keyBase: string; label: string | null };
async function resolveMemoryCtx(): Promise<MemoryCtx> {
  const today = new Date().toISOString().split('T')[0]!;
  const postId = context.postId;
  if (postId) {
    const metaStr = await redis.get(`memory:bonus:${rawId(postId)}`);
    if (metaStr) {
      const meta = JSON.parse(metaStr) as { date: string; n: number };
      return { isBonus: true, variant: meta.n, seedDate: meta.date, keyBase: `bonus:${rawId(postId)}`, label: `Bonus #${meta.n}` };
    }
  }
  return { isBonus: false, variant: 0, seedDate: today, keyBase: today, label: null };
}


// Resolve which Colorwire board a post plays. Daily posts snapshot their puzzle
// at creation (so an old post stays an exact archive) and share one leaderboard
// per date; custom posts carry their own board and their own leaderboard.
type WireCtx = { isCustom: boolean; keyBase: string; date: string; puzzle: WirePuzzle; title: string | null; creator: string | null };
async function resolveWireCtx(): Promise<WireCtx> {
  const today = new Date().toISOString().split('T')[0]!;
  const postId = context.postId;
  if (postId) {
    const rId = rawId(postId);
    const [customStr, snapStr, dateStr] = await Promise.all([
      redis.get(`wire:custom:${rId}`),
      redis.get(`wire:snapshot:${rId}`),
      redis.get(`wire:date:${rId}`),
    ]);
    if (customStr) {
      const c = JSON.parse(customStr) as WirePuzzle & { creator: string; title?: string };
      return { isCustom: true, keyBase: `c:${rId}`, date: today, puzzle: { w: c.w, h: c.h, pairs: c.pairs }, title: c.title ?? null, creator: c.creator };
    }
    if (snapStr && dateStr) {
      return { isCustom: false, keyBase: dateStr, date: dateStr, puzzle: JSON.parse(snapStr) as WirePuzzle, title: null, creator: null };
    }
  }
  const p = getDailyPuzzle(today);
  return { isCustom: false, keyBase: today, date: today, puzzle: { w: p.w, h: p.h, pairs: p.pairs }, title: null, creator: null };
}

// Rewire boards are always user-created (no daily/mod-authored post), so
// resolution is just "does this post have a board" — unlike Colorwire there is
// no live-generated fallback.
type RewireCtx = { rawPostId: string; keyBase: string; puzzle: WirePuzzle; imageUrl: string; title: string | null; creator: string };
async function resolveRewireCtx(): Promise<RewireCtx> {
  const postId = context.postId;
  if (!postId) throw new Error('No post ID');
  const rId = rawId(postId);
  const str = await redis.get(`rewire:custom:${rId}`);
  if (!str) throw new Error('Rewire board not found');
  const c = JSON.parse(str) as WirePuzzle & { imageUrl: string; creator: string; title?: string };
  return { rawPostId: rId, keyBase: `c:${rId}`, puzzle: { w: c.w, h: c.h, pairs: c.pairs }, imageUrl: c.imageUrl, title: c.title ?? null, creator: c.creator };
}

// Which code a daily Mastermind post plays. Posts created from now on snapshot
// theirs at creation; posts that predate the snapshot are backfilled on first
// read from their real creation date, so an archived post stops silently
// re-resolving to today's code (which let today's answer solve every old post).
type MastermindDaily = { date: string; poolColors: { name: string; hex: string }[]; secret: string[] };
async function resolveMastermindDaily(rawPostId: string | null): Promise<MastermindDaily> {
  const today = new Date().toISOString().split('T')[0]!;
  if (!rawPostId) return { date: today, ...getDailyMastermind(today) };

  const [snapStr, dateStr] = await Promise.all([
    redis.get(`mastermind:snapshot:${rawPostId}`),
    redis.get(`mastermind:date:${rawPostId}`),
  ]);
  if (snapStr && dateStr) return { date: dateStr, ...JSON.parse(snapStr) as Omit<MastermindDaily, 'date'> };

  let date = dateStr ?? null;
  if (!date) {
    try {
      const post = await reddit.getPostById((rawPostId.startsWith('t3_') ? rawPostId : `t3_${rawPostId}`) as `t3_${string}`);
      const created = post?.createdAt ? new Date(post.createdAt) : null;
      if (created && !isNaN(created.getTime())) date = created.toISOString().split('T')[0]!;
    } catch {
      // Post lookup is best-effort; falling back to today at least freezes it.
    }
  }
  date ??= today;

  const mm = getDailyMastermind(date);
  await Promise.all([
    redis.set(`mastermind:date:${rawPostId}`, date),
    redis.set(`mastermind:snapshot:${rawPostId}`, JSON.stringify(mm)),
  ]);
  return { date, ...mm };
}

// Milestone counts that trigger a congrats comment to the board's creator.
const WIRE_CREATOR_MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

// A board only counts toward the Builders ranking once this many people have
// solved it, so posting a pile of boards nobody plays can't buy the top spot.
const WIRE_BUILDER_MIN_SOLVERS = 5;
// Rising is the newcomer lane, gated on join date alone — a new creator who
// posts a lot is exactly who it should showcase, so board count doesn't evict.
const WIRE_RISING_WINDOW_MS = 30 * 24 * 3600 * 1000;

// `d` is the measured difficulty tier; boards posted before tiers existed
// simply do not carry one.
type WireBoardMeta = { c: string; t: string; at: number; d?: WireTier };

// One row of any creator tab. `score` is whatever that tab ranks on.
type WireCreatorRow = {
  member: string; score: number; boards: number; qualBoards: number; plays: number;
  bestTitle: string | null; bestPlays: number; bestUrl: string | null;
};

// Per-board records powering the creator tabs. Boards created before these keys
// existed have no meta row, so opening or solving one backfills it — their `at`
// is the backfill time, which only affects Rising eligibility. The board-plays
// row is registered too (at zero, never overwriting a real solver count), since
// the creator tabs iterate that zset and a board missing from it is invisible.
async function ensureWireBoardMeta(postId: string, creator: string, title: string | null): Promise<void> {
  const [existing] = await Promise.all([
    redis.hGet('wire:board-meta', postId),
    // Increment by zero: creates the row at 0 if absent, no-op if a solver count
    // already exists. A read-then-zAdd could race a concurrent solve to zero.
    redis.zIncrBy('wire:board-plays', postId, 0),
  ]);
  if (existing) return;
  await redis.hSet('wire:board-meta', {
    [postId]: JSON.stringify({ c: creator, t: title ?? '', at: Date.now() } satisfies WireBoardMeta),
  });
}

type WireResult = { score: number; timeSec: number; moves: number; submittedAt: number };

// Rewire's creator-tab bookkeeping mirrors Colorwire's 1:1 under its own
// key prefix — every board is custom, so there's no daily/snapshot branch.
async function ensureRewireBoardMeta(postId: string, creator: string, title: string | null): Promise<void> {
  const [existing] = await Promise.all([
    redis.hGet('rewire:board-meta', postId),
    redis.zIncrBy('rewire:board-plays', postId, 0),
  ]);
  if (existing) return;
  await redis.hSet('rewire:board-meta', {
    [postId]: JSON.stringify({ c: creator, t: title ?? '', at: Date.now() } satisfies WireBoardMeta),
  });
}

type RewireResult = { score: number; l1TimeSec: number; l1Swaps: number; l2TimeSec: number; l2Moves: number; submittedAt: number };

// Search budget for board validation. Sized off the worst 9x9 boards the
// generator makes (~2.5M nodes, a few seconds); under it, a solvable board can
// come back unproven, which used to read to the creator as "unsolvable".
const WIRE_SOLVE_NODES = 3000000;

// Shape checks a hand-built board has to pass before the (much more expensive)
// solver is asked whether it can actually be filled.
function validateWireBoard(board: WirePuzzle): string | null {
  const n = board.w * board.h;
  const seen = new Set<number>();
  for (const p of board.pairs) {
    if (p.a === p.b) return 'A pair needs two different cells.';
    for (const cell of [p.a, p.b]) {
      if (cell < 0 || cell >= n) return 'A dot is off the board.';
      if (seen.has(cell)) return 'Two dots share a cell.';
      seen.add(cell);
    }
  }
  if (seen.size >= n) return 'Leave some empty cells for the wires to run through.';
  return null;
}

// ── Name This Color ──────────────────────────────────────────────────────────
type NcCtx = NameColorMeta & { rawPostId: string };

// No closed state: a color takes names for as long as the post exists.
async function resolveNameColorCtx(): Promise<NcCtx> {
  const postId = context.postId;
  if (!postId) throw new Error('No post ID');
  const rId = rawId(postId);
  const meta = await getMeta(rId);
  if (!meta) throw new Error('Not a Name This Color post');
  return { ...meta, rawPostId: rId };
}

type NcName = { id: string; name: string; author: string; votes: number; url: string; at: number };

// One hGetAll + one zRange for the whole board — per-name lookups would be
// hundreds of round-trips on a busy post.
async function ncRanked(rawPostId: string): Promise<NcName[]> {
  const entriesRaw = await redis.hGetAll(ncKeys.entries(rawPostId));
  const ids = Object.keys(entriesRaw);
  if (ids.length === 0) return [];

  const votesKey = ncKeys.votes(rawPostId);
  const size = await redis.zCard(votesKey);
  const votes = new Map<string, number>();
  if (size > 0) {
    for (const e of await redis.zRange(votesKey, 0, size - 1, { by: 'rank' })) votes.set(e.member, e.score);
  }

  return ids
    .map(id => {
      const e = JSON.parse(entriesRaw[id]!) as NameEntry;
      return { id, name: e.raw, author: e.author, votes: votes.get(id) ?? 0, url: commentUrl(e.permalink), at: e.at };
    })
    // Ties break toward whoever said it first.
    .sort((a, b) => b.votes - a.votes || a.at - b.at);
}

const RATE_LIMIT_RE = /rate.?limit|doing that too much|try again in|too fast/i;

async function getAvatarUrl(username: string): Promise<string | undefined> {
  const cacheKey = `color-guesser:avatar:${username}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached === 'none' ? undefined : cached;

  try {
    const url = await reddit.getSnoovatarUrl(username);
    const result = url || undefined;
    const ttl = result ? 3600_000 : 300_000;
    await redis.set(cacheKey, result ?? 'none', { expiration: new Date(Date.now() + ttl) });
    return result;
  } catch {
    return undefined;
  }
}

// Build snoovatar map for the top members of a leaderboard (+ current viewer).
async function buildSnoovatars(members: string[], username: string | null): Promise<Record<string, string>> {
  const cands = [...new Set([...members.slice(0, 100), ...(username ? [username] : [])])];
  const results = await Promise.all(cands.map(m => getAvatarUrl(m)));
  const map: Record<string, string> = {};
  cands.forEach((m, i) => { if (results[i]) map[m] = results[i]!; });
  if (username && context.snoovatar) map[username] = context.snoovatar;
  return map;
}

// Inclusive list of YYYY-MM-DD dates from start..end, capped to `cap` days.
function rangeDates(start: string, end: string, cap = 400): string[] {
  const out: string[] = [];
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) return out;
  for (let d = new Date(s); d <= e && out.length < cap; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().split('T')[0]!);
  }
  return out;
}

// Per-day ColorGuessr stat bucket (powers dated leaderboard). Mirrors cumulative stats writes.
async function bumpCgDaily(date: string, username: string, score: number): Promise<void> {
  const key = `color-guesser:daily-stats:${date}`;
  const raw = await redis.hGet(key, username);
  const s = raw ? JSON.parse(raw) as { games: number; totalScore: number; bestScore: number } : { games: 0, totalScore: 0, bestScore: 0 };
  s.games += 1; s.totalScore += score; s.bestScore = Math.max(s.bestScore, score);
  await redis.hSet(key, { [username]: JSON.stringify(s) });
}

// Per-day Mastermind stat bucket (powers dated leaderboard).
async function bumpMmDaily(date: string, username: string, won: boolean, guesses: number): Promise<void> {
  const key = `mastermind:daily-stats:${date}`;
  const raw = await redis.hGet(key, username);
  const s = raw ? JSON.parse(raw) as { games: number; wins: number; totalGuesses: number } : { games: 0, wins: 0, totalGuesses: 0 };
  s.games += 1; s.totalGuesses += guesses; if (won) s.wins += 1; // failed games count as maxGuesses (all used)
  await redis.hSet(key, { [username]: JSON.stringify(s) });
}

type UserProgress = { guesses: ({ hex: string; score: number; actualHex: string; actualName: string } | null)[]; totalScore: number; completed: boolean };


async function isCurrentUserMod(): Promise<boolean> {
  const username = context.username;
  const subredditName = context.subredditName;
  if (!username || !subredditName) return false;
  const cacheKey = `color-guesser:mods:${subredditName}`;
  const cached = await redis.get(cacheKey);
  let mods: string[];
  if (cached) {
    mods = JSON.parse(cached) as string[];
  } else {
    try {
      const modList = await reddit.getModerators({ subredditName }).all();
      mods = modList.map(u => u.username);
      await redis.set(cacheKey, JSON.stringify(mods), { expiration: new Date(Date.now() + 3600_000) });
    } catch {
      return false;
    }
  }
  return mods.includes(username);
}

function getCreatorLabel(avg: number): string {
  if (avg >= 90) return 'Mind Reader';
  if (avg >= 75) return 'Intuitive Artist';
  if (avg >= 60) return 'Creative Thinker';
  if (avg >= 45) return 'Abstract Poet';
  return 'Cryptic Master';
}

async function getCustomColors(postId: string | undefined): Promise<{ colors: PuzzleColor[]; creator: string; title?: string; hints?: string[]; inputMode?: 'slider' | 'wheel' } | null> {
  if (!postId) return null;
  try {
    const str = await redis.get(`color-guesser:custom:${rawId(postId)}`);
    if (!str) return null;
    return JSON.parse(str) as { colors: PuzzleColor[]; creator: string; title?: string; hints?: string[]; inputMode?: 'slider' | 'wheel' };
  } catch {
    return null;
  }
}

// ── Equinox ──────────────────────────────────────────────────────────────────
// Every board is pre-verified offline and committed in equinox-bank.ts, so the
// server only ever picks one — it never generates a puzzle. A post snapshots
// its board at creation, so regenerating the bank can't rewrite an old post.
type EquinoxResult = { score: number; timeSec: number; submittedAt: number };

// A post's number is frozen at creation. The stored value wins; the launch
// anchor only fills in for a post made before numbering existed.
async function resolveEquinoxCtx(): Promise<{ puzzle: EncodedPuzzle; date: string; keyBase: string; num: number }> {
  const postId = context.postId;
  if (postId) {
    const rId = rawId(postId);
    const [snapStr, dateStr, numStr, launch] = await Promise.all([
      redis.get(`equinox:snapshot:${rId}`),
      redis.get(`equinox:date:${rId}`),
      redis.get(`equinox:num:${rId}`),
      redis.get('equinox:first-date'),
    ]);
    if (snapStr && dateStr) {
      return {
        puzzle: JSON.parse(snapStr) as EncodedPuzzle,
        date: dateStr, keyBase: dateStr,
        num: numStr ? Number(numStr) : equinoxPuzzleNumber(dateStr, launch ?? dateStr),
      };
    }
  }
  const today = new Date().toISOString().split('T')[0]!;
  const launch = await redis.get('equinox:first-date');
  return {
    puzzle: { n: EQUINOX_BANK_N, ...pickDaily(EQUINOX_BANK, today) },
    date: today, keyBase: today, num: equinoxPuzzleNumber(today, launch ?? today),
  };
}

// The board the splash needs. Shared so the post-type lookup can ship it in the
// same reply: the splash blocks on that lookup either way, and asking for the
// board only afterwards cost a second round trip before anything could paint.
async function equinoxBoardPayload() {
  const { puzzle, date, keyBase, num } = await resolveEquinoxCtx();
  const username = context.username ?? null;

  const [playerCount, officialStr, streakStr, onboarded, lifetime] = await Promise.all([
    redis.zCard(`equinox:lb:${keyBase}`),
    username ? redis.get(`equinox:daily:${keyBase}:${username}`) : Promise.resolve(null),
    username ? redis.get(`equinox:streak:${username}`) : Promise.resolve(null),
    username ? redis.get(`equinox:onboarded:${username}`) : Promise.resolve(null),
    username ? redis.zScore('equinox:plays:alltime', username).catch(() => undefined) : Promise.resolve(undefined),
  ]);
  const official = officialStr ? JSON.parse(officialStr) as EquinoxResult : null;
  const streak = streakStr ? (JSON.parse(streakStr) as { count: number }).count : null;

  // Anyone with a lifetime solve is treated as already onboarded, so the
  // walkthrough never appears for players who were here before it shipped.
  const isNewPlayer = !!username && !onboarded && !official && lifetime == null;

  return { puzzle, date, num, playerCount, alreadyPlayed: !!official, best: official, username, streak, isNewPlayer };
}

export const appRouter = t.router({
  init: t.router({
    get: publicProcedure.query(async () => {
      const [count] = await Promise.all([countGet()]);
      return { count, postId: context.postId, username: context.username ?? null };
    }),
  }),

  counter: t.router({
    increment: publicProcedure.input(z.number().optional()).mutation(async ({ input }) => {
      return { count: await countIncrement(input), postId: context.postId, type: 'increment' };
    }),
    decrement: publicProcedure.input(z.number().optional()).mutation(async ({ input }) => {
      return { count: await countDecrement(input), postId: context.postId, type: 'decrement' };
    }),
    get: publicProcedure.query(async () => await countGet()),
  }),

  game: t.router({
    getColors: publicProcedure.query(() => fetchAllPizzaColors()),

    getDailyColors: publicProcedure.query(async () => {
      const today = new Date().toISOString().split('T')[0]!;
      const colors = await getDailyColors(today);
      return colors.map(c => ({ name: c.name, hex: c.hex }));
    }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const today = new Date().toISOString().split('T')[0]!;

      // Detect custom post
      const postId = context.postId;
      const rId = postId ? rawId(postId) : null;
      const postType = rId ? await redis.get(`color-guesser:post-type:${rId}`) : null;
      const isCustomPost = postType === 'custom';

      let activeKey: string;
      let lbMode: 'daily' | 'custom';
      let dailyCount = 0;

      if (isCustomPost && rId) {
        activeKey = `color-guesser:custom-lb:${rId}`;
        lbMode = 'custom';
        // Backfill: user completed before custom-lb existed — add their score on first leaderboard open
        if (username) {
          const existing = await redis.zScore(activeKey, username);
          if (existing == null) {
            const progressStr = await redis.get(`color-guesser:custom:${rId}:${username}`);
            const progress = progressStr ? (JSON.parse(progressStr) as UserProgress) : null;
            if (progress?.completed) {
              await redis.zAdd(activeKey, { score: progress.totalScore, member: username });
            }
          }
        }
      } else {
        const lbKey = `color-guesser:lb:${today}`;
        dailyCount = await redis.zCard(lbKey);
        activeKey = lbKey;
        lbMode = 'daily';
      }

      const size = await redis.zCard(activeKey);
      const top = size > 0 ? (await redis.zRange(activeKey, 0, size - 1, { by: 'rank' })).reverse() : [];

      let userRank: number | null = null;
      let userScore: number | null = null;
      if (username) {
        const rankIdx = top.findIndex(e => e.member === username);
        if (rankIdx >= 0) {
          userRank = rankIdx + 1;
          userScore = top[rankIdx]!.score;
        } else {
          const score = await redis.zScore(activeKey, username);
          userScore = score ?? null;
        }
      }

      let statsStr = username ? await redis.hGet('color-guesser:stats', username) : null;
      if (!statsStr && username) {
        // Lazy migration: old format was a string key per user
        const oldVal = await redis.get(`color-guesser:stats:${username}`);
        if (oldVal) {
          statsStr = oldVal;
          await redis.hSet('color-guesser:stats', { [username]: oldVal });
        }
      }
      const stats = statsStr
        ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number })
        : null;

      // Fetch avatars only for top 50 + current user to avoid timeout on large boards
      const avatarCandidates = [...new Set([...top.slice(0, 50).map(e => e.member), ...(username ? [username] : [])])];
      const avatarResults = await Promise.all(avatarCandidates.map(m => getAvatarUrl(m)));
      const snoovatars: Record<string, string> = {};
      avatarCandidates.forEach((m, i) => { if (avatarResults[i]) snoovatars[m] = avatarResults[i]!; });
      // Always use context snoovatar for current user — bypasses stale cache
      if (username && context.snoovatar) snoovatars[username] = context.snoovatar;

      return { top, userRank, userScore, username: username ?? null, stats, lbMode, dailyCount, isAlltime: false, snoovatars };
    }),

    isMod: publicProcedure.query(async () => {
      return { isMod: await isCurrentUserMod() };
    }),

    getSplashStats: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const postId = context.postId;
      if (!postId) return null;

      const rId = rawId(postId);
      const today = new Date().toISOString().split('T')[0]!;
      const postType = await redis.get(`color-guesser:post-type:${rId}`);
      const isCustom = postType === 'custom';
      const lbKey = isCustom ? `color-guesser:custom-lb:${rId}` : `color-guesser:lb:${today}`;

      const [solvedCount, userScore] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.zScore(lbKey, username) : Promise.resolve(null),
      ]);

      let userRank: number | null = null;
      if (username && userScore != null) {
        const rankAsc = await redis.zRank(lbKey, username);
        userRank = rankAsc != null ? solvedCount - rankAsc : null;
      }

      let creator: string | null = null;
      let creatorAvatar: string | null = null;
      if (isCustom) {
        const customStr = await redis.get(`color-guesser:custom:${rId}`);
        const customData = customStr ? JSON.parse(customStr) as { creator: string } : null;
        creator = customData?.creator ?? null;
        if (creator) {
          if (creator === context.username && context.snoovatar) {
            creatorAvatar = context.snoovatar;
          } else {
            creatorAvatar = (await getAvatarUrl(creator)) ?? null;
          }
        }
      }

      let topPlayer: { username: string; score: number; avatar: string | null } | null = null;
      if (solvedCount > 0) {
        const topArr = await redis.zRange(lbKey, solvedCount - 1, solvedCount - 1, { by: 'rank' });
        const t = topArr[0];
        if (t) {
          const avatar = t.member === context.username && context.snoovatar
            ? context.snoovatar
            : (await getAvatarUrl(t.member)) ?? null;
          topPlayer = { username: t.member, score: Math.round(t.score), avatar };
        }
      }

      // Ringside crowd for the fight card: runners-up below the top player.
      // Avatar lookups are redis-cached, so this is cheap after the first hit.
      let members: string[] = [];
      if (solvedCount > 1) {
        // stop must stay >= 0 here: zRange treats -1 as "through the end".
        const lo = Math.max(0, solvedCount - 8);
        const rest = await redis.zRange(lbKey, lo, solvedCount - 2, { by: 'rank' });
        members = rest.map(r => r.member).reverse();
      }
      // A viewer who has played always gets a slot — even if they are the top
      // player, or their rank falls outside the window above.
      if (username && userScore != null) {
        members = [username, ...members.filter(m => m !== username)];
      }
      members = members.slice(0, 6);

      const crowdAvatars = await Promise.all(members.map(m =>
        m === context.username && context.snoovatar
          ? Promise.resolve(context.snoovatar)
          : getAvatarUrl(m)
      ));
      const crowd = members
        .map((m, i) => ({ username: m, avatar: crowdAvatars[i], you: m === username }))
        .filter((c): c is { username: string; avatar: string; you: boolean } => !!c.avatar);

      return {
        postType: isCustom ? 'custom' as const : 'daily' as const,
        creator,
        creatorAvatar,
        solvedCount,
        userRank,
        userScore: userScore ?? null,
        userAvatar: context.snoovatar ?? null,
        username,
        topPlayer,
        crowd,
      };
    }),

    getAdminStats: publicProcedure.input(z.object({ dates: z.array(z.string()).max(14) })).query(async ({ input }) => {
      const results = await Promise.all(
        input.dates.map(async (date) => {
          const [daily, alltime] = await Promise.all([
            redis.zCard(`color-guesser:lb:${date}`),
            redis.zCard(`color-guesser:lb:alltime`),
          ]);
          return { date, daily, alltime };
        })
      );
      return results;
    }),

    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }
      const [dayCounts, alltimeCount] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(`color-guesser:lb:${d}`))),
        redis.zCard(`color-guesser:lb:alltime`),
      ]);
      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));
      return {
        perDay,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
      };
    }),

    getCustomAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }
      const postId = context.postId;
      const rId = postId ? rawId(postId) : null;

      const [dayCounts, alltimeCount, thisPostPlays] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(`color-guesser:custom-plays:${d}`))),
        redis.zCard('color-guesser:custom-plays:alltime'),
        rId ? redis.zCard(`color-guesser:custom-lb:${rId}`) : Promise.resolve(0),
      ]);

      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));
      return {
        perDay,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
        thisPostPlays,
      };
    }),

    getGlobalLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;

      // Collect all known members from every tracking sorted set
      const [playsSize, dailySize, customSize] = await Promise.all([
        redis.zCard('color-guesser:plays:alltime'),
        redis.zCard('color-guesser:lb:alltime'),
        redis.zCard('color-guesser:custom-best:alltime'),
      ]);
      const [playsRaw, dailyRaw, customRaw] = await Promise.all([
        playsSize > 0 ? redis.zRange('color-guesser:plays:alltime', 0, playsSize - 1, { by: 'rank' }) : Promise.resolve([]),
        dailySize > 0 ? redis.zRange('color-guesser:lb:alltime', 0, dailySize - 1, { by: 'rank' }) : Promise.resolve([]),
        customSize > 0 ? redis.zRange('color-guesser:custom-best:alltime', 0, customSize - 1, { by: 'rank' }) : Promise.resolve([]),
      ]);
      const allMembers = [...new Set([
        ...playsRaw.map(e => e.member),
        ...dailyRaw.map(e => e.member),
        ...customRaw.map(e => e.member),
      ])];

      // Read old string-key stats (day-1 format) first, fall back to new hash
      const oldVals = allMembers.length > 0
        ? await redis.mGet(allMembers.map(m => `color-guesser:stats:${m}`))
        : [];

      type Entry = { member: string; avgScore: number; games: number; bestScore: number; totalScore: number };
      const entries: Entry[] = (await Promise.all(
        allMembers.map(async (member, i) => {
          let raw = oldVals[i] ?? null;
          if (!raw) raw = await redis.hGet('color-guesser:stats', member) ?? null;
          if (!raw) return null;
          const s = JSON.parse(raw) as { games: number; totalScore: number; bestScore: number };
          if (s.games < 3) return null;
          return {
            member,
            avgScore: Math.round((s.totalScore / s.games) * 10) / 10,
            games: s.games,
            bestScore: s.bestScore,
            totalScore: s.totalScore,
          };
        })
      )).filter((e): e is Entry => e !== null)
        .sort((a, b) => b.avgScore - a.avgScore);

      const snoovatars = await buildSnoovatars(entries.map(e => e.member), username);
      return { entries, username, snoovatars };
    }),

    // ColorGuessr leaderboard over an explicit date range (powers weekly/monthly/custom tabs).
    getGlobalLeaderboardRange: publicProcedure
      .input(z.object({ start: z.string(), end: z.string() }))
      .query(async ({ input }) => {
        const username = context.username ?? null;
        const dates = rangeDates(input.start, input.end);

        type Entry = { member: string; avgScore: number; games: number; bestScore: number; totalScore: number };
        const agg = new Map<string, { games: number; totalScore: number; bestScore: number }>();
        const buckets = await Promise.all(dates.map(d => redis.hGetAll(`color-guesser:daily-stats:${d}`)));
        for (const bucket of buckets) {
          for (const [member, raw] of Object.entries(bucket ?? {})) {
            const s = JSON.parse(raw) as { games: number; totalScore: number; bestScore: number };
            const cur = agg.get(member) ?? { games: 0, totalScore: 0, bestScore: 0 };
            cur.games += s.games; cur.totalScore += s.totalScore; cur.bestScore = Math.max(cur.bestScore, s.bestScore);
            agg.set(member, cur);
          }
        }
        const entries: Entry[] = [...agg.entries()]
          .filter(([, s]) => s.games >= 1)
          .map(([member, s]) => ({
            member,
            avgScore: Math.round((s.totalScore / s.games) * 10) / 10,
            games: s.games,
            bestScore: s.bestScore,
            totalScore: s.totalScore,
          }))
          .sort((a, b) => b.avgScore - a.avgScore);

        const snoovatars = await buildSnoovatars(entries.map(e => e.member), username);
        return { entries, username, snoovatars };
      }),

    // Creator leaderboard: most custom puzzles created, per game.
    getCreatorLeaderboard: publicProcedure
      .input(z.object({ game: z.enum(['cg', 'mm']) }))
      .query(async ({ input }) => {
        const username = context.username ?? null;
        const key = input.game === 'cg' ? 'color-guesser:creators:alltime' : 'mastermind:creators:alltime';
        const size = await redis.zCard(key);
        const raw = size > 0 ? (await redis.zRange(key, 0, size - 1, { by: 'rank' })).reverse() : [];
        const entries = raw.map(e => ({ member: e.member, count: Math.round(e.score) }));
        const snoovatars = await buildSnoovatars(entries.map(e => e.member), username);
        return { entries, username, snoovatars };
      }),

    getCreatorLeaderboardRange: publicProcedure
      .input(z.object({ game: z.enum(['cg', 'mm']), start: z.string(), end: z.string() }))
      .query(async ({ input }) => {
        const username = context.username ?? null;
        const prefix = input.game === 'cg' ? 'color-guesser:creators:daily:' : 'mastermind:creators:daily:';
        const dates = rangeDates(input.start, input.end);
        const buckets = await Promise.all(dates.map(async d => {
          const key = `${prefix}${d}`;
          const size = await redis.zCard(key);
          return size > 0 ? redis.zRange(key, 0, size - 1, { by: 'rank' }) : [];
        }));
        const agg = new Map<string, number>();
        for (const bucket of buckets) for (const e of bucket) agg.set(e.member, (agg.get(e.member) ?? 0) + e.score);
        const entries = [...agg.entries()]
          .map(([member, count]) => ({ member, count: Math.round(count) }))
          .sort((a, b) => b.count - a.count);
        const snoovatars = await buildSnoovatars(entries.map(e => e.member), username);
        return { entries, username, snoovatars };
      }),

    getPostInfo: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const postId = context.postId;
      if (!postId) return { postType: 'daily' as const, isCreator: false, configured: false, creator: null as string | null, title: null as string | null };

      const rId = rawId(postId);
      const postType = await redis.get(`color-guesser:post-type:${rId}`);
      if (postType === 'leaderboard') return { postType: 'leaderboard' as const, isCreator: false, configured: true, creator: null as string | null, title: null as string | null };
      if (postType === 'mastermind-daily') return { postType: 'mastermind' as const, isCreator: false, configured: true, creator: null as string | null, title: null as string | null };
      if (postType === 'mastermind-custom') {
        const customStr = await redis.get(`mastermind:custom:${rId}`);
        const custom = customStr ? JSON.parse(customStr) as { creator: string; title?: string } : null;
        return { postType: 'mastermind' as const, isCreator: custom?.creator === username, configured: !!customStr, creator: custom?.creator ?? null, title: custom?.title ?? null };
      }
      if (postType === 'flag-daily') {
        // Ship the round's flags with the type lookup the splash already waits on,
        // so the ring paints them immediately instead of after a second round-trip.
        const { rounds } = await resolveFlagPuzzle();
        return {
          postType: 'flag' as const, isCreator: false, configured: true,
          creator: null as string | null, title: null as string | null,
          // slice: a gauntlet post's snapshot holds every flag; the ring only needs a few.
          flags: rounds.slice(0, 5).map(r => ({ name: r.flag.name, svg: r.flag.svg })),
        };
      }
      if (postType === 'memory-daily' || postType === 'memory-bonus') return { postType: 'memory' as const, isCreator: false, configured: true, creator: null as string | null, title: null as string | null };
      if (postType === 'wire-daily') return { postType: 'wire' as const, isCreator: false, configured: true, creator: null as string | null, title: null as string | null };
      if (postType === 'equinox-daily') {
        return {
          postType: 'equinox' as const, isCreator: false, configured: true,
          creator: null as string | null, title: null as string | null,
          board: await equinoxBoardPayload(),
        };
      }
      if (postType === 'wire-custom') {
        const customStr = await redis.get(`wire:custom:${rId}`);
        const custom = customStr ? JSON.parse(customStr) as { creator: string; title?: string } : null;
        return { postType: 'wire' as const, isCreator: custom?.creator === username, configured: !!customStr, creator: custom?.creator ?? null, title: custom?.title ?? null };
      }
      if (postType === 'rewire') {
        const customStr = await redis.get(`rewire:custom:${rId}`);
        const custom = customStr ? JSON.parse(customStr) as { creator: string; title?: string } : null;
        return { postType: 'rewire' as const, isCreator: custom?.creator === username, configured: !!customStr, creator: custom?.creator ?? null, title: custom?.title ?? null };
      }
      if (postType === 'namecolor-daily' || postType === 'namecolor-custom') {
        const meta = await getMeta(rId);
        return {
          postType: 'namecolor' as const, isCreator: meta?.creator === username, configured: !!meta,
          creator: meta?.creator ?? null, title: meta?.title ?? null,
        };
      }
      if (postType === 'palette-poet') {
        const puzzleStr = await redis.get(`palette-poet:puzzle:${rId}`);
        const puzzle = puzzleStr ? JSON.parse(puzzleStr) as { creator: string; title?: string } : null;
        return { postType: 'palette-poet' as const, isCreator: puzzle?.creator === username, configured: !!puzzleStr, creator: puzzle?.creator ?? null, title: puzzle?.title ?? null };
      }
      if (postType !== 'custom') return { postType: 'daily' as const, isCreator: false, configured: false, creator: null as string | null, title: null as string | null };

      const [customStr, metaStr] = await Promise.all([
        redis.get(`color-guesser:custom:${rId}`),
        redis.get(`color-guesser:custom-meta:${rId}`),
      ]);
      const meta = metaStr ? (JSON.parse(metaStr) as { creator: string }) : null;
      const customData = customStr ? (JSON.parse(customStr) as { title?: string; inputMode?: 'slider' | 'wheel' }) : null;

      return {
        postType: 'custom' as const,
        isCreator: meta?.creator === username,
        configured: !!customStr,
        creator: meta?.creator ?? null,
        title: customData?.title ?? null,
        inputMode: (customData?.inputMode ?? 'slider') as 'slider' | 'wheel',
      };
    }),

    getDailyRoundColors: publicProcedure.query(async () => {
      const today = new Date().toISOString().split('T')[0]!;
      const postId = context.postId;
      if (postId) {
        const rId = rawId(postId);
        const postType = await redis.get(`color-guesser:post-type:${rId}`);
        if (postType === 'custom') {
          const custom = await getCustomColors(postId);
          if (custom) return custom.colors.map(c => ({ hex: c.hex, name: c.name }));
        }
      }
      const colors = await getDailyColors(today);
      return colors.map(c => ({ hex: c.hex, name: c.name }));
    }),

    getPuzzle: publicProcedure.query(async () => {
      const today = new Date().toISOString().split('T')[0]!;
      const username = context.username ?? null;
      const [custom, dailyPuzzle] = await Promise.all([
        getCustomColors(context.postId),
        getDailyColors(today),
      ]);

      // Fetch user stats with lazy migration fallback
      let statsStr = username ? await redis.hGet('color-guesser:stats', username) : null;
      if (!statsStr && username) {
        const oldVal = await redis.get(`color-guesser:stats:${username}`);
        if (oldVal) { statsStr = oldVal; await redis.hSet('color-guesser:stats', { [username]: oldVal }); }
      }
      const userStats = statsStr
        ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number })
        : null;

      const coinsStr = username ? await redis.get(`color-guesser:coins:${username}`) : null;
      let coinBalance: number;
      if (username && coinsStr === null) {
        await redis.set(`color-guesser:coins:${username}`, '50');
        coinBalance = 50;
      } else {
        coinBalance = coinsStr ? parseInt(coinsStr) : 0;
      }

      if (custom) {
        const rId = rawId(context.postId!);
        const userKey = `color-guesser:custom:${rId}:${username}`;
        const progressStr = await redis.get(userKey);
        const progress: UserProgress = progressStr ? JSON.parse(progressStr) : { guesses: [], totalScore: 0, completed: false };
        return {
          colors: custom.colors,
          hints: custom.hints ?? custom.colors.map(() => ''),
          totalRounds: custom.colors.length,
          completedRounds: progress.guesses.filter(Boolean).length,
          totalScore: progress.totalScore,
          completed: progress.completed,
          date: null as string | null,
          postType: 'custom' as const,
          creatorUsername: custom.creator as string | null,
          customTitle: custom.title ?? null as string | null,
          inputMode: (custom.inputMode ?? 'slider') as 'slider' | 'wheel',
          userStats,
          coinBalance,
          username,
        };
      }

      const userKey = `color-guesser:${username}:${today}`;
      const progressStr = await redis.get(userKey);
      const progress: UserProgress = progressStr ? JSON.parse(progressStr) : { guesses: [], totalScore: 0, completed: false };

      return {
        colors: dailyPuzzle,
        hints: dailyPuzzle.map(() => ''),
        totalRounds: dailyPuzzle.length,
        completedRounds: progress.guesses.length,
        totalScore: progress.totalScore,
        completed: progress.completed,
        date: today as string | null,
        postType: 'daily' as const,
        creatorUsername: null as string | null,
        customTitle: null as string | null,
        inputMode: 'slider' as const,
        userStats,
        coinBalance,
        username,
      };
    }),

    submitGuess: publicProcedure
      .input(z.object({
        roundIndex: z.number().min(0).max(4),
        guessHex: z.string().startsWith('#'),
      }))
      .mutation(async ({ input }) => {
        const today = new Date().toISOString().split('T')[0]!;
        const username = context.username ?? null;
        const [custom, dailyPuzzle] = await Promise.all([
          getCustomColors(context.postId),
          getDailyColors(today),
        ]);

        let puzzle: PuzzleColor[];
        let userKey: string;
        const isCustom = !!custom;

        if (custom) {
          puzzle = custom.colors;
          userKey = `color-guesser:custom:${rawId(context.postId!)}:${username}`;
        } else {
          puzzle = dailyPuzzle;
          userKey = `color-guesser:${username}:${today}`;
        }

        if (input.roundIndex >= puzzle.length) throw new Error('Invalid round index');
        const actualColor = puzzle[input.roundIndex];
        if (!actualColor) throw new Error('Color not found');

        const score = calculateScore(actualColor.hex, input.guessHex);

        const progressStr = await redis.get(userKey);
        const progress: UserProgress = progressStr ? JSON.parse(progressStr) : { guesses: [], totalScore: 0, completed: false };

        if (progress.guesses[input.roundIndex]) throw new Error('Already guessed this round');

        progress.guesses[input.roundIndex] = { hex: input.guessHex, score, actualHex: actualColor.hex, actualName: actualColor.name };
        progress.totalScore = progress.guesses.reduce((sum, g) => sum + (g?.score ?? 0), 0);
        const wasCompleted = progress.completed;
        progress.completed = progress.guesses.filter(Boolean).length === puzzle.length;

        const expiry = new Date(Date.now() + (isCustom ? 30 : 2) * 24 * 3600 * 1000);
        await redis.set(userKey, JSON.stringify(progress), { expiration: expiry });

        if (!wasCompleted && progress.completed && username) {
          // Grant coins on first completion
          await redis.incrBy(`color-guesser:coins:${username}`, 50);

          // Stats update on every first completion — daily and custom combined
          const statsStr = await redis.hGet('color-guesser:stats', username);
          const prev = statsStr ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number }) : null;
          const next = prev
            ? { games: prev.games + 1, totalScore: prev.totalScore + progress.totalScore, bestScore: Math.max(prev.bestScore, progress.totalScore) }
            : { games: 1, totalScore: progress.totalScore, bestScore: progress.totalScore };
          await redis.hSet('color-guesser:stats', { [username]: JSON.stringify(next) });
          await bumpCgDaily(today, username, progress.totalScore);
          void updateUserFlair(username, { games: next.games, bestScore: next.bestScore, totalScore: next.totalScore });

          const monthKey = `color-guesser:plays:${today.slice(0, 7)}`;
          if (!isCustom) {
            // Daily leaderboard — first score only (submitGuess only runs on first play; replays bypass via replayMode)
            const lbKey = `color-guesser:lb:${today}`;
            await Promise.all([
              redis.zAdd(lbKey, { score: progress.totalScore, member: username }),
              redis.expire(lbKey, 3 * 24 * 3600),
              redis.zIncrBy('color-guesser:plays:alltime', username, 1),
              redis.zIncrBy(monthKey, username, 1),
              redis.expire(monthKey, 90 * 24 * 3600),
            ]);

            const alltimeKey = `color-guesser:lb:alltime`;
            const prevAlltime = await redis.zScore(alltimeKey, username);
            if (prevAlltime == null || progress.totalScore > prevAlltime) {
              await redis.zAdd(alltimeKey, { score: progress.totalScore, member: username });
            }
          } else {
            // Custom leaderboard per-post — !wasCompleted guards first-time-only
            const rId = rawId(context.postId!);
            const playMember = `${username}:${rId}`;
            const customDailyKey = `color-guesser:custom-plays:${today}`;
            const prevCustomBest = await redis.zScore('color-guesser:custom-best:alltime', username);
            await Promise.all([
              redis.zAdd(`color-guesser:custom-lb:${rId}`, { score: progress.totalScore, member: username }),
              redis.zAdd(customDailyKey, { score: progress.totalScore, member: playMember }),
              redis.expire(customDailyKey, 32 * 24 * 3600),
              redis.zAdd('color-guesser:custom-plays:alltime', { score: progress.totalScore, member: playMember }),
              redis.zIncrBy('color-guesser:plays:alltime', username, 1),
              redis.zIncrBy(monthKey, username, 1),
              redis.expire(monthKey, 90 * 24 * 3600),
              ...(prevCustomBest == null || progress.totalScore > prevCustomBest
                ? [redis.zAdd('color-guesser:custom-best:alltime', { score: progress.totalScore, member: username })]
                : []),
            ]);
          }

        }

        return {
          score,
          actualHex: actualColor.hex,
          actualName: actualColor.name,
          totalScore: progress.totalScore,
          roundsCompleted: progress.guesses.filter(Boolean).length,
          completed: progress.completed,
        };
      }),

    usePeek: publicProcedure.mutation(async () => {
      const username = context.username ?? null;
      if (!username) throw new Error('Not authenticated');
      const key = `color-guesser:coins:${username}`;
      const val = await redis.get(key);
      const balance = val ? parseInt(val) : 0;
      if (balance < 50) throw new Error('Insufficient coins');
      await redis.set(key, String(balance - 50));
      return { balance: balance - 50 };
    }),

    recordReplayStats: publicProcedure
      .input(z.object({
        totalScore: z.number().min(0).max(100),
        postType: z.enum(['daily', 'custom']),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        if (!username) return;
        const statsStr = await redis.hGet('color-guesser:stats', username);
        const prev = statsStr ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number }) : null;
        const next = prev
          ? { games: prev.games + 1, totalScore: prev.totalScore + input.totalScore, bestScore: Math.max(prev.bestScore, input.totalScore) }
          : { games: 1, totalScore: input.totalScore, bestScore: input.totalScore };
        const replayToday = new Date().toISOString().split('T')[0]!;
        const replayMonth = replayToday.slice(0, 7);
        const replayMonthKey = `color-guesser:plays:${replayMonth}`;
        await bumpCgDaily(replayToday, username, input.totalScore);
        await Promise.all([
          redis.hSet('color-guesser:stats', { [username]: JSON.stringify(next) }),
          redis.zIncrBy('color-guesser:plays:alltime', username, 1),
          redis.zIncrBy(replayMonthKey, username, 1),
          redis.expire(replayMonthKey, 90 * 24 * 3600),
        ]);
        void updateUserFlair(username, { games: next.games, bestScore: next.bestScore, totalScore: next.totalScore });

        // Backfill custom lb if user completed before this code was deployed
        if (input.postType === 'custom' && context.postId) {
          const rId = rawId(context.postId);
          const customLbKey = `color-guesser:custom-lb:${rId}`;
          const existing = await redis.zScore(customLbKey, username);
          if (existing == null) {
            await redis.zAdd(customLbKey, { score: input.totalScore, member: username });
          }
        }
      }),

    saveCustomColors: publicProcedure
      .input(z.object({
        colors: z.array(z.object({ name: z.string(), hex: z.string() })).length(5),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        const postId = context.postId;
        if (!postId) throw new Error('No post ID');
        const rId = rawId(postId);

        const metaStr = await redis.get(`color-guesser:custom-meta:${rId}`);
        const meta = metaStr ? (JSON.parse(metaStr) as { creator: string }) : null;
        if (!meta || meta.creator !== username) throw new Error('Not the creator');

        await redis.set(`color-guesser:custom:${rId}`, JSON.stringify({
          colors: input.colors,
          creator: username,
          createdAt: new Date().toISOString(),
        }));

        return { success: true };
      }),

    createCustomPuzzle: publicProcedure
      .input(z.object({
        colors: z.array(z.object({ name: z.string(), hex: z.string() })).length(5),
        hints: z.array(z.string().max(80)).length(5).optional(),
        title: z.string().max(100).optional(),
        inputMode: z.enum(['slider', 'wheel']).optional(),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        if (!username) throw new Error('Not logged in');

        const post = await createCustomPost(username, input.title);
        const rId = rawId(post.id);

        await Promise.all([
          redis.set(`color-guesser:custom:${rId}`, JSON.stringify({
            colors: input.colors,
            hints: input.hints ?? input.colors.map(() => ''),
            creator: username,
            title: input.title ?? '',
            inputMode: input.inputMode ?? 'slider',
            createdAt: new Date().toISOString(),
          })),
          redis.incrBy(`color-guesser:coins:${username}`, 50),
          redis.zIncrBy('color-guesser:creators:alltime', username, 1),
          redis.zIncrBy(`color-guesser:creators:daily:${new Date().toISOString().split('T')[0]}`, username, 1),
        ]);

        return { postUrl: `https://www.reddit.com/comments/${rId}` };
      }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        total: z.number().min(0).max(100),
        date: z.string().nullable(),
        rounds: z.array(z.object({ name: z.string(), score: z.number() })),
        customTitle: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        const postId = context.postId;
        if (!postId) throw new Error('No post ID available');

        const scoreEmoji = (s: number) => s >= 17 ? '🟩' : s >= 13 ? '🟨' : s >= 9 ? '🟧' : '🟥';

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(`**${input.total}/100**`);
        lines.push('');
        lines.push(input.rounds.map((r) => scoreEmoji(r.score)).join(''));

        const rawPostId = rawId(postId);
        const stickyId = await redis.get(`color-guesser:sticky:${rawPostId}`);
        const hasCustomText = input.text.trim().length > 0;

        if (hasCustomText || !stickyId) {
          const fullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;
          await reddit.submitComment({ id: fullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        if (username) await redis.incrBy(`color-guesser:coins:${username}`, 50);
        return { success: true };
      }),
  }),

  mastermind: t.router({
    getPuzzle: publicProcedure.query(async () => {
      const postId = context.postId;
      const username = context.username ?? null;
      const rawPostId = postId ? rawId(postId) : null;

      const postType = rawPostId ? await redis.get(`color-guesser:post-type:${rawPostId}`) : null;
      const isCustom = postType === 'mastermind-custom';
      const today = new Date().toISOString().split('T')[0]!;

      let poolColors: { name: string; hex: string }[];
      let secret: string[];
      let configured: boolean;
      let creator: string | null = null;
      let title: string | undefined;

      if (isCustom && rawPostId) {
        const customStr = await redis.get(`mastermind:custom:${rawPostId}`);
        if (!customStr) {
          return { configured: false, creator: null as string | null, isCustom: true, isCreatorOrMod: false, username: username ?? null, poolColors: [] as { name: string; hex: string }[], guesses: [] as { colors: string[]; greens: number; yellows: number }[], completed: false, won: false, secret: undefined as string[] | undefined, subredditName: context.subredditName ?? null, postId: rawPostId, title: undefined as string | undefined, streak: undefined as number | undefined, personalBest: undefined as number | undefined };
        }
        const custom = JSON.parse(customStr) as { poolColors: { name: string; hex: string }[]; secret: string[]; creator: string; title?: string };
        poolColors = custom.poolColors;
        secret = custom.secret;
        creator = custom.creator;
        title = custom.title;
        configured = true;
      } else {
        // Only a real daily post gets a snapshot backfilled — an unconfigured
        // post shouldn't write puzzle keys just because someone opened it.
        const mm = await resolveMastermindDaily(postType === 'mastermind-daily' ? rawPostId : null);
        poolColors = mm.poolColors;
        secret = mm.secret;
        configured = postType === 'mastermind-daily';
      }

      const progressKey = rawPostId && username ? `mastermind:progress:${rawPostId}:${username}` : null;
      const progressStr = progressKey ? await redis.get(progressKey) : null;
      const progress = progressStr
        ? JSON.parse(progressStr) as { guesses: { colors: string[]; greens: number; yellows: number }[]; completed: boolean; won: boolean }
        : { guesses: [] as { colors: string[]; greens: number; yellows: number }[], completed: false, won: false };

      const isCreatorOrMod = isCustom ? creator === username : await isCurrentUserMod();

      let puzzleStreak: number | undefined;
      let puzzlePb: number | undefined;
      if (!isCustom && progress.completed && progress.won && username) {
        const [streakStr, pbStr] = await Promise.all([
          redis.get(`mastermind:streak:${username}`),
          redis.get(`mastermind:pb:${username}`),
        ]);
        if (streakStr) {
          const sd = JSON.parse(streakStr) as { count: number; lastDate: string };
          if (sd.lastDate === today) puzzleStreak = sd.count;
        }
        puzzlePb = pbStr ? parseInt(pbStr) : undefined;
      }

      return {
        configured,
        creator,
        isCustom,
        isCreatorOrMod,
        username: username ?? null,
        poolColors,
        guesses: progress.guesses,
        completed: progress.completed,
        won: progress.won,
        secret: progress.completed ? secret : undefined,
        subredditName: context.subredditName ?? null,
        postId: rawPostId,
        title,
        streak: puzzleStreak,
        personalBest: puzzlePb,
      };
    }),

    getDistribution: publicProcedure.query(async () => {
      const postId = context.postId;
      if (!postId) return { dist: {} as Record<string, number>, total: 0 };
      const rawPostId = rawId(postId);
      // One hGetAll: the hash only holds bucket keys, so neither the post-type
      // lookup nor a per-bucket hGet fan-out is needed to build the chart.
      const raw = await redis.hGetAll(`mastermind:dist:${rawPostId}`);
      const dist: Record<string, number> = {};
      let total = 0;
      for (const [k, rawVal] of Object.entries(raw ?? {})) {
        const v = parseInt(rawVal ?? '0') || 0;
        if (v <= 0) continue;
        dist[k] = v;
        total += v;
      }
      return { dist, total };
    }),

    submitGuess: publicProcedure
      .input(z.object({ colors: z.array(z.string()).min(1) }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        const username = context.username ?? null;
        if (!postId || !username) throw new Error('Not authenticated');
        const rawPostId = rawId(postId);

        const postType = await redis.get(`color-guesser:post-type:${rawPostId}`);
        const isCustom = postType === 'mastermind-custom';
        // Guard before resolving: otherwise a guess aimed at some other game's
        // post would backfill Mastermind puzzle keys onto it.
        if (!isCustom && postType !== 'mastermind-daily') throw new Error('Not a Mastermind post');
        const { secretLen, maxGuesses } = mmConfig(isCustom);
        if (input.colors.length !== secretLen) throw new Error('Invalid guess length');
        const today = new Date().toISOString().split('T')[0]!;

        let secret: string[];
        // Daily scores are keyed to the puzzle's own date, not the wall clock, so
        // playing an archived post can't write into today's leaderboard.
        let puzzleDate = today;
        if (isCustom) {
          const customStr = await redis.get(`mastermind:custom:${rawPostId}`);
          if (!customStr) throw new Error('Puzzle not found');
          secret = (JSON.parse(customStr) as { secret: string[] }).secret;
        } else {
          const mm = await resolveMastermindDaily(rawPostId);
          secret = mm.secret;
          puzzleDate = mm.date;
        }

        const progressKey = `mastermind:progress:${rawPostId}:${username}`;
        const progressStr = await redis.get(progressKey);
        const progress = progressStr
          ? JSON.parse(progressStr) as { guesses: { colors: string[]; greens: number; yellows: number }[]; completed: boolean; won: boolean }
          : { guesses: [] as { colors: string[]; greens: number; yellows: number }[], completed: false, won: false };

        if (progress.completed) throw new Error('Already completed');

        const { greens, yellows } = getMastermindFeedback(secret, input.colors);
        const won = greens === secretLen;
        progress.guesses.push({ colors: input.colors, greens, yellows });

        const justCompleted = won || progress.guesses.length >= maxGuesses;
        if (justCompleted) { progress.completed = true; progress.won = won; }

        // Kept forever: a daily post is a permanent archive now that its code is
        // frozen, so a finished puzzle must still show your result years later.
        await redis.set(progressKey, JSON.stringify(progress));

        let completedStreak: number | undefined;
        let completedPb: number | undefined;

        if (justCompleted) {
          const bucket = won ? progress.guesses.length.toString() : 'failed';
          const distKey = `mastermind:dist:${rawPostId}`;
          const prev = await redis.hGet(distKey, bucket);
          await redis.hSet(distKey, { [bucket]: String((parseInt(prev ?? '0') || 0) + 1) });

          // Track global play counts
          await Promise.all([
            redis.incrBy(`mastermind:plays:${today}`, 1),
            redis.incrBy('mastermind:plays:alltime', 1),
            ...(isCustom ? [
              redis.incrBy(`mastermind:custom-plays:${today}`, 1),
              redis.incrBy('mastermind:custom-plays:alltime', 1),
            ] : []),
          ]);

          // Leaderboard: won = higher score = fewer guesses; failed = 0
          const lbScore = won ? maxGuesses + 1 - progress.guesses.length : 0;
          const lbKey = isCustom ? `mastermind:lb:custom:${rawPostId}` : `mastermind:lb:daily:${puzzleDate}`;
          const existingLb = await redis.zScore(lbKey, username);
          if (existingLb == null || lbScore > existingLb) {
            await redis.zAdd(lbKey, { score: lbScore, member: username });
          }

          // Per-user career stats (daily + custom combined)
          const statsStr = await redis.hGet('mastermind:stats', username);
          const stats = statsStr
            ? JSON.parse(statsStr) as { games: number; wins: number; totalGuesses: number; bestGuesses: number }
            : { games: 0, wins: 0, totalGuesses: 0, bestGuesses: Math.max(MASTERMIND_CONFIG.daily.maxGuesses, MASTERMIND_CONFIG.custom.maxGuesses) + 1 };
          stats.games += 1;
          stats.totalGuesses += progress.guesses.length; // failed games count as maxGuesses (all used)
          if (won) {
            stats.wins += 1;
            stats.bestGuesses = Math.min(stats.bestGuesses, progress.guesses.length);
          }
          await redis.hSet('mastermind:stats', { [username]: JSON.stringify(stats) });
          await bumpMmDaily(puzzleDate, username, won, progress.guesses.length);

          // Streak + personal best (daily, won only)
          if (!isCustom && won) {
            const streakStr = await redis.get(`mastermind:streak:${username}`);
            const streakData = streakStr ? JSON.parse(streakStr) as { count: number; lastDate: string } : null;
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0]!;
            let newCount: number;
            if (streakData?.lastDate === today) {
              newCount = streakData.count;
            } else if (streakData?.lastDate === yesterdayStr) {
              newCount = streakData.count + 1;
            } else {
              newCount = 1;
            }
            await redis.set(`mastermind:streak:${username}`, JSON.stringify({ count: newCount, lastDate: today }));
            completedStreak = newCount;

            const pbStr = await redis.get(`mastermind:pb:${username}`);
            const prevBest = pbStr ? parseInt(pbStr) : maxGuesses + 1;
            const newBest = Math.min(prevBest, progress.guesses.length);
            if (newBest < prevBest) await redis.set(`mastermind:pb:${username}`, String(newBest));
            completedPb = newBest;
          }
        }

        return {
          greens,
          yellows,
          completed: progress.completed,
          won: progress.won,
          secret: progress.completed ? secret : undefined,
          streak: completedStreak,
          personalBest: completedPb,
        };
      }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const postId = context.postId;
      if (!postId) return {
        isCustom: false, userGuesses: null as number | null, userSolved: false,
        personalBest: null as number | null, streak: null as number | null,
        bestGuesses: null as number | null, betterThanPct: null as number | null, totalPlayers: 0,
      };
      const rawPostId = rawId(postId);
      const postType = await redis.get(`color-guesser:post-type:${rawPostId}`);
      const isCustom = postType === 'mastermind-custom';
      const { maxGuesses } = mmConfig(isCustom);
      const today = new Date().toISOString().split('T')[0]!;

      const lbKey = isCustom
        ? `mastermind:lb:custom:${rawPostId}`
        : `mastermind:lb:daily:${(await resolveMastermindDaily(rawPostId)).date}`;
      const distKey = `mastermind:dist:${rawPostId}`;
      const distFields = [...Array.from({ length: maxGuesses }, (_, i) => String(i + 1)), 'failed'];

      const [lbSize, userLbScore, distValues, streakStr, pbStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.zScore(lbKey, username) : Promise.resolve(null),
        Promise.all(distFields.map(f => redis.hGet(distKey, f))),
        !isCustom && username ? redis.get(`mastermind:streak:${username}`) : Promise.resolve(null),
        !isCustom && username ? redis.get(`mastermind:pb:${username}`) : Promise.resolve(null),
      ]);

      // Best guesses among all players (highest lb score = fewest guesses)
      let bestGuesses: number | null = null;
      if (lbSize > 0) {
        const all = await redis.zRange(lbKey, 0, lbSize - 1, { by: 'rank' });
        const top = all.reverse()[0];
        if (top && top.score > 0) bestGuesses = maxGuesses + 1 - Math.round(top.score);
      }

      const userGuesses = userLbScore != null && userLbScore > 0 ? maxGuesses + 1 - Math.round(userLbScore) : null;
      const userSolved = userGuesses !== null;
      const personalBest: number | null = isCustom ? userGuesses : (pbStr ? parseInt(pbStr) : null);

      let streak: number | null = null;
      if (streakStr) {
        const sd = JSON.parse(streakStr) as { count: number; lastDate: string };
        if (sd.lastDate === today) streak = sd.count;
      }

      const dist: Record<string, number> = {};
      let totalPlayers = 0;
      distFields.forEach((f, i) => {
        const v = parseInt(distValues[i] ?? '0') || 0;
        if (v > 0) dist[f] = v;
        totalPlayers += v;
      });

      let betterThanPct: number | null = null;
      if (userSolved && userGuesses !== null && totalPlayers > 0) {
        let better = dist['failed'] ?? 0;
        for (let i = userGuesses + 1; i <= maxGuesses; i++) better += dist[String(i)] ?? 0;
        betterThanPct = Math.round((better / totalPlayers) * 100);
      }

      return { isCustom, userGuesses, userSolved, personalBest, streak, bestGuesses, betterThanPct, totalPlayers };
    }),

    getScoreboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const postId = context.postId;
      if (!postId) return {
        top: [] as { member: string; score: number }[], userRank: null as number | null, userScore: null as number | null,
        username, stats: null as { games: number; wins: number; totalGuesses: number; bestGuesses: number } | null,
        lbMode: 'daily' as const, dailyCount: 0, snoovatars: {} as Record<string, string>,
      };
      const rawPostId = rawId(postId);
      const postType = await redis.get(`color-guesser:post-type:${rawPostId}`);
      const isCustom = postType === 'mastermind-custom';

      const activeKey = isCustom
        ? `mastermind:lb:custom:${rawPostId}`
        : `mastermind:lb:daily:${(await resolveMastermindDaily(rawPostId)).date}`;
      const lbMode = isCustom ? ('custom' as const) : ('daily' as const);

      const size = await redis.zCard(activeKey);
      const dailyCount = isCustom ? 0 : size;
      const top = size > 0 ? (await redis.zRange(activeKey, 0, size - 1, { by: 'rank' })).reverse() : [];

      let userRank: number | null = null;
      let userScore: number | null = null;
      if (username) {
        const idx = top.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userScore = top[idx]!.score; }
        else { userScore = await redis.zScore(activeKey, username) ?? null; }
      }

      const statsStr = username ? await redis.hGet('mastermind:stats', username) : null;
      const stats = statsStr
        ? JSON.parse(statsStr) as { games: number; wins: number; totalGuesses: number; bestGuesses: number }
        : null;

      const avatarCandidates = [...new Set([...top.slice(0, 50).map(e => e.member), ...(username ? [username] : [])])];
      const avatarResults = await Promise.all(avatarCandidates.map(m => getAvatarUrl(m)));
      const snoovatars: Record<string, string> = {};
      avatarCandidates.forEach((m, i) => { if (avatarResults[i]) snoovatars[m] = avatarResults[i]!; });
      if (username && context.snoovatar) snoovatars[username] = context.snoovatar;

      return { top, userRank, userScore, username, stats, lbMode, dailyCount, snoovatars };
    }),

    // All-time global Mastermind leaderboard across all players (career stats).
    getGlobalScoreboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const all = await redis.hGetAll('mastermind:stats');

      type Entry = { member: string; games: number; wins: number; avgMoves: number | null; bestGuesses: number | null };
      const sentinel = Math.max(MASTERMIND_CONFIG.daily.maxGuesses, MASTERMIND_CONFIG.custom.maxGuesses) + 1;
      const entries: Entry[] = Object.entries(all ?? {}).map(([member, raw]) => {
        const s = JSON.parse(raw) as { games: number; wins: number; totalGuesses: number; bestGuesses: number };
        return {
          member,
          games: s.games,
          wins: s.wins,
          avgMoves: s.games > 0 ? Math.round((s.totalGuesses / s.games) * 100) / 100 : null,
          bestGuesses: s.bestGuesses < sentinel ? s.bestGuesses : null,
        };
      }).sort((a, b) => b.games - a.games);

      const snoovatars = await buildSnoovatars(entries.map(e => e.member), username);
      return { entries, username, snoovatars };
    }),

    // Mastermind global leaderboard over an explicit date range.
    getGlobalScoreboardRange: publicProcedure
      .input(z.object({ start: z.string(), end: z.string() }))
      .query(async ({ input }) => {
        const username = context.username ?? null;
        const dates = rangeDates(input.start, input.end);

        type Entry = { member: string; games: number; wins: number; avgMoves: number | null; bestGuesses: number | null };
        const agg = new Map<string, { games: number; wins: number; totalGuesses: number }>();
        const buckets = await Promise.all(dates.map(d => redis.hGetAll(`mastermind:daily-stats:${d}`)));
        for (const bucket of buckets) {
          for (const [member, raw] of Object.entries(bucket ?? {})) {
            const s = JSON.parse(raw) as { games: number; wins: number; totalGuesses: number };
            const cur = agg.get(member) ?? { games: 0, wins: 0, totalGuesses: 0 };
            cur.games += s.games; cur.wins += s.wins; cur.totalGuesses += s.totalGuesses;
            agg.set(member, cur);
          }
        }
        const entries: Entry[] = [...agg.entries()]
          .filter(([, s]) => s.games >= 1)
          .map(([member, s]) => ({
            member,
            games: s.games,
            wins: s.wins,
            avgMoves: s.games > 0 ? Math.round((s.totalGuesses / s.games) * 100) / 100 : null,
            bestGuesses: null,
          }))
          .sort((a, b) => b.games - a.games);

        const snoovatars = await buildSnoovatars(entries.map(e => e.member), username);
        return { entries, username, snoovatars };
      }),

    getAnalytics: publicProcedure.query(async () => {
      const postId = context.postId;
      if (!postId) throw new Error('No post');
      const rawPostId = rawId(postId);
      const username = context.username ?? null;
      const postType = await redis.get(`color-guesser:post-type:${rawPostId}`);
      const isCustom = postType === 'mastermind-custom';

      let authorized = await isCurrentUserMod();
      if (!authorized && isCustom && username) {
        const customStr = await redis.get(`mastermind:custom:${rawPostId}`);
        if (customStr) {
          const custom = JSON.parse(customStr) as { creator: string };
          authorized = custom.creator === username;
        }
      }
      if (!authorized) throw new Error('Not authorized');

      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }

      const distKey = `mastermind:dist:${rawPostId}`;
      const distFields = [...Array.from({ length: mmConfig(isCustom).maxGuesses }, (_, i) => String(i + 1)), 'failed'];

      // Custom posts show this-puzzle plays alongside all-custom-mastermind totals;
      // daily posts show the global daily-puzzle totals.
      const playsPrefix = isCustom ? 'mastermind:custom-plays:' : 'mastermind:plays:';
      const alltimeKey = isCustom ? 'mastermind:custom-plays:alltime' : 'mastermind:plays:alltime';

      const [dayCounts, alltimeRaw, distValues] = await Promise.all([
        Promise.all(dates.map(d => redis.get(`${playsPrefix}${d}`).then(v => parseInt(v ?? '0') || 0))),
        redis.get(alltimeKey),
        Promise.all(distFields.map(f => redis.hGet(distKey, f))),
      ]);

      const thisPostPlays = distValues.reduce((sum, v) => sum + (parseInt(v ?? '0') || 0), 0);
      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));

      return {
        perDay,
        thisPostPlays,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + b, 0),
        monthTotal: dayCounts.reduce((a, b) => a + b, 0),
        alltimeCount: parseInt(alltimeRaw ?? '0') || 0,
      };
    }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        won: z.boolean(),
        guessCount: z.number(),
        emojiGrid: z.string(),
        isCustom: z.boolean(),
        title: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        const username = context.username;
        if (!postId || !username) throw new Error('Not authenticated');
        const rawPostId = rawId(postId);

        const titleLine = input.isCustom
          ? `The Rescue${input.title ? ` — ${input.title}` : ''}`
          : 'The Rescue — Daily';
        const { maxGuesses } = mmConfig(input.isCustom);
        const resultLine = input.won
          ? `Freed in **${input.guessCount}/${maxGuesses}** 🔒`
          : `Not freed (**X/${maxGuesses}**) 🔒`;

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(titleLine);
        lines.push(resultLine);
        lines.push('');
        lines.push(input.emojiGrid);

        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;
        const hasCustomText = input.text.trim().length > 0;

        if (hasCustomText) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const stickyKey = `mastermind:sticky:${rawPostId}`;
          let stickyId = await redis.get(stickyKey);
          if (!stickyId) {
            try {
              const sticky = await reddit.submitComment({
                id: postFullId,
                text: '**Score Thread** — Share your rescue results here!',
                runAs: 'APP',
              });
              await sticky.distinguish(true);
              stickyId = sticky.id;
              await redis.set(stickyKey, stickyId);
            } catch {
              await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
              return { success: true };
            }
          }
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),

    createCustomPuzzle: publicProcedure
      .input(z.object({
        poolColors: z.array(z.object({ name: z.string(), hex: z.string() })).length(MASTERMIND_CONFIG.custom.poolSize),
        secret: z.array(z.string()).length(MASTERMIND_CONFIG.custom.secretLen),
        title: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        const subredditName = context.subredditName;
        if (!username) throw new Error('Not authenticated');
        if (!subredditName) throw new Error('No subreddit');

        const poolHexes = new Set(input.poolColors.map(c => c.hex));
        if (!input.secret.every(h => poolHexes.has(h))) throw new Error('Secret colors must be in pool');

        const postTitle = input.title?.trim()
          ? `${input.title.trim()} — Crack the Code by u/${username}`
          : `Crack the Code by u/${username}`;

        const post = await reddit.submitCustomPost({
          subredditName,
          title: postTitle,
          runAs: 'USER',
          userGeneratedContent: { text: input.title?.trim() || postTitle },
        });
        const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

        await redis.set(`color-guesser:post-type:${rawPostId}`, 'mastermind-custom');
        await redis.set(`mastermind:custom:${rawPostId}`, JSON.stringify({
          poolColors: input.poolColors,
          secret: input.secret,
          creator: username,
          title: input.title,
        }));
        await redis.zIncrBy('mastermind:creators:alltime', username, 1);
        await redis.zIncrBy(`mastermind:creators:daily:${new Date().toISOString().split('T')[0]}`, username, 1);

        return { postUrl: `https://www.reddit.com/r/${subredditName}/comments/${rawPostId}/` };
      }),
  }),
  palettePoet: t.router({
    createPuzzle: publicProcedure
      .input(z.object({
        title: z.string().max(100),
        colors: z.array(z.object({
          hex: z.string().startsWith('#'),
          name: z.string().min(1).max(80),
          description: z.string().max(200),
        })).min(PP_MIN_ROUNDS).max(PP_MAX_ROUNDS),
      }))
      .mutation(async ({ input }) => {
        const username = context.username;
        if (!username) throw new Error('Not logged in');
        const subredditName = context.subredditName;
        if (!subredditName) throw new Error('No subreddit');

        const postTitle = input.title.trim()
          ? `${input.title.trim()} — Palette Poet by u/${username}`
          : `Palette Poet by u/${username}`;

        const post = await reddit.submitCustomPost({
          subredditName,
          title: postTitle,
          runAs: 'USER',
          userGeneratedContent: { text: input.title.trim() || postTitle },
        });
        const rId = rawId(post.id);
        const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;

        await Promise.all([
          redis.set(`color-guesser:post-type:${rId}`, 'palette-poet'),
          redis.set(`palette-poet:puzzle:${rId}`, JSON.stringify({
            creator: username,
            title: input.title.trim(),
            colors: input.colors,
            createdAt: new Date().toISOString(),
          })),
          redis.set(`palette-poet:founders:${rId}`, JSON.stringify([])),
        ]);

        void (async () => {
          try {
            const sticky = await reddit.submitComment({
              id: postFullId,
              text: `**Palette Poet by u/${username}** — Guess the colors from the names! Play to claim a spot on the grid.`,
              runAs: 'APP',
            });
            await sticky.distinguish(true);
            await redis.set(`color-guesser:sticky:${rId}`, sticky.id);
          } catch (e) { console.error('palette-poet sticky failed:', e); }
        })();

        return { postUrl: `https://www.reddit.com/r/${subredditName}/comments/${rId}` };
      }),

    getSplashData: publicProcedure.query(async () => {
      const postId = context.postId;
      const username = context.username ?? null;
      if (!postId) return null;
      const rId = rawId(postId);

      const puzzleStr = await redis.get(`palette-poet:puzzle:${rId}`);
      if (!puzzleStr) return null;
      const puzzle = JSON.parse(puzzleStr) as { creator: string; title: string; colors?: { hex: string; name: string; description: string }[] };

      const unlockThreshold = context.subredditName === 'cg_dev_2' ? 1 : 4;

      const lbKey = `palette-poet:lb:${rId}`;

      // Auto-heal: if user has completed progress but isn't in leaderboard, add them
      if (username) {
        const progressStr = await redis.get(`palette-poet:progress:${rId}:${username}`);
        if (progressStr) {
          const progress = JSON.parse(progressStr) as { guesses: ({ hex: string; score: number } | null)[]; totalScore: number; completed: boolean };
          if (progress.completed) {
            const existing = await redis.zScore(lbKey, username);
            if (existing == null) {
              await redis.zAdd(lbKey, { score: progress.totalScore, member: username });
              const foundersStr2 = await redis.get(`palette-poet:founders:${rId}`);
              const founders2: string[] = foundersStr2 ? JSON.parse(foundersStr2) : [];
              if (founders2.length < 4 && !founders2.includes(username)) {
                founders2.push(username);
                await redis.set(`palette-poet:founders:${rId}`, JSON.stringify(founders2));
              }
            }
          }
        }
      }

      const totalPlayers = await redis.zCard(lbKey);

      const top16Raw = totalPlayers > 0
        ? (await redis.zRange(lbKey, 0, totalPlayers - 1, { by: 'rank' })).reverse().slice(0, 16)
        : [];

      const foundersStr = await redis.get(`palette-poet:founders:${rId}`);
      const founders: string[] = foundersStr ? JSON.parse(foundersStr) : [];

      const top16 = top16Raw.map(e => ({
        username: e.member,
        score: e.score,
        isFounder: founders.includes(e.member),
      }));

      let avgScore: number | null = null;
      let creatorLabel: string | null = null;
      if (totalPlayers >= unlockThreshold) {
        const allRaw = totalPlayers > 0
          ? await redis.zRange(lbKey, 0, totalPlayers - 1, { by: 'rank' })
          : [];
        const sum = allRaw.reduce((s, e) => s + e.score, 0);
        avgScore = Math.round(sum / allRaw.length);
        creatorLabel = getCreatorLabel(avgScore);
      }

      let userScore: number | null = null;
      let userRank: number | null = null;
      if (username) {
        const s = await redis.zScore(lbKey, username);
        userScore = s ?? null;
        if (userScore != null) {
          const rankAsc = await redis.zRank(lbKey, username);
          userRank = rankAsc != null ? totalPlayers - rankAsc : null;
        }
      }

      const avatarCandidates = [...new Set([puzzle.creator, ...top16.map(e => e.username)])];
      const avatarResults = await Promise.all(avatarCandidates.map(m => getAvatarUrl(m)));
      const snoovatars: Record<string, string> = {};
      avatarCandidates.forEach((m, i) => { if (avatarResults[i]) snoovatars[m] = avatarResults[i]!; });
      if (username && context.snoovatar) snoovatars[username] = context.snoovatar;

      const creatorAvatar = snoovatars[puzzle.creator] ?? null;

      return {
        title: puzzle.title,
        creator: puzzle.creator,
        creatorAvatar,
        avgScore,
        creatorLabel,
        playerCount: totalPlayers,
        top16,
        userScore,
        userRank,
        username,
        userAvatar: context.snoovatar ?? null,
        snoovatars,
        unlockThreshold,
        // Shuffled independently so the payload itself never reveals name→color.
        paletteColors: seededShuffle((puzzle.colors ?? []).map(c => c.hex), `c${rId}`),
        paletteNames: seededShuffle((puzzle.colors ?? []).map(c => c.name), `n${rId}`),
      };
    }),

    getGame: publicProcedure.query(async () => {
      const postId = context.postId;
      const username = context.username ?? null;
      if (!postId) throw new Error('No post ID');
      const rId = rawId(postId);

      const puzzleStr = await redis.get(`palette-poet:puzzle:${rId}`);
      if (!puzzleStr) throw new Error('Puzzle not found');
      const puzzle = JSON.parse(puzzleStr) as { creator: string; title: string; colors: { hex: string; name: string; description: string }[] };

      const progressStr = username ? await redis.get(`palette-poet:progress:${rId}:${username}`) : null;
      const progress = progressStr
        ? JSON.parse(progressStr) as { guesses: ({ hex: string; score: number } | null)[]; totalScore: number; completed: boolean }
        : { guesses: [] as ({ hex: string; score: number } | null)[], totalScore: 0, completed: false };

      const lbKey = `palette-poet:lb:${rId}`;
      const totalPlayers = await redis.zCard(lbKey);
      let userRank: number | null = null;
      if (username && progress.completed) {
        const rankAsc = await redis.zRank(lbKey, username);
        userRank = rankAsc != null ? totalPlayers - rankAsc : null;
      }

      return {
        title: puzzle.title,
        creator: puzzle.creator,
        colors: puzzle.colors,
        completedRounds: progress.guesses.filter(Boolean).length,
        totalScore: progress.totalScore,
        completed: progress.completed,
        guesses: progress.guesses,
        totalPlayers,
        userRank,
      };
    }),

    submitGuess: publicProcedure
      .input(z.object({
        roundIndex: z.number().min(0).max(4),
        guessHex: z.string().startsWith('#'),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        const username = context.username ?? null;
        if (!postId || !username) throw new Error('Not authenticated');
        const rId = rawId(postId);

        const puzzleStr = await redis.get(`palette-poet:puzzle:${rId}`);
        if (!puzzleStr) throw new Error('Puzzle not found');
        const puzzle = JSON.parse(puzzleStr) as { colors: { hex: string; name: string; description: string }[] };

        const actualColor = puzzle.colors[input.roundIndex];
        if (!actualColor) throw new Error('Invalid round');

        const score = calculateScore(actualColor.hex, input.guessHex, ppRoundMax(puzzle.colors.length, input.roundIndex));

        const progressKey = `palette-poet:progress:${rId}:${username}`;
        const progressStr = await redis.get(progressKey);
        const progress = progressStr
          ? JSON.parse(progressStr) as { guesses: ({ hex: string; score: number } | null)[]; totalScore: number; completed: boolean }
          : { guesses: [] as ({ hex: string; score: number } | null)[], totalScore: 0, completed: false };

        if (progress.guesses[input.roundIndex]) throw new Error('Already guessed');

        progress.guesses[input.roundIndex] = { hex: input.guessHex, score };
        progress.totalScore = progress.guesses.reduce((s, g) => s + (g?.score ?? 0), 0);
        const wasCompleted = progress.completed;
        progress.completed = progress.guesses.filter(Boolean).length === puzzle.colors.length;

        await redis.set(progressKey, JSON.stringify(progress), { expiration: new Date(Date.now() + 30 * 24 * 3600 * 1000) });

        if (!wasCompleted && progress.completed) {
          const lbKey = `palette-poet:lb:${rId}`;
          const existing = await redis.zScore(lbKey, username);
          if (existing == null) {
            await redis.zAdd(lbKey, { score: progress.totalScore, member: username });

            const foundersStr = await redis.get(`palette-poet:founders:${rId}`);
            const founders: string[] = foundersStr ? JSON.parse(foundersStr) : [];
            if (founders.length < 4 && !founders.includes(username)) {
              founders.push(username);
              await redis.set(`palette-poet:founders:${rId}`, JSON.stringify(founders));
            }

            const today = new Date().toISOString().split('T')[0]!;
            const monthKey = `palette-poet:plays:${today.slice(0, 7)}`;
            await Promise.all([
              redis.zAdd(`palette-poet:daily:${today}`, { score: progress.totalScore, member: username }),
              redis.expire(`palette-poet:daily:${today}`, 32 * 24 * 3600),
              redis.zIncrBy('palette-poet:plays:alltime', username, 1),
              redis.zIncrBy(monthKey, username, 1),
              redis.expire(monthKey, 90 * 24 * 3600),
            ]);
          }
        }

        return { score, actualHex: actualColor.hex, actualName: actualColor.name, totalScore: progress.totalScore, completed: progress.completed };
      }),

    saveScore: publicProcedure
      .input(z.object({ totalScore: z.number().int().min(0).max(100) }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        const username = context.username ?? null;
        if (!postId || !username) return;
        const rId = rawId(postId);
        const lbKey = `palette-poet:lb:${rId}`;
        const existing = await redis.zScore(lbKey, username);
        if (existing == null) {
          await redis.zAdd(lbKey, { score: input.totalScore, member: username });
          const foundersStr = await redis.get(`palette-poet:founders:${rId}`);
          const founders: string[] = foundersStr ? JSON.parse(foundersStr) : [];
          if (founders.length < 4 && !founders.includes(username)) {
            founders.push(username);
            await redis.set(`palette-poet:founders:${rId}`, JSON.stringify(founders));
          }
        }
      }),

    syncScore: publicProcedure.mutation(async () => {
      const postId = context.postId;
      const username = context.username ?? null;
      if (!postId || !username) return;
      const rId = rawId(postId);
      const progressStr = await redis.get(`palette-poet:progress:${rId}:${username}`);
      if (!progressStr) return;
      const progress = JSON.parse(progressStr) as { guesses: ({ hex: string; score: number } | null)[]; totalScore: number; completed: boolean };
      if (!progress.completed) return;
      const lbKey = `palette-poet:lb:${rId}`;
      const existing = await redis.zScore(lbKey, username);
      if (existing == null) {
        await redis.zAdd(lbKey, { score: progress.totalScore, member: username });
        const foundersStr = await redis.get(`palette-poet:founders:${rId}`);
        const founders: string[] = foundersStr ? JSON.parse(foundersStr) : [];
        if (founders.length < 4 && !founders.includes(username)) {
          founders.push(username);
          await redis.set(`palette-poet:founders:${rId}`, JSON.stringify(founders));
        }
      }
    }),

    getLeaderboard: publicProcedure.query(async () => {
      const postId = context.postId;
      const username = context.username ?? null;
      if (!postId) return { entries: [] as { member: string; score: number; rank: number; isFounder: boolean }[], userRank: null as number | null, userScore: null as number | null, username, totalPlayers: 0, snoovatars: {} as Record<string, string> };
      const rId = rawId(postId);
      const lbKey = `palette-poet:lb:${rId}`;

      const totalPlayers = await redis.zCard(lbKey);
      const allRaw = totalPlayers > 0
        ? (await redis.zRange(lbKey, 0, totalPlayers - 1, { by: 'rank' })).reverse()
        : [];

      const foundersStr = await redis.get(`palette-poet:founders:${rId}`);
      const founders: string[] = foundersStr ? JSON.parse(foundersStr) : [];

      const entries = allRaw.map((e, i) => ({ member: e.member, score: e.score, rank: i + 1, isFounder: founders.includes(e.member) }));

      let userRank: number | null = null;
      let userScore: number | null = null;
      if (username) {
        const idx = entries.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userScore = entries[idx]!.score; }
        else { const s = await redis.zScore(lbKey, username); userScore = s ?? null; }
      }

      const avatarCandidates = [...new Set([...entries.slice(0, 50).map(e => e.member), ...(username ? [username] : [])])];
      const avatarResults = await Promise.all(avatarCandidates.map(m => getAvatarUrl(m)));
      const snoovatars: Record<string, string> = {};
      avatarCandidates.forEach((m, i) => { if (avatarResults[i]) snoovatars[m] = avatarResults[i]!; });
      if (username && context.snoovatar) snoovatars[username] = context.snoovatar;

      return { entries, userRank, userScore, username, totalPlayers, snoovatars };
    }),

    postComment: publicProcedure
      .input(z.object({
        total: z.number().min(0).max(100),
        rounds: z.array(z.object({ name: z.string(), score: z.number() })),
        text: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        const username = context.username;
        if (!postId) throw new Error('No post ID');
        const rId = rawId(postId);

        const puzzleStr = await redis.get(`palette-poet:puzzle:${rId}`);
        const puzzle = puzzleStr ? JSON.parse(puzzleStr) as { creator: string; title: string } : null;

        const lbKey = `palette-poet:lb:${rId}`;
        const totalPlayers = await redis.zCard(lbKey);
        const userRankAsc = username ? await redis.zRank(lbKey, username) : null;
        const userRank = userRankAsc != null ? totalPlayers - userRankAsc : null;

        const scoreEmoji = (frac: number) => frac >= 0.85 ? '🟩' : frac >= 0.65 ? '🟨' : frac >= 0.45 ? '🟧' : '🟥';
        const lines: string[] = [];
        if (input.text?.trim()) { lines.push(input.text.trim()); lines.push(''); }
        if (puzzle) lines.push(`**Palette Poet:** ${puzzle.title} by u/${puzzle.creator}`);
        lines.push('');
        lines.push(`**${input.total}/100**${userRank ? ` · Rank #${userRank} of ${totalPlayers}` : ''}`);
        lines.push('');
        lines.push(input.rounds.map((r, i) => scoreEmoji(ppScoreFrac(r.score, ppRoundMax(input.rounds.length, i)))).join(''));

        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;
        const stickyId = await redis.get(`color-guesser:sticky:${rId}`);
        if (input.text?.trim() || !stickyId) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),

    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }
      const postId = context.postId;
      const rId = postId ? rawId(postId) : null;
      const [dayCounts, alltimeCount, thisPostPlays] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(`palette-poet:daily:${d}`))),
        redis.zCard('palette-poet:plays:alltime'),
        rId ? redis.zCard(`palette-poet:lb:${rId}`) : Promise.resolve(0),
      ]);
      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));
      return {
        perDay,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
        thisPostPlays,
      };
    }),
  }),
  flag: t.router({
    getPuzzle: publicProcedure.query(async () => {
      const { date: today, rounds: puzzle } = await resolveFlagPuzzle();
      const username = context.username ?? null;
      const gauntlet = context.postId
        ? (await redis.get(`flag:gauntlet:${rawId(context.postId)}`)) === '1'
        : false;

      const progressStr = username ? await redis.get(`flag:progress:${username}:${today}`) : null;
      const progress = progressStr
        ? JSON.parse(progressStr) as { guesses: ({ hex: string; score: number; actualHex: string } | null)[]; totalScore: number; completed: boolean }
        : { guesses: [] as ({ hex: string; score: number; actualHex: string } | null)[], totalScore: 0, completed: false };

      return {
        rounds: puzzle.map(r => ({
          flagName: r.flag.name,
          svg: r.flag.svg,
          hiddenHex: r.hiddenHex,
          wrongHex: r.wrongHex,
          hiddenIdx: r.hiddenIdx,
        })),
        completedRounds: progress.guesses.filter(Boolean).length,
        totalScore: progress.totalScore,
        completed: progress.completed,
        date: today,
        username,
        gauntlet,
      };
    }),

    submitGuess: publicProcedure
      .input(z.object({
        roundIndex: z.number().min(0).max(4),
        guessHex: z.string().startsWith('#'),
      }))
      .mutation(async ({ input }) => {
        const { date: today, rounds: puzzle } = await resolveFlagPuzzle();
        const username = context.username ?? null;
        if (!username) throw new Error('Not authenticated');

        const round = puzzle[input.roundIndex];
        if (!round) throw new Error('Invalid round index');

        const toLab = (hex: string): [number, number, number] => {
          const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
          const lin = (c: number) => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
          const [rl, gl, bl] = [lin(r), lin(g), lin(b)];
          const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
          const y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / 1.00000;
          const z2 = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
          const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
          return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z2))];
        };
        const [l1, a1, b1] = toLab(round.hiddenHex);
        const [l2, a2, b2] = toLab(input.guessHex);
        const de = Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
        const score = Math.min(20, Math.max(0, Math.round((1 - Math.min(de, 100) / 100) * 20)));

        const userKey = `flag:progress:${username}:${today}`;
        const progressStr = await redis.get(userKey);
        const progress = progressStr
          ? JSON.parse(progressStr) as { guesses: ({ hex: string; score: number; actualHex: string } | null)[]; totalScore: number; completed: boolean }
          : { guesses: [] as ({ hex: string; score: number; actualHex: string } | null)[], totalScore: 0, completed: false };

        if (progress.guesses[input.roundIndex]) throw new Error('Already guessed this round');

        progress.guesses[input.roundIndex] = { hex: input.guessHex, score, actualHex: round.hiddenHex };
        progress.totalScore = progress.guesses.reduce((sum, g) => sum + (g?.score ?? 0), 0);
        const wasCompleted = progress.completed;
        progress.completed = progress.guesses.filter(Boolean).length === puzzle.length;

        await redis.set(userKey, JSON.stringify(progress), { expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000) });

        if (!wasCompleted && progress.completed && username) {
          const lbKey = `flag:lb:${today}`;
          const alltimeKey = 'flag:lb:alltime';
          await Promise.all([
            redis.zAdd(lbKey, { score: progress.totalScore, member: username }),
            redis.expire(lbKey, 3 * 24 * 3600),
          ]);
          const prevAlltime = await redis.zScore(alltimeKey, username);
          if (prevAlltime == null || progress.totalScore > prevAlltime) {
            await redis.zAdd(alltimeKey, { score: progress.totalScore, member: username });
          }

          const statsStr = await redis.hGet('flag:stats', username);
          const s = statsStr
            ? JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number }
            : { games: 0, totalScore: 0, bestScore: 0 };
          s.games += 1;
          s.totalScore += progress.totalScore;
          s.bestScore = Math.max(s.bestScore, progress.totalScore);
          await redis.hSet('flag:stats', { [username]: JSON.stringify(s) });
        }

        return { score, actualHex: round.hiddenHex, totalScore: progress.totalScore, completed: progress.completed };
      }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        total: z.number().min(0).max(100),
        rounds: z.array(z.object({ flagName: z.string(), score: z.number() })),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        if (!postId) throw new Error('No post ID');

        const scoreEmoji = (s: number) => s >= 17 ? '🟩' : s >= 13 ? '🟨' : s >= 9 ? '🟧' : '🟥';
        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(`**Flag ColorGuessr — ${input.total}/100**`);
        lines.push('');
        lines.push(input.rounds.map(r => scoreEmoji(r.score)).join(''));

        const rawPostId = rawId(postId);
        const stickyId = await redis.get(`flag:sticky:${rawPostId}`);
        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;

        if (input.text.trim() || !stickyId) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const { date: today } = await resolveFlagPuzzle();
      const lbKey = `flag:lb:${today}`;
      const dc = await redis.zCard(lbKey);
      const activeKey = lbKey;
      const size = await redis.zCard(activeKey);
      const top = size > 0 ? (await redis.zRange(activeKey, 0, size - 1, { by: 'rank' })).reverse() : [];
      let userRank: number | null = null;
      let userScore: number | null = null;
      if (username) {
        const idx = top.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userScore = top[idx]!.score; }
        else { userScore = await redis.zScore(activeKey, username) ?? null; }
      }

      const statsStr = username ? await redis.hGet('flag:stats', username) : null;
      const stats = statsStr
        ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number })
        : null;

      const avatarCandidates = [...new Set([...top.slice(0, 50).map(e => e.member), ...(username ? [username] : [])])];
      const avatarResults = await Promise.all(avatarCandidates.map(m => getAvatarUrl(m)));
      const snoovatars: Record<string, string> = {};
      avatarCandidates.forEach((m, i) => { if (avatarResults[i]) snoovatars[m] = avatarResults[i]!; });
      if (username && context.snoovatar) snoovatars[username] = context.snoovatar;

      return { top, userRank, userScore, username, stats, dailyCount: dc, snoovatars, lbMode: 'daily' as 'alltime' | 'daily' };
    }),

    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }
      const [dayCounts, alltimeCount] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(`flag:lb:${d}`))),
        redis.zCard('flag:lb:alltime'),
      ]);
      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));
      return {
        perDay,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
      };
    }),

    getSplashPlayers: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const { date: today, rounds: puzzleRounds } = await resolveFlagPuzzle();
      const lbKey = `flag:lb:${today}`;
      const alltimeKey = 'flag:lb:alltime';
      const [dailyCount, alltimeCount] = await Promise.all([redis.zCard(lbKey), redis.zCard(alltimeKey)]);
      const totalPlayers = Math.max(dailyCount, alltimeCount);

      const pull = async (key: string, n: number) => {
        const size = await redis.zCard(key);
        if (size === 0) return [];
        return (await redis.zRange(key, Math.max(0, size - n), size - 1, { by: 'rank' })).reverse();
      };
      const top = await pull(lbKey, 20);
      top.push(...(await pull(alltimeKey, 20)));

      // First 6 players that actually have a snoovatar (skip avatar-less players).
      const candidates = [...new Set(top.map(e => e.member))].slice(0, 20);
      const avatarResults = await Promise.all(candidates.map(m => getAvatarUrl(m)));
      const players = candidates
        .map((m, i) => ({ username: m, avatar: avatarResults[i] ?? null }))
        .filter((p): p is { username: string; avatar: string } => !!p.avatar)
        .slice(0, 6);

      const viewerAvatar = context.snoovatar ?? (username ? (await getAvatarUrl(username)) ?? null : null);

      const flags = puzzleRounds.map(r => ({
        name: r.flag.name,
        svg: r.flag.svg,
      }));

      const topPlayer = top[0]
        ? { username: top[0].member, score: Math.round(top[0].score), avatar: (await getAvatarUrl(top[0].member)) ?? null }
        : null;

      return { players, totalPlayers, dailyCount, username, viewerAvatar, flags, topPlayer };
    }),
  }),
  memory: t.router({
    // Intro/start data for the daily Run.
    getRun: publicProcedure.query(async () => {
      const ctx = await resolveMemoryCtx();
      const { keyBase, seedDate, variant } = ctx;
      const username = context.username ?? null;
      const palette = getDailyPalette(seedDate, variant);
      const lbKey = `memory:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`memory:daily:${keyBase}:${username}`) : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as { score: number; reachedStack: number; failed: boolean } : null;

      let topPct: number | null = null;
      let userRank: number | null = null;
      if (official && username && playerCount > 0) {
        const rankAsc = await redis.zRank(lbKey, username);
        if (rankAsc != null) {
          userRank = playerCount - rankAsc;
          topPct = Math.max(1, Math.round((userRank / playerCount) * 100));
        }
      }

      return {
        palette,
        config: MEMORY_CONFIG,
        alreadyPlayed: !!official,
        best: official,
        topPct,
        userRank,
        playerCount,
        date: seedDate,
        label: ctx.label,
        username,
      };
    }),

    getSplash: publicProcedure.query(async () => {
      const { keyBase, seedDate, variant, label } = await resolveMemoryCtx();
      const username = context.username ?? null;
      const palette = getDailyPalette(seedDate, variant);
      const lbKey = `memory:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`memory:daily:${keyBase}:${username}`) : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as { score: number; reachedStack: number } : null;

      let topPlayer: { username: string; score: number; reachedStack: number; avatar: string | null } | null = null;
      if (playerCount > 0) {
        const topArr = await redis.zRange(lbKey, playerCount - 1, playerCount - 1, { by: 'rank' });
        const t = topArr[0];
        if (t) {
          const avatar = t.member === context.username && context.snoovatar ? context.snoovatar : (await getAvatarUrl(t.member)) ?? null;
          topPlayer = { username: t.member, score: Math.floor(t.score / 1e5), reachedStack: 0, avatar };
        }
      }

      return {
        palette: palette.map(c => c.hex),
        playerCount,
        alreadyPlayed: !!official,
        best: official,
        topPlayer,
        label,
        username,
        viewerAvatar: context.snoovatar ?? null,
      };
    }),

    // Start (or restart) a run. Returns the first stack to memorize.
    beginRun: publicProcedure.mutation(async () => {
      const { keyBase, seedDate, variant } = await resolveMemoryCtx();
      const username = context.username ?? null;
      if (!username) throw new Error('Not authenticated');

      const official = await redis.get(`memory:daily:${keyBase}:${username}`);
      const counts = !official; // only the very first run counts toward the leaderboard

      const size = MEMORY_CONFIG.startSize;
      const runKey = `memory:run:${keyBase}:${username}`;
      await redis.set(runKey, JSON.stringify({ nextSize: size, phase: 'memorizing', counts }), {
        expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      });

      return { size, sequence: getStackSequence(seedDate, size, variant), memorizeMs: memorizeMs(size), counts };
    }),

    // Submit the recreated stack. Server verifies against the seed truth.
    submitStack: publicProcedure
      .input(z.object({ size: z.number().int().min(6).max(15), answer: z.array(z.number().int().min(0).max(7)) }))
      .mutation(async ({ input }) => {
        const { keyBase, seedDate, variant, isBonus } = await resolveMemoryCtx();
        const username = context.username ?? null;
        if (!username) throw new Error('Not authenticated');

        const runKey = `memory:run:${keyBase}:${username}`;
        const runStr = await redis.get(runKey);
        if (!runStr) throw new Error('No active run');
        const run = JSON.parse(runStr) as { nextSize: number; phase: string; counts: boolean };
        if (run.phase !== 'memorizing' || run.nextSize !== input.size) throw new Error('Stale run state');
        if (input.answer.length !== input.size) throw new Error('Invalid answer length');

        const truth = getStackSequence(seedDate, input.size, variant);
        let correctCount = 0;
        for (let i = 0; i < input.size; i++) if (input.answer[i] === truth[i]) correctCount++;
        const allCorrect = correctCount === input.size;

        // Advance without ending the run
        if (allCorrect && input.size < MEMORY_CONFIG.maxSize) {
          const nextSize = input.size + 1;
          await redis.set(runKey, JSON.stringify({ nextSize, phase: 'memorizing', counts: run.counts }), {
            expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
          });
          return {
            correct: true,
            correctCount,
            sequence: truth,
            runOver: false,
            nextStack: { size: nextSize, sequence: getStackSequence(seedDate, nextSize, variant), memorizeMs: memorizeMs(nextSize) },
          };
        }

        // Run ends — either a miss, or a full clear of the max stack
        const failed = !allCorrect;
        const depth = failed ? input.size - 1 : input.size;
        const failR = failed ? correctCount : 0;
        const score = runScore(depth, failed, failR);
        const reached = reachedStack(depth, failed);
        const submittedAt = Date.now();

        await redis.set(runKey, JSON.stringify({ nextSize: input.size, phase: 'finished', counts: run.counts }), {
          expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
        });

        const officialKey = `memory:daily:${keyBase}:${username}`;
        let recorded = false;
        if (run.counts) {
          const existing = await redis.get(officialKey);
          if (!existing) {
            recorded = true;
            await redis.set(officialKey, JSON.stringify({ done: true, score, depth, failed, failR, reachedStack: reached, submittedAt }), {
              expiration: new Date(Date.now() + 3 * 24 * 3600 * 1000),
            });

            // Combined score encodes earliest-submission tiebreak: higher finalScore wins,
            // and within equal scores an earlier submission (larger remaining-seconds) wins.
            const secsIntoDay = Math.floor((submittedAt % 86400000) / 1000);
            const combined = score * 1e5 + (86400 - secsIntoDay);
            const lbKey = `memory:lb:${keyBase}`;
            const reachedKey = `memory:reached:${keyBase}`;
            await Promise.all([
              redis.zAdd(lbKey, { score: combined, member: username }),
              redis.expire(lbKey, 3 * 24 * 3600),
              redis.hSet(reachedKey, { [username]: `${reached}|${failed ? 'x' : 'c'}` }),
              redis.expire(reachedKey, 3 * 24 * 3600),
            ]);

            // Bonus rounds have their own leaderboard only — they never touch the
            // player's lifetime stats, monthly plays, or daily streak.
            if (!isBonus) {
              const monthKey = `memory:plays:${seedDate.slice(0, 7)}`;
              await Promise.all([
                redis.zIncrBy('memory:plays:alltime', username, 1),
                redis.zIncrBy(monthKey, username, 1),
                redis.expire(monthKey, 90 * 24 * 3600),
              ]);

              const statsStr = await redis.hGet('memory:stats', username);
              const s = statsStr
                ? JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number; bestDepth: number }
                : { games: 0, totalScore: 0, bestScore: 0, bestDepth: 0 };
              s.games += 1;
              s.totalScore += score;
              s.bestScore = Math.max(s.bestScore, score);
              s.bestDepth = Math.max(s.bestDepth, reached);
              await redis.hSet('memory:stats', { [username]: JSON.stringify(s) });

              // Daily streak — bumped once per day, on the official (first) run only.
              const streakKey = `memory:streak:${username}`;
              const streakStr = await redis.get(streakKey);
              const sd = streakStr ? JSON.parse(streakStr) as { count: number; lastDate: string } : null;
              const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = yesterday.toISOString().split('T')[0]!;
              const newStreak = sd?.lastDate === yesterdayStr ? sd.count + 1 : 1;
              await redis.set(streakKey, JSON.stringify({ count: newStreak, lastDate: seedDate }));
            }
          }
        }

        // Percentile / rank for the result screen
        const lbKey = `memory:lb:${keyBase}`;
        const playerCount = await redis.zCard(lbKey);
        let topPct: number | null = null;
        let userRank: number | null = null;
        const rankAsc = await redis.zRank(lbKey, username);
        if (rankAsc != null && playerCount > 0) {
          userRank = playerCount - rankAsc;
          topPct = Math.max(1, Math.round((userRank / playerCount) * 100));
        }

        const [streakStr2, statsStr2] = isBonus ? [null, null] : await Promise.all([
          redis.get(`memory:streak:${username}`),
          redis.hGet('memory:stats', username),
        ]);
        const streak = streakStr2 ? (JSON.parse(streakStr2) as { count: number; lastDate: string }).count : null;
        const lifetimeRuns = statsStr2 ? (JSON.parse(statsStr2) as { games: number }).games : null;

        return {
          correct: allCorrect,
          correctCount,
          sequence: truth,
          runOver: true,
          score,
          reachedStack: reached,
          failed,
          recorded,
          topPct,
          userRank,
          playerCount,
          streak,
          lifetimeRuns,
        };
      }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const { keyBase } = await resolveMemoryCtx();
      const lbKey = `memory:lb:${keyBase}`;
      const size = await redis.zCard(lbKey);
      const raw = size > 0 ? (await redis.zRange(lbKey, 0, size - 1, { by: 'rank' })).reverse() : [];
      const reachedMap = size > 0 ? await redis.hGetAll(`memory:reached:${keyBase}`) : {};
      const top = raw.map(e => {
        const r = reachedMap[e.member]?.split('|');
        return { member: e.member, score: Math.floor(e.score / 1e5), reached: r ? Number(r[0]) : null, cleared: r ? r[1] === 'c' : false };
      });

      let userRank: number | null = null;
      let userScore: number | null = null;
      if (username) {
        const idx = top.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userScore = top[idx]!.score; }
      }

      const statsStr = username ? await redis.hGet('memory:stats', username) : null;
      const stats = statsStr
        ? JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number; bestDepth: number }
        : null;

      const snoovatars = await buildSnoovatars(top.map(e => e.member), username);
      return { top, userRank, userScore, username, stats, dailyCount: size, snoovatars };
    }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        score: z.number().min(0),
        reachedStack: z.number().min(0),
        topPct: z.number().nullable(),
        grid: z.string(),
        userRank: z.number().nullable(),
        playerCount: z.number().nullable(),
        streak: z.number().nullable(),
        lifetimeRuns: z.number().nullable(),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        if (!postId) throw new Error('No post ID');

        // Hard line breaks (trailing double-space) so each stat renders as its own
        // row instead of collapsing into one wrapped paragraph.
        const statLines: string[] = [];
        statLines.push(`**ColorGuessr's The Run — reached Stack ${input.reachedStack}**`);
        statLines.push(`⭐ ${input.score} pts`);
        if (input.topPct != null && input.playerCount != null) statLines.push(`📈 Better than ${100 - input.topPct}% of ${input.playerCount} runners`);
        if (input.userRank != null) statLines.push(`🏅 #${input.userRank} today`);
        if (input.streak != null) statLines.push(`🔥 ${input.streak}-day streak`);

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(statLines.join('  \n'));
        lines.push('');
        lines.push(input.grid);

        const rawPostId = rawId(postId);
        const stickyId = await redis.get(`memory:sticky:${rawPostId}`);
        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;

        if (input.text.trim() || !stickyId) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),

    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }
      const [dayCounts, alltimeCount] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(`memory:lb:${d}`))),
        redis.zCard('memory:plays:alltime'),
      ]);
      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));
      return {
        perDay,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
      };
    }),
  }),
  wire: t.router({
    getSplash: publicProcedure.query(async () => {
      const { puzzle, keyBase, isCustom, title, creator, date } = await resolveWireCtx();
      const username = context.username ?? null;
      const lbKey = `wire:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`wire:daily:${keyBase}:${username}`) : Promise.resolve(null),
        // Self-heal: a custom board posted before the creator-tab keys existed
        // is otherwise invisible on the creator board until someone solves it.
        isCustom && creator && context.postId
          ? ensureWireBoardMeta(rawId(context.postId), creator, title)
          : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as WireResult : null;

      let topPlayer: { username: string; score: number; timeSec: number; avatar: string | null } | null = null;
      if (playerCount > 0) {
        const topArr = await redis.zRange(lbKey, playerCount - 1, playerCount - 1, { by: 'rank' });
        const top = topArr[0];
        if (top) {
          const detail = await redis.hGet(`wire:detail:${keyBase}`, top.member);
          const avatar = top.member === context.username && context.snoovatar ? context.snoovatar : (await getAvatarUrl(top.member)) ?? null;
          topPlayer = { username: top.member, score: Math.floor(top.score / 1e5), timeSec: detail ? Number(detail.split('|')[0]) : 0, avatar };
        }
      }

      // Decorative board for the splash's self-drawing animation — generated
      // fresh and unrelated to the actual puzzle, so the animation can never
      // double as a spoiler for that round's solution.
      const demo = generatePuzzle(Math.floor(Math.random() * 2 ** 31), WIRE_CONFIG.dailyW, WIRE_CONFIG.dailyH, WIRE_CONFIG.dailyPairs);

      return {
        w: puzzle.w, h: puzzle.h,
        demoW: demo.w, demoH: demo.h,
        demoDots: demo.pairs.flatMap((p, i) => [{ cell: p.a, color: i }, { cell: p.b, color: i }]),
        demoSolution: demo.solution,
        colors: WIRE_COLORS,
        pairCount: puzzle.pairs.length,
        playerCount, alreadyPlayed: !!official, best: official, topPlayer,
        isCustom, title, creator, date, username,
      };
    }),

    getBoard: publicProcedure.query(async () => {
      const { puzzle, keyBase, isCustom, title, creator, date } = await resolveWireCtx();
      const username = context.username ?? null;
      const lbKey = `wire:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`wire:daily:${keyBase}:${username}`) : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as WireResult : null;

      return {
        puzzle, colors: WIRE_COLORS, config: WIRE_CONFIG,
        playerCount, alreadyPlayed: !!official, best: official,
        isCustom, title, creator, date, username,
      };
    }),

    // Starts the clock. The elapsed time that scores the solve is measured
    // server-side from this call, so a client can't hand back a faked duration.
    begin: publicProcedure.mutation(async () => {
      const { keyBase } = await resolveWireCtx();
      const username = context.username ?? null;
      if (!username) throw new Error('Not authenticated');

      const official = await redis.get(`wire:daily:${keyBase}:${username}`);
      const counts = !official; // only the first solve is leaderboard-eligible
      await redis.set(`wire:start:${keyBase}:${username}`, String(Date.now()), {
        expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      });
      return { counts, startedAt: Date.now() };
    }),

    submit: publicProcedure
      .input(z.object({
        routes: z.array(z.object({
          color: z.number().int().min(0).max(WIRE_CONFIG.maxPairs - 1),
          cells: z.array(z.number().int().min(0).max(400)).max(400),
        })).max(WIRE_CONFIG.maxPairs),
        moves: z.number().int().min(0).max(9999),
      }))
      .mutation(async ({ input }) => {
        const { puzzle, keyBase, isCustom, creator, title } = await resolveWireCtx();
        const username = context.username ?? null;
        if (!username) throw new Error('Not authenticated');

        const check = checkSolution(puzzle, input.routes);
        if (!check.solved) {
          return { solved: false as const, filled: check.filled, connected: check.connected, reason: check.reason ?? null };
        }

        const startStr = await redis.get(`wire:start:${keyBase}:${username}`);
        const startedAt = startStr ? Number(startStr) : Date.now();
        const submittedAt = Date.now();
        const timeSec = Math.max(1, Math.round((submittedAt - startedAt) / 1000));
        const moves = Math.max(input.moves, puzzle.pairs.length);
        const score = wireScore(timeSec, moves, puzzle.w * puzzle.h);

        const officialKey = `wire:daily:${keyBase}:${username}`;
        const existing = await redis.get(officialKey);
        let recorded = false;
        if (!existing) {
          recorded = true;
          await redis.set(officialKey, JSON.stringify({ score, timeSec, moves, submittedAt } satisfies WireResult), {
            expiration: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          });

          // Higher score wins; equal scores break toward the earlier submission.
          const secsIntoDay = Math.floor((submittedAt % 86400000) / 1000);
          const combined = score * 1e5 + (86400 - secsIntoDay);
          const lbKey = `wire:lb:${keyBase}`;
          const detailKey = `wire:detail:${keyBase}`;
          await Promise.all([
            redis.zAdd(lbKey, { score: combined, member: username }),
            redis.expire(lbKey, 30 * 24 * 3600),
            redis.hSet(detailKey, { [username]: `${timeSec}|${moves}` }),
            redis.expire(detailKey, 30 * 24 * 3600),
          ]);

          // Custom boards keep their own leaderboard only — no lifetime stats,
          // no daily streak. They do feed the custom-play counters that back
          // the analytics tab.
          if (isCustom) {
            const dayKey = `wire:custom-plays:${new Date().toISOString().split('T')[0]!}`;
            const boardId = context.postId ? rawId(context.postId) : null;
            const [, , , , boardPlays] = await Promise.all([
              redis.zIncrBy(dayKey, username, 1),
              redis.expire(dayKey, 90 * 24 * 3600),
              redis.zIncrBy('wire:custom-plays:alltime', username, 1),
              // Solver count credited to the board's creator, not the solver.
              creator ? redis.zIncrBy('wire:creator-plays:alltime', creator, 1) : Promise.resolve(null),
              // Same solve counted against the board itself — the milestone
              // comment reports this per-board count, not the creator's total.
              boardId ? redis.zIncrBy('wire:board-plays', boardId, 1) : Promise.resolve(null),
              boardId && creator ? ensureWireBoardMeta(boardId, creator, title) : Promise.resolve(null),
            ]);

            // Congrats comment to the creator the moment their board crosses a
            // round solver count — fire-and-forget so it never blocks the solve.
            const postId = context.postId;
            if (creator && postId && boardPlays != null && WIRE_CREATOR_MILESTONES.includes(boardPlays)) {
              const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;
              const boardName = title ? `"${title}"` : 'Your Colorwire board';
              void (async () => {
                try {
                  const comment = await reddit.submitComment({
                    id: postFullId,
                    text: `🎉 u/${creator} — ${boardName} just hit **${boardPlays} solvers**! Nice board.`,
                    runAs: 'APP',
                  });
                  await comment.distinguish(true);
                } catch (e) {
                  console.error('wire creator milestone comment failed:', e);
                }
              })();
            }
          } else {
            const monthKey = `wire:plays:${keyBase.slice(0, 7)}`;
            await Promise.all([
              redis.zIncrBy('wire:plays:alltime', username, 1),
              redis.zIncrBy(monthKey, username, 1),
              redis.expire(monthKey, 90 * 24 * 3600),
            ]);

            const statsStr = await redis.hGet('wire:stats', username);
            const s = statsStr
              ? JSON.parse(statsStr) as { games: number; bestScore: number; bestTime: number }
              : { games: 0, bestScore: 0, bestTime: 0 };
            s.games += 1;
            s.bestScore = Math.max(s.bestScore, score);
            s.bestTime = s.bestTime === 0 ? timeSec : Math.min(s.bestTime, timeSec);
            await redis.hSet('wire:stats', { [username]: JSON.stringify(s) });

            const streakKey = `wire:streak:${username}`;
            const streakStr = await redis.get(streakKey);
            const sd = streakStr ? JSON.parse(streakStr) as { count: number; lastDate: string } : null;
            const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0]!;
            const newStreak = sd?.lastDate === keyBase ? sd.count : (sd?.lastDate === yesterdayStr ? sd.count + 1 : 1);
            await redis.set(streakKey, JSON.stringify({ count: newStreak, lastDate: keyBase }));
          }
        }

        const lbKey = `wire:lb:${keyBase}`;
        const playerCount = await redis.zCard(lbKey);
        let userRank: number | null = null;
        let topPct: number | null = null;
        const rankAsc = await redis.zRank(lbKey, username);
        if (rankAsc != null && playerCount > 0) {
          userRank = playerCount - rankAsc;
          topPct = Math.max(1, Math.round((userRank / playerCount) * 100));
        }

        const [streakStr2, statsStr2] = isCustom ? [null, null] : await Promise.all([
          redis.get(`wire:streak:${username}`),
          redis.hGet('wire:stats', username),
        ]);

        return {
          solved: true as const,
          score, timeSec, moves, recorded, playerCount, userRank, topPct,
          streak: streakStr2 ? (JSON.parse(streakStr2) as { count: number }).count : null,
          lifetimeSolves: statsStr2 ? (JSON.parse(statsStr2) as { games: number }).games : null,
        };
      }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const { keyBase, isCustom, title, creator, date } = await resolveWireCtx();
      const lbKey = `wire:lb:${keyBase}`;
      const size = await redis.zCard(lbKey);
      const raw = size > 0 ? (await redis.zRange(lbKey, 0, size - 1, { by: 'rank' })).reverse() : [];
      const detail = size > 0 ? await redis.hGetAll(`wire:detail:${keyBase}`) : {};
      const top = raw.map(e => {
        const d = detail[e.member]?.split('|');
        return { member: e.member, score: Math.floor(e.score / 1e5), timeSec: d ? Number(d[0]) : null, moves: d ? Number(d[1]) : null };
      });

      let userRank: number | null = null;
      let userEntry: (typeof top)[number] | null = null;
      if (username) {
        const idx = top.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userEntry = top[idx]!; }
      }

      // Lifetime record is daily-only by design, but it's still the player's
      // Colorwire career — worth showing on a custom board's Stats tab too.
      const [statsStr, streakStr, snoovatars] = await Promise.all([
        username ? redis.hGet('wire:stats', username) : Promise.resolve(null),
        username ? redis.get(`wire:streak:${username}`) : Promise.resolve(null),
        buildSnoovatars(top.map(e => e.member), username),
      ]);

      return {
        top, userRank, username, dailyCount: size, snoovatars,
        isCustom, title, creator, date,
        userScore: userEntry?.score ?? null,
        userTimeSec: userEntry?.timeSec ?? null,
        userMoves: userEntry?.moves ?? null,
        stats: statsStr ? JSON.parse(statsStr) as { games: number; bestScore: number; bestTime: number } : null,
        streak: streakStr ? (JSON.parse(streakStr) as { count: number }).count : null,
      };
    }),

    // Mod-only. Custom posts chart plays across all custom boards (plus this
    // board's own solver count); daily posts chart the daily boards.
    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const { isCustom, keyBase } = await resolveWireCtx();
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }

      const [dayCounts, alltimeCount, thisPostPlays] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(isCustom ? `wire:custom-plays:${d}` : `wire:lb:${d}`))),
        redis.zCard(isCustom ? 'wire:custom-plays:alltime' : 'wire:plays:alltime'),
        isCustom ? redis.zCard(`wire:lb:${keyBase}`) : Promise.resolve(0),
      ]);

      const perDay = dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 }));
      return {
        perDay,
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
        thisPostPlays,
        isCustom,
      };
    }),

    // Three ways to top the creator board, so one person can't own all of it:
    //   builders — most boards that cleared WIRE_BUILDER_MIN_SOLVERS solvers
    //   engaging — biggest single board, and the row links to it (discovery)
    //   rising   — newcomers only, ranked on total solvers
    // All three fold down from the same per-board data in one pass.
    getCreatorLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const empty = {
        builders: [] as WireCreatorRow[], engaging: [] as WireCreatorRow[], rising: [] as WireCreatorRow[],
        username, snoovatars: {} as Record<string, string>,
        ranks: { builders: null as number | null, engaging: null as number | null, rising: null as number | null },
      };

      // Register the board being viewed before aggregating, so an older custom
      // post at least lists itself the first time its creator tab is opened.
      const ctx = await resolveWireCtx();
      if (ctx.isCustom && ctx.creator && context.postId) {
        await ensureWireBoardMeta(rawId(context.postId), ctx.creator, ctx.title);
      }

      const size = await redis.zCard('wire:board-plays');
      if (size === 0) return empty;

      const [boards, metaRaw] = await Promise.all([
        redis.zRange('wire:board-plays', 0, size - 1, { by: 'rank' }),
        redis.hGetAll('wire:board-meta'),
      ]);

      type Agg = {
        member: string; boards: number; qualBoards: number; plays: number; firstAt: number;
        best: { id: string; title: string; plays: number } | null;
      };
      const byCreator = new Map<string, Agg>();
      for (const b of boards) {
        const metaStr = metaRaw[b.member];
        if (!metaStr) continue;
        const meta = JSON.parse(metaStr) as WireBoardMeta;
        const plays = Math.round(b.score);
        const agg = byCreator.get(meta.c)
          ?? { member: meta.c, boards: 0, qualBoards: 0, plays: 0, firstAt: meta.at, best: null };
        agg.boards += 1;
        agg.plays += plays;
        if (plays >= WIRE_BUILDER_MIN_SOLVERS) agg.qualBoards += 1;
        if (meta.at < agg.firstAt) agg.firstAt = meta.at;
        if (!agg.best || plays > agg.best.plays) agg.best = { id: b.member, title: meta.t, plays };
        byCreator.set(meta.c, agg);
      }
      const all = [...byCreator.values()];
      if (all.length === 0) return empty;

      const row = (a: Agg, score: number): WireCreatorRow => ({
        member: a.member, score, boards: a.boards, qualBoards: a.qualBoards, plays: a.plays,
        bestTitle: a.best?.title || null,
        bestPlays: a.best?.plays ?? 0,
        bestUrl: a.best ? `https://www.reddit.com/comments/${a.best.id}/` : null,
      });

      const builders = all
        .filter(a => a.qualBoards > 0)
        .sort((x, y) => y.qualBoards - x.qualBoards || y.plays - x.plays)
        .slice(0, 25).map(a => row(a, a.qualBoards));

      const engaging = all
        .filter(a => (a.best?.plays ?? 0) > 0)
        .sort((x, y) => (y.best?.plays ?? 0) - (x.best?.plays ?? 0) || y.boards - x.boards)
        .slice(0, 25).map(a => row(a, a.best?.plays ?? 0));

      const cutoff = Date.now() - WIRE_RISING_WINDOW_MS;
      const rising = all
        .filter(a => a.firstAt >= cutoff)
        .sort((x, y) => y.plays - x.plays || y.boards - x.boards)
        .slice(0, 25).map(a => row(a, a.plays));

      const rankIn = (list: { member: string }[]) => {
        if (!username) return null;
        const i = list.findIndex(e => e.member === username);
        return i >= 0 ? i + 1 : null;
      };

      const snoovatars = await buildSnoovatars(
        [...new Set([...builders, ...engaging, ...rising].map(e => e.member))], username,
      );
      return {
        builders, engaging, rising, username, snoovatars,
        ranks: { builders: rankIn(builders), engaging: rankIn(engaging), rising: rankIn(rising) },
      };
    }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        score: z.number().min(0),
        timeSec: z.number().min(0),
        moves: z.number().min(0),
        topPct: z.number().nullable(),
        userRank: z.number().nullable(),
        playerCount: z.number().nullable(),
        streak: z.number().nullable(),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        if (!postId) throw new Error('No post ID');
        const { isCustom, title } = await resolveWireCtx();

        const mm = Math.floor(input.timeSec / 60);
        const ss = String(input.timeSec % 60).padStart(2, '0');
        const statLines: string[] = [];
        statLines.push(`**${isCustom ? (title ? `Colorwire — ${title}` : 'Custom Colorwire') : "ColorGuessr's Colorwire"} — solved in ${mm}:${ss}**`);
        statLines.push(`⭐ ${input.score} pts · ${input.moves} wires drawn`);
        if (input.topPct != null && input.playerCount != null) statLines.push(`📈 Better than ${100 - input.topPct}% of ${input.playerCount} solvers`);
        if (input.userRank != null) statLines.push(`🏅 #${input.userRank} today`);
        if (input.streak != null && input.streak > 1) statLines.push(`🔥 ${input.streak}-day streak`);

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(statLines.join('  \n'));

        const rawPostId = rawId(postId);
        const stickyId = await redis.get(`wire:sticky:${rawPostId}`);
        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;

        if (input.text.trim() || !stickyId) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),

    // Creator-side check: does this hand-built board have a solution that fills
    // every cell? Bounded search — an unverifiable board is rejected, never
    // posted on a maybe.
    validateBoard: publicProcedure
      .input(z.object({
        w: z.number().int().min(WIRE_CONFIG.minSize).max(WIRE_CONFIG.maxSize),
        h: z.number().int().min(WIRE_CONFIG.minSize).max(WIRE_CONFIG.maxSize),
        pairs: z.array(z.object({ a: z.number().int().min(0), b: z.number().int().min(0) })).min(WIRE_CONFIG.minPairs).max(WIRE_CONFIG.maxPairs),
      }))
      .mutation(async ({ input }) => {
        const err = validateWireBoard(input);
        if (err) return { ok: false as const, reason: err };
        const solved = solveWire(input, WIRE_SOLVE_NODES);
        if (!solved.routes) {
          return {
            ok: false as const,
            reason: solved.exhausted
              ? "Could not check this board in time — move a dot or two and try again."
              : "No solution fills every cell — move a dot or two.",
          };
        }
        return { ok: true as const, reason: null };
      }),

    createCustomPuzzle: publicProcedure
      .input(z.object({
        w: z.number().int().min(WIRE_CONFIG.minSize).max(WIRE_CONFIG.maxSize),
        h: z.number().int().min(WIRE_CONFIG.minSize).max(WIRE_CONFIG.maxSize),
        pairs: z.array(z.object({ a: z.number().int().min(0), b: z.number().int().min(0) })).min(WIRE_CONFIG.minPairs).max(WIRE_CONFIG.maxPairs),
        title: z.string().max(60).optional(),
        // The creator's own solution. Checking one costs O(cells); searching
        // for one costs seconds on a 10x10, so this is what lets big boards
        // post at all. It is verified below, never trusted.
        solution: z.array(z.array(z.number().int().min(0))).max(WIRE_CONFIG.maxPairs).optional(),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        const subredditName = context.subredditName;
        if (!username) throw new Error('Not authenticated');
        if (!subredditName) throw new Error('No subreddit');

        const board = { w: input.w, h: input.h, pairs: input.pairs };
        const err = validateWireBoard(board);
        if (err) throw new Error(err);

        // A submitted solution is proof only once it checks out: every pair
        // joined, no overlaps, every cell covered. If it does, the search is
        // unnecessary; if it doesn't, we fall back to finding one ourselves.
        const offered = input.solution;
        let routes: number[][] | null = null;
        if (offered && offered.length === input.pairs.length
          && checkSolution(board, offered.map((cells, color) => ({ color, cells }))).solved) {
          routes = offered;
        }
        if (!routes) {
          const solved = solveWire(board, WIRE_SOLVE_NODES);
          if (!solved.routes) {
            throw new Error(solved.exhausted
              ? "Could not check this board in time — move a dot or two and try again."
              : "No solution fills every cell — move a dot or two.");
          }
          routes = solved.routes;
        }
        // Measured here, never taken from the client: the tier is the whole
        // reason the flair is worth filtering on.
        const tier: WireTier = rateBoard(board, routes).tier;

        const postTitle = input.title?.trim()
          ? `${input.title.trim()} — Colorwire by u/${username}`
          : `Colorwire by u/${username}`;

        const post = await reddit.submitCustomPost({
          subredditName,
          title: postTitle,
          runAs: 'USER',
          userGeneratedContent: { text: input.title?.trim() || postTitle },
        });
        const rawPostId = rawId(post.id);

        await Promise.all([
          redis.set(`color-guesser:post-type:${rawPostId}`, 'wire-custom'),
          redis.set(`wire:custom:${rawPostId}`, JSON.stringify({ ...board, creator: username, title: input.title?.trim() || undefined, tier })),
          redis.zIncrBy('wire:creators:alltime', username, 1),
          // Register at zero so an unsolved board still shows in the creator's
          // board count and can be discovered before anyone has solved it.
          redis.zAdd('wire:board-plays', { score: 0, member: rawPostId }),
          redis.hSet('wire:board-meta', {
            [rawPostId]: JSON.stringify({ c: username, t: input.title?.trim() || '', at: Date.now(), d: tier } satisfies WireBoardMeta),
          }),
        ]);

        // Stamped by the app account rather than carried by the submission:
        // the boards post as the user, and users cannot assign their own link
        // flair here. Awaited — a floating promise dies with the request.
        await setWireDifficultyFlair(post.id, tier);

        void (async () => {
          try {
            const sticky = await reddit.submitComment({
              id: (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`,
              text: `**Colorwire by u/${username}** — connect every pair, fill every cell. Share your time here!`,
              runAs: 'APP',
            });
            await sticky.distinguish(true);
            await redis.set(`wire:sticky:${rawPostId}`, sticky.id);
          } catch (e) {
            console.error('createCustomPuzzle sticky failed:', e);
          }
        })();

        return { postUrl: `https://www.reddit.com/r/${subredditName}/comments/${rawPostId}/` };
      }),
  }),

  // Rewire: a photo shattered into a shuffled tile grid (level 1, tap-to-swap),
  // then the reassembled photo becomes a Colorwire board (level 2). Every
  // board is user-created — reuses Colorwire's puzzle core for level 2 and its
  // creator-tab/leaderboard plumbing 1:1 under a `rewire:` key prefix.
  rewire: t.router({
    getSplash: publicProcedure.query(async () => {
      const { puzzle, keyBase, imageUrl, title, creator } = await resolveRewireCtx();
      const username = context.username ?? null;
      const lbKey = `rewire:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`rewire:solve:${keyBase}:${username}`) : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as RewireResult : null;

      return {
        w: puzzle.w, h: puzzle.h, imageUrl, colors: WIRE_COLORS,
        pairCount: puzzle.pairs.length, playerCount, alreadyPlayed: !!official, best: official,
        title, creator, username,
      };
    }),

    getBoard: publicProcedure.query(async () => {
      const { puzzle, keyBase, imageUrl, title, creator } = await resolveRewireCtx();
      const username = context.username ?? null;
      const lbKey = `rewire:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`rewire:solve:${keyBase}:${username}`) : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as RewireResult : null;
      // Deterministic per board, so every player reconstructs the same shuffle —
      // same fairness principle as Colorwire's fixed board.
      const shuffle = generateShuffle(seedFromString(`rewire-shuffle:${keyBase}`), puzzle.w, puzzle.h);

      return {
        puzzle, colors: WIRE_COLORS, imageUrl, shuffle,
        playerCount, alreadyPlayed: !!official, best: official,
        title, creator, username,
      };
    }),

    // Starts level 1's clock. Both levels' elapsed times are measured
    // server-side from these timestamps, so a client can't hand back a faked
    // duration for either one.
    begin: publicProcedure.mutation(async () => {
      const { keyBase } = await resolveRewireCtx();
      const username = context.username ?? null;
      if (!username) throw new Error('Not authenticated');

      const official = await redis.get(`rewire:solve:${keyBase}:${username}`);
      const counts = !official;
      await redis.set(`rewire:start:${keyBase}:${username}`, String(Date.now()), {
        expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      });
      return { counts, startedAt: Date.now() };
    }),

    // Marks the level-1 → level-2 handoff, closing level 1's clock and opening
    // level 2's.
    finishLevel1: publicProcedure.mutation(async () => {
      const { keyBase } = await resolveRewireCtx();
      const username = context.username ?? null;
      if (!username) throw new Error('Not authenticated');
      await redis.set(`rewire:l1done:${keyBase}:${username}`, String(Date.now()), {
        expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      });
      return { ok: true };
    }),

    submit: publicProcedure
      .input(z.object({
        l1Swaps: z.number().int().min(0).max(9999),
        routes: z.array(z.object({
          color: z.number().int().min(0).max(WIRE_CONFIG.maxPairs - 1),
          cells: z.array(z.number().int().min(0).max(400)).max(400),
        })).max(WIRE_CONFIG.maxPairs),
        l2Moves: z.number().int().min(0).max(9999),
      }))
      .mutation(async ({ input }) => {
        const { puzzle, keyBase, rawPostId, creator, title } = await resolveRewireCtx();
        const username = context.username ?? null;
        if (!username) throw new Error('Not authenticated');

        const check = checkSolution(puzzle, input.routes);
        if (!check.solved) {
          return { solved: false as const, filled: check.filled, connected: check.connected, reason: check.reason ?? null };
        }

        const [startStr, l1doneStr] = await Promise.all([
          redis.get(`rewire:start:${keyBase}:${username}`),
          redis.get(`rewire:l1done:${keyBase}:${username}`),
        ]);
        const startedAt = startStr ? Number(startStr) : Date.now();
        const l1done = l1doneStr ? Number(l1doneStr) : startedAt;
        const submittedAt = Date.now();
        const l1TimeSec = Math.max(1, Math.round((l1done - startedAt) / 1000));
        const l2TimeSec = Math.max(1, Math.round((submittedAt - l1done) / 1000));
        const cells = puzzle.w * puzzle.h;
        const l1Swaps = Math.max(0, input.l1Swaps);
        const l2Moves = Math.max(input.l2Moves, puzzle.pairs.length);
        const score = wireScore(l1TimeSec, l1Swaps, cells) + wireScore(l2TimeSec, l2Moves, cells);

        const officialKey = `rewire:solve:${keyBase}:${username}`;
        const existing = await redis.get(officialKey);
        let recorded = false;
        if (!existing) {
          recorded = true;
          await redis.set(officialKey, JSON.stringify({ score, l1TimeSec, l1Swaps, l2TimeSec, l2Moves, submittedAt } satisfies RewireResult), {
            expiration: new Date(Date.now() + 90 * 24 * 3600 * 1000),
          });

          // Higher score wins; equal scores break toward the earlier submission.
          const secsIntoDay = Math.floor((submittedAt % 86400000) / 1000);
          const combined = score * 1e5 + (86400 - secsIntoDay);
          const lbKey = `rewire:lb:${keyBase}`;
          const detailKey = `rewire:detail:${keyBase}`;
          await Promise.all([
            redis.zAdd(lbKey, { score: combined, member: username }),
            redis.expire(lbKey, 90 * 24 * 3600),
            redis.hSet(detailKey, { [username]: `${l1TimeSec}|${l1Swaps}|${l2TimeSec}|${l2Moves}` }),
            redis.expire(detailKey, 90 * 24 * 3600),
          ]);

          const dayKey = `rewire:plays:${new Date().toISOString().split('T')[0]!}`;
          const [, , , , boardPlays] = await Promise.all([
            redis.zIncrBy(dayKey, username, 1),
            redis.expire(dayKey, 90 * 24 * 3600),
            redis.zIncrBy('rewire:plays:alltime', username, 1),
            // Solver count credited to the board's creator, not the solver.
            redis.zIncrBy('rewire:creator-plays:alltime', creator, 1),
            // Milestone comment reports this per-board count, not the creator's total.
            redis.zIncrBy('rewire:board-plays', rawPostId, 1),
            ensureRewireBoardMeta(rawPostId, creator, title),
          ]);

          // Congrats comment to the creator the moment their board crosses a
          // round solver count — fire-and-forget so it never blocks the solve.
          const postId = context.postId;
          if (postId && WIRE_CREATOR_MILESTONES.includes(boardPlays)) {
            const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;
            const boardName = title ? `"${title}"` : 'Your Rewire board';
            void (async () => {
              try {
                const comment = await reddit.submitComment({
                  id: postFullId,
                  text: `🎉 u/${creator} — ${boardName} just hit **${boardPlays} solvers**! Nice board.`,
                  runAs: 'APP',
                });
                await comment.distinguish(true);
              } catch (e) {
                console.error('rewire creator milestone comment failed:', e);
              }
            })();
          }
        }

        const lbKey = `rewire:lb:${keyBase}`;
        const playerCount = await redis.zCard(lbKey);
        let userRank: number | null = null;
        let topPct: number | null = null;
        const rankAsc = await redis.zRank(lbKey, username);
        if (rankAsc != null && playerCount > 0) {
          userRank = playerCount - rankAsc;
          topPct = Math.max(1, Math.round((userRank / playerCount) * 100));
        }

        return {
          solved: true as const,
          score, l1TimeSec, l1Swaps, l2TimeSec, l2Moves, recorded, playerCount, userRank, topPct,
        };
      }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const { keyBase, title, creator } = await resolveRewireCtx();
      const lbKey = `rewire:lb:${keyBase}`;
      const size = await redis.zCard(lbKey);
      const raw = size > 0 ? (await redis.zRange(lbKey, 0, size - 1, { by: 'rank' })).reverse() : [];
      const detail = size > 0 ? await redis.hGetAll(`rewire:detail:${keyBase}`) : {};
      const top = raw.map(e => {
        const d = detail[e.member]?.split('|');
        return {
          member: e.member, score: Math.floor(e.score / 1e5),
          l1TimeSec: d ? Number(d[0]) : null, l1Swaps: d ? Number(d[1]) : null,
          l2TimeSec: d ? Number(d[2]) : null, l2Moves: d ? Number(d[3]) : null,
        };
      });

      let userRank: number | null = null;
      let userEntry: (typeof top)[number] | null = null;
      if (username) {
        const idx = top.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userEntry = top[idx]!; }
      }

      const snoovatars = await buildSnoovatars(top.map(e => e.member), username);
      return {
        top, userRank, username, playerCount: size, snoovatars, title, creator,
        userScore: userEntry?.score ?? null,
      };
    }),

    // Same three-way creator ranking as Colorwire's, over the `rewire:` prefixed keys.
    getCreatorLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const empty = {
        builders: [] as WireCreatorRow[], engaging: [] as WireCreatorRow[], rising: [] as WireCreatorRow[],
        username, snoovatars: {} as Record<string, string>,
        ranks: { builders: null as number | null, engaging: null as number | null, rising: null as number | null },
      };

      const ctx = await resolveRewireCtx();
      await ensureRewireBoardMeta(ctx.rawPostId, ctx.creator, ctx.title);

      const size = await redis.zCard('rewire:board-plays');
      if (size === 0) return empty;

      const [boards, metaRaw] = await Promise.all([
        redis.zRange('rewire:board-plays', 0, size - 1, { by: 'rank' }),
        redis.hGetAll('rewire:board-meta'),
      ]);

      type Agg = {
        member: string; boards: number; qualBoards: number; plays: number; firstAt: number;
        best: { id: string; title: string; plays: number } | null;
      };
      const byCreator = new Map<string, Agg>();
      for (const b of boards) {
        const metaStr = metaRaw[b.member];
        if (!metaStr) continue;
        const meta = JSON.parse(metaStr) as WireBoardMeta;
        const plays = Math.round(b.score);
        const agg = byCreator.get(meta.c)
          ?? { member: meta.c, boards: 0, qualBoards: 0, plays: 0, firstAt: meta.at, best: null };
        agg.boards += 1;
        agg.plays += plays;
        if (plays >= WIRE_BUILDER_MIN_SOLVERS) agg.qualBoards += 1;
        if (meta.at < agg.firstAt) agg.firstAt = meta.at;
        if (!agg.best || plays > agg.best.plays) agg.best = { id: b.member, title: meta.t, plays };
        byCreator.set(meta.c, agg);
      }
      const all = [...byCreator.values()];
      if (all.length === 0) return empty;

      const row = (a: Agg, score: number): WireCreatorRow => ({
        member: a.member, score, boards: a.boards, qualBoards: a.qualBoards, plays: a.plays,
        bestTitle: a.best?.title || null,
        bestPlays: a.best?.plays ?? 0,
        bestUrl: a.best ? `https://www.reddit.com/comments/${a.best.id}/` : null,
      });

      const builders = all
        .filter(a => a.qualBoards > 0)
        .sort((x, y) => y.qualBoards - x.qualBoards || y.plays - x.plays)
        .slice(0, 25).map(a => row(a, a.qualBoards));

      const engaging = all
        .filter(a => (a.best?.plays ?? 0) > 0)
        .sort((x, y) => (y.best?.plays ?? 0) - (x.best?.plays ?? 0) || y.boards - x.boards)
        .slice(0, 25).map(a => row(a, a.best?.plays ?? 0));

      const cutoff = Date.now() - WIRE_RISING_WINDOW_MS;
      const rising = all
        .filter(a => a.firstAt >= cutoff)
        .sort((x, y) => y.plays - x.plays || y.boards - x.boards)
        .slice(0, 25).map(a => row(a, a.plays));

      const rankIn = (list: { member: string }[]) => {
        if (!username) return null;
        const i = list.findIndex(e => e.member === username);
        return i >= 0 ? i + 1 : null;
      };

      const snoovatars = await buildSnoovatars(
        [...new Set([...builders, ...engaging, ...rising].map(e => e.member))], username,
      );
      return {
        builders, engaging, rising, username, snoovatars,
        ranks: { builders: rankIn(builders), engaging: rankIn(engaging), rising: rankIn(rising) },
      };
    }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        score: z.number().min(0),
        l1TimeSec: z.number().min(0),
        l1Swaps: z.number().min(0),
        l2TimeSec: z.number().min(0),
        l2Moves: z.number().min(0),
        userRank: z.number().nullable(),
        playerCount: z.number().nullable(),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        if (!postId) throw new Error('No post ID');
        const { title } = await resolveRewireCtx();

        const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
        const statLines: string[] = [];
        statLines.push(`**${title ? `Rewire — ${title}` : 'Custom Rewire'} — solved in ${fmt(input.l1TimeSec + input.l2TimeSec)}**`);
        statLines.push(`🧩 Level 1: ${fmt(input.l1TimeSec)} (${input.l1Swaps} swaps) · 🔌 Level 2: ${fmt(input.l2TimeSec)} (${input.l2Moves} wires)`);
        statLines.push(`⭐ ${input.score} pts`);
        if (input.userRank != null && input.playerCount != null) statLines.push(`🏅 #${input.userRank} of ${input.playerCount} solvers`);

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(statLines.join('  \n'));

        const rawPostId = rawId(postId);
        const stickyId = await redis.get(`rewire:sticky:${rawPostId}`);
        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;

        if (input.text.trim() || !stickyId) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),

    // Re-hosts the image the creator picked (a Reddit-hosted form upload URL)
    // as a permanent media asset, so the board doesn't depend on the transient
    // form-submission URL staying alive.
    pinImage: publicProcedure
      .input(z.object({ url: z.string().url() }))
      .mutation(async ({ input }) => {
        const asset = await media.upload({ url: input.url, type: 'image' });
        return { mediaUrl: asset.mediaUrl };
      }),

    validateBoard: publicProcedure
      .input(z.object({
        w: z.union([z.literal(REWIRE_SIZES[0]), z.literal(REWIRE_SIZES[1])]),
        h: z.union([z.literal(REWIRE_SIZES[0]), z.literal(REWIRE_SIZES[1])]),
        pairs: z.array(z.object({ a: z.number().int().min(0), b: z.number().int().min(0) })).min(WIRE_CONFIG.minPairs).max(WIRE_CONFIG.maxPairs),
      }))
      .mutation(async ({ input }) => {
        if (input.w !== input.h) return { ok: false as const, reason: 'Board must be square — 5×5 or 6×6.' };
        const err = validateWireBoard(input);
        if (err) return { ok: false as const, reason: err };
        const solved = solveWire(input, WIRE_SOLVE_NODES);
        if (!solved.routes) {
          return {
            ok: false as const,
            reason: solved.exhausted
              ? "Could not check this board in time — move a dot or two and try again."
              : "No solution fills every cell — move a dot or two.",
          };
        }
        return { ok: true as const, reason: null };
      }),

    createCustomPuzzle: publicProcedure
      .input(z.object({
        w: z.union([z.literal(REWIRE_SIZES[0]), z.literal(REWIRE_SIZES[1])]),
        h: z.union([z.literal(REWIRE_SIZES[0]), z.literal(REWIRE_SIZES[1])]),
        pairs: z.array(z.object({ a: z.number().int().min(0), b: z.number().int().min(0) })).min(WIRE_CONFIG.minPairs).max(WIRE_CONFIG.maxPairs),
        title: z.string().max(60).optional(),
        imageUrl: z.string().url(),
      }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        const subredditName = context.subredditName;
        if (!username) throw new Error('Not authenticated');
        if (!subredditName) throw new Error('No subreddit');
        if (!(await isCurrentUserMod())) throw new Error('Only moderators can post a Rewire board.');
        if (input.w !== input.h) throw new Error('Board must be square — 5×5 or 6×6.');

        const board = { w: input.w, h: input.h, pairs: input.pairs };
        const err = validateWireBoard(board);
        if (err) throw new Error(err);
        const solved = solveWire(board, WIRE_SOLVE_NODES);
        if (!solved.routes) {
          throw new Error(solved.exhausted
            ? "Could not check this board in time — move a dot or two and try again."
            : "No solution fills every cell — move a dot or two.");
        }

        const postTitle = input.title?.trim()
          ? `${input.title.trim()} — Rewire by u/${username}`
          : `Rewire by u/${username}`;

        const post = await reddit.submitCustomPost({
          subredditName,
          title: postTitle,
          runAs: 'USER',
          userGeneratedContent: { text: input.title?.trim() || postTitle },
        });
        const rawPostId = rawId(post.id);

        await Promise.all([
          redis.set(`color-guesser:post-type:${rawPostId}`, 'rewire'),
          redis.set(`rewire:custom:${rawPostId}`, JSON.stringify({ ...board, imageUrl: input.imageUrl, creator: username, title: input.title?.trim() || undefined })),
          redis.zIncrBy('rewire:creators:alltime', username, 1),
          redis.zAdd('rewire:board-plays', { score: 0, member: rawPostId }),
          redis.hSet('rewire:board-meta', {
            [rawPostId]: JSON.stringify({ c: username, t: input.title?.trim() || '', at: Date.now() } satisfies WireBoardMeta),
          }),
        ]);

        void (async () => {
          try {
            const sticky = await reddit.submitComment({
              id: (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`,
              text: `**Rewire by u/${username}** — rebuild the photo, then connect every pair. Share your time here!`,
              runAs: 'APP',
            });
            await sticky.distinguish(true);
            await redis.set(`rewire:sticky:${rawPostId}`, sticky.id);
          } catch (e) {
            console.error('rewire createCustomPuzzle sticky failed:', e);
          }
        })();

        return { postUrl: `https://www.reddit.com/r/${subredditName}/comments/${rawPostId}/` };
      }),
  }),

  equinox: t.router({
    getSplash: publicProcedure.query(async () => {
      const { puzzle, date, keyBase } = await resolveEquinoxCtx();
      const username = context.username ?? null;
      const lbKey = `equinox:lb:${keyBase}`;

      const [playerCount, officialStr] = await Promise.all([
        redis.zCard(lbKey),
        username ? redis.get(`equinox:daily:${keyBase}:${username}`) : Promise.resolve(null),
      ]);
      const official = officialStr ? JSON.parse(officialStr) as EquinoxResult : null;

      let topPlayer: { username: string; score: number; timeSec: number; avatar: string | null } | null = null;
      if (playerCount > 0) {
        const topArr = await redis.zRange(lbKey, playerCount - 1, playerCount - 1, { by: 'rank' });
        const top = topArr[0];
        if (top) {
          const detail = await redis.hGet(`equinox:detail:${keyBase}`, top.member);
          const avatar = top.member === context.username && context.snoovatar ? context.snoovatar : (await getAvatarUrl(top.member)) ?? null;
          topPlayer = { username: top.member, score: Math.floor(top.score / 1e5), timeSec: detail ? Number(detail) : 0, avatar };
        }
      }

      // The clue board is safe to show — it is the puzzle, not the answer.
      return { puzzle, date, playerCount, alreadyPlayed: !!official, best: official, topPlayer, username };
    }),

    getBoard: publicProcedure.query(() => equinoxBoardPayload()),

    // Starts the clock. The elapsed time that scores the solve is measured
    // server-side from this call, so a client can't hand back a faked duration.
    // Set once the walkthrough has been finished or skipped. Deliberately not
    // derived from the play counters: those only move on a *solve*, so a player
    // who opened the card and quit would be offered the walkthrough forever.
    markOnboarded: publicProcedure.mutation(async () => {
      const username = context.username ?? null;
      if (!username) return { ok: false };
      await redis.set(`equinox:onboarded:${username}`, '1');
      return { ok: true };
    }),

    begin: publicProcedure.mutation(async () => {
      const { keyBase } = await resolveEquinoxCtx();
      const username = context.username ?? null;
      if (!username) throw new Error('Not authenticated');

      const official = await redis.get(`equinox:daily:${keyBase}:${username}`);
      const counts = !official; // only the first solve is leaderboard-eligible
      await redis.set(`equinox:start:${keyBase}:${username}`, String(Date.now()), {
        expiration: new Date(Date.now() + 2 * 24 * 3600 * 1000),
      });
      return { counts, startedAt: Date.now() };
    }),

    submit: publicProcedure
      .input(z.object({
        cells: z.array(z.number().int().min(0).max(2)).max(400),
      }))
      .mutation(async ({ input }) => {
        const { puzzle: encoded, keyBase } = await resolveEquinoxCtx();
        const username = context.username ?? null;
        if (!username) throw new Error('Not authenticated');

        // Judged against the rules, never against a stored answer — same as
        // Colorwire. A board that satisfies every rule *is* the solution.
        const puzzle = decodePuzzle(encoded);
        const cells = input.cells;
        if (cells.length !== puzzle.clues.length) return { solved: false as const, reason: 'wrong board size' };
        if (cells.some(c => c === EMPTY)) return { solved: false as const, reason: 'board is not full' };
        for (let i = 0; i < cells.length; i++) {
          if (puzzle.clues[i] !== EMPTY && puzzle.clues[i] !== cells[i]) {
            return { solved: false as const, reason: 'a given clue was changed' };
          }
        }
        const broken = violations(puzzle.n, cells, puzzle.numbers);
        if (broken.length > 0) return { solved: false as const, reason: 'rules broken', violations: broken };

        const startStr = await redis.get(`equinox:start:${keyBase}:${username}`);
        const startedAt = startStr ? Number(startStr) : Date.now();
        const submittedAt = Date.now();
        const timeSec = Math.max(1, Math.round((submittedAt - startedAt) / 1000));
        const score = equinoxScore(timeSec);

        const officialKey = `equinox:daily:${keyBase}:${username}`;
        const existing = await redis.get(officialKey);
        let recorded = false;
        if (!existing) {
          recorded = true;
          await redis.set(officialKey, JSON.stringify({ score, timeSec, submittedAt } satisfies EquinoxResult), {
            expiration: new Date(Date.now() + 30 * 24 * 3600 * 1000),
          });

          // Higher score wins; equal scores break toward the earlier submission.
          const secsIntoDay = Math.floor((submittedAt % 86400000) / 1000);
          const combined = score * 1e5 + (86400 - secsIntoDay);
          const lbKey = `equinox:lb:${keyBase}`;
          const detailKey = `equinox:detail:${keyBase}`;
          await Promise.all([
            redis.zAdd(lbKey, { score: combined, member: username }),
            redis.expire(lbKey, 30 * 24 * 3600),
            redis.hSet(detailKey, { [username]: String(timeSec) }),
            redis.expire(detailKey, 30 * 24 * 3600),
          ]);

          const monthKey = `equinox:plays:${keyBase.slice(0, 7)}`;
          await Promise.all([
            redis.zIncrBy('equinox:plays:alltime', username, 1),
            redis.zIncrBy(monthKey, username, 1),
            redis.expire(monthKey, 90 * 24 * 3600),
          ]);

          const statsStr = await redis.hGet('equinox:stats', username);
          const st = statsStr
            ? JSON.parse(statsStr) as { games: number; bestScore: number; bestTime: number }
            : { games: 0, bestScore: 0, bestTime: 0 };
          st.games += 1;
          st.bestScore = Math.max(st.bestScore, score);
          st.bestTime = st.bestTime === 0 ? timeSec : Math.min(st.bestTime, timeSec);
          await redis.hSet('equinox:stats', { [username]: JSON.stringify(st) });

          // Streak runs on the BOARD's date, not the wall clock, and only ever
          // moves forward. Solving an archived post must not rewind lastDate
          // (which would reset the streak on the next real solve), and a board
          // finished just after UTC midnight must still count as its own day.
          const streakKey = `equinox:streak:${username}`;
          const streakStr = await redis.get(streakKey);
          const sd = streakStr ? JSON.parse(streakStr) as { count: number; lastDate: string } : null;
          if (!sd || keyBase >= sd.lastDate) {
            const dayBefore = new Date(`${keyBase}T00:00:00Z`);
            dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
            const prevDay = dayBefore.toISOString().split('T')[0]!;
            const newStreak = sd?.lastDate === keyBase ? sd.count : (sd?.lastDate === prevDay ? sd.count + 1 : 1);
            await redis.set(streakKey, JSON.stringify({ count: newStreak, lastDate: keyBase }));
          }
        }

        const lbKey = `equinox:lb:${keyBase}`;
        const playerCount = await redis.zCard(lbKey);
        let userRank: number | null = null;
        let topPct: number | null = null;
        const rankAsc = await redis.zRank(lbKey, username);
        if (rankAsc != null && playerCount > 0) {
          userRank = playerCount - rankAsc;
          topPct = Math.max(1, Math.round((userRank / playerCount) * 100));
        }

        const [streakStr2, statsStr2] = await Promise.all([
          redis.get(`equinox:streak:${username}`),
          redis.hGet('equinox:stats', username),
        ]);

        return {
          solved: true as const,
          score, timeSec, recorded, playerCount, userRank, topPct,
          streak: streakStr2 ? (JSON.parse(streakStr2) as { count: number }).count : null,
          lifetimeSolves: statsStr2 ? (JSON.parse(statsStr2) as { games: number }).games : null,
        };
      }),

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const { keyBase, date } = await resolveEquinoxCtx();
      const lbKey = `equinox:lb:${keyBase}`;
      const size = await redis.zCard(lbKey);
      const raw = size > 0 ? (await redis.zRange(lbKey, 0, size - 1, { by: 'rank' })).reverse() : [];
      const detail = size > 0 ? await redis.hGetAll(`equinox:detail:${keyBase}`) : {};
      const top = raw.map(e => ({
        member: e.member,
        score: Math.floor(e.score / 1e5),
        timeSec: detail[e.member] != null ? Number(detail[e.member]) : null,
      }));

      let userRank: number | null = null;
      let userEntry: (typeof top)[number] | null = null;
      if (username) {
        const idx = top.findIndex(e => e.member === username);
        if (idx >= 0) { userRank = idx + 1; userEntry = top[idx]!; }
      }

      const [statsStr, streakStr, snoovatars] = await Promise.all([
        username ? redis.hGet('equinox:stats', username) : Promise.resolve(null),
        username ? redis.get(`equinox:streak:${username}`) : Promise.resolve(null),
        buildSnoovatars(top.map(e => e.member), username),
      ]);

      return {
        top, userRank, username, dailyCount: size, date, snoovatars,
        userScore: userEntry?.score ?? null,
        userTimeSec: userEntry?.timeSec ?? null,
        stats: statsStr ? JSON.parse(statsStr) as { games: number; bestScore: number; bestTime: number } : null,
        streak: streakStr ? (JSON.parse(streakStr) as { count: number }).count : null,
      };
    }),

    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }

      const [dayCounts, alltimeCount] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(`equinox:lb:${d}`))),
        redis.zCard('equinox:plays:alltime'),
      ]);

      return {
        perDay: dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 })),
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
      };
    }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        score: z.number().min(0),
        timeSec: z.number().min(0),
        topPct: z.number().nullable(),
        userRank: z.number().nullable(),
        playerCount: z.number().nullable(),
        streak: z.number().nullable(),
      }))
      .mutation(async ({ input }) => {
        const postId = context.postId;
        if (!postId) throw new Error('No post ID');

        const { num } = await resolveEquinoxCtx();
        const mm = Math.floor(input.timeSec / 60);
        const ss = String(input.timeSec % 60).padStart(2, '0');
        const statLines: string[] = [];
        statLines.push(`**Equinox #${num} — balanced in ${mm}:${ss}**`);
        statLines.push(`⭐ ${input.score} pts`);
        if (input.topPct != null && input.playerCount != null) statLines.push(`📈 Better than ${100 - input.topPct}% of ${input.playerCount} solvers`);
        if (input.userRank != null) statLines.push(`🏅 #${input.userRank} today`);
        if (input.streak != null && input.streak > 1) statLines.push(`🔥 ${input.streak}-day streak`);

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(statLines.join('  \n'));

        const rawPostId = rawId(postId);
        const stickyId = await redis.get(`equinox:sticky:${rawPostId}`);
        const postFullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;

        if (input.text.trim() || !stickyId) {
          await reddit.submitComment({ id: postFullId, text: lines.join('\n'), runAs: 'USER' });
        } else {
          const fullStickyId = (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`;
          await reddit.submitComment({ id: fullStickyId, text: lines.join('\n'), runAs: 'USER' });
        }
        return { success: true };
      }),
  }),

  // Name This Color. There is no answer key — a name's score is the upvotes on
  // its comment, which only Reddit's own comment UI can cast. So every read here
  // is a snapshot of the last sweep, and every name row carries a permalink the
  // client sends people to in order to vote.
  namecolor: t.router({
    getSplash: publicProcedure.query(async () => {
      const nc = await resolveNameColorCtx();
      const username = context.username ?? null;

      const [nameCount, ranked, mineStr, sweptStr] = await Promise.all([
        redis.hLen(ncKeys.entries(nc.rawPostId)),
        ncRanked(nc.rawPostId),
        username ? redis.hGet(ncKeys.byUser(nc.rawPostId), username) : Promise.resolve(undefined),
        redis.get(ncKeys.swept(nc.rawPostId)),
      ]);

      const mineIds: string[] = mineStr ? (JSON.parse(mineStr) as string[]) : [];
      const mine = ranked.filter(r => mineIds.includes(r.id)).map(r => ({ id: r.id, name: r.name, votes: r.votes, url: r.url }));
      const leader = ranked[0] ? { name: ranked[0].name, author: ranked[0].author, votes: ranked[0].votes } : null;

      // The feed card shows the room, not just your own answers — other people's
      // names are the reason to open it, the same way r/blanks shows the wall.
      const top = ranked.slice(0, 8).map(r => ({
        id: r.id, name: r.name, author: r.author, votes: r.votes, url: r.url, mine: mineIds.includes(r.id),
      }));
      const snoovatars = await buildSnoovatars(top.map(t => t.author), username);

      return {
        hex: nc.hex, title: nc.title, creator: nc.creator, isCustom: !!nc.creator,
        createdAt: nc.createdAt, username,
        nameCount, leader, mine, top, snoovatars,
        lastSweptAt: sweptStr ? Number(sweptStr) : null,
      };
    }),

    // The expanded view is the deliberate one, so it pays for a vote refresh —
    // sweepPost self-limits, so this is a no-op most of the time.
    getNames: publicProcedure.query(async () => {
      const nc = await resolveNameColorCtx();
      try {
        await sweepPost(nc.rawPostId);
      } catch (e) {
        console.error('namecolor getNames sweep failed:', e);
      }

      const username = context.username ?? null;
      const [ranked, mineStr, sweptStr] = await Promise.all([
        ncRanked(nc.rawPostId),
        username ? redis.hGet(ncKeys.byUser(nc.rawPostId), username) : Promise.resolve(undefined),
        redis.get(ncKeys.swept(nc.rawPostId)),
      ]);

      const mineIds: string[] = mineStr ? (JSON.parse(mineStr) as string[]) : [];
      const names = ranked.slice(0, 200).map((r, i) => ({
        id: r.id, rank: i + 1, name: r.name, author: r.author, votes: r.votes, url: r.url, mine: mineIds.includes(r.id),
      }));
      // A player's standing is their BEST single name — summing would reward
      // volume over quality.
      const bestIdx = ranked.findIndex(r => mineIds.includes(r.id));

      return {
        hex: nc.hex, title: nc.title, creator: nc.creator, isCustom: !!nc.creator,
        createdAt: nc.createdAt, username,
        names, totalNames: ranked.length, myNameCount: mineIds.length,
        userRank: bestIdx >= 0 ? bestIdx + 1 : null,
        userBestVotes: bestIdx >= 0 ? ranked[bestIdx]!.votes : null,
        totalVotes: ranked.reduce((a, r) => a + Math.max(0, r.votes), 0),
        lastSweptAt: sweptStr ? Number(sweptStr) : null,
        snoovatars: await buildSnoovatars(ranked.slice(0, 40).map(r => r.author), username),
      };
    }),

    submitName: publicProcedure
      .input(z.object({ name: z.string().max(200) }))
      .mutation(async ({ input }) => {
        const nc = await resolveNameColorCtx();
        const username = context.username ?? null;
        if (!username) return { status: 'error' as const, message: 'Log in to Reddit to name this color.' };

        // Client-side filtering is trivially bypassed, so the real check is here.
        const check = checkName(input.name);
        if (!check.ok) return { status: 'invalid' as const, message: check.reason };

        // No dedupe on spelling and no per-player cap: "Blue" and "blu" are
        // separate answers, and letting voters choose between them is the game.
        // Reddit's own comment rate limit is the only throttle.
        const mineStr = await redis.hGet(ncKeys.byUser(nc.rawPostId), username);
        const mineIds: string[] = mineStr ? (JSON.parse(mineStr) as string[]) : [];

        const stickyId = await redis.get(ncKeys.sticky(nc.rawPostId));
        const text = `**${mdEscape(check.name)}**\n\n^(Name This Color · ${nc.hex} · upvote if you agree)`;

        let comment;
        try {
          comment = stickyId
            ? await reddit.submitComment({
                id: (stickyId.startsWith('t1_') ? stickyId : `t1_${stickyId}`) as `t1_${string}`,
                text, runAs: 'USER',
              })
            : await reddit.submitComment({ id: `t3_${nc.rawPostId}`, text, runAs: 'USER' });
        } catch (e) {
          // New and low-karma accounts are throttled to roughly one comment every
          // few minutes. One name per comment is non-negotiable (bundling them
          // would score the bundle, not the names), so say so plainly instead of
          // looking broken.
          const msg = e instanceof Error ? e.message : String(e);
          if (RATE_LIMIT_RE.test(msg)) {
            return { status: 'ratelimited' as const, message: "Reddit's rate limit — try your next name in a few minutes." };
          }
          console.error('namecolor submitName failed:', e);
          return { status: 'error' as const, message: 'Reddit would not take that comment. Try again in a moment.' };
        }

        const entry: NameEntry = {
          raw: check.name, author: username, permalink: comment.permalink, at: Date.now(),
        };
        const today = new Date().toISOString().split('T')[0]!;
        const statStr = await redis.hGet(ncKeys.stats, username);
        const stats: UserStats = statStr ? (JSON.parse(statStr) as UserStats) : { names: 0, bestVotes: 0, wins: 0 };
        stats.names += 1;

        await Promise.all([
          redis.hSet(ncKeys.entries(nc.rawPostId), { [comment.id]: JSON.stringify(entry) }),
          redis.hSet(ncKeys.byUser(nc.rawPostId), { [username]: JSON.stringify([...mineIds, comment.id]) }),
          // A fresh comment is worth 1 to its author; the sweep replaces this
          // with the real count within the hour.
          redis.zAdd(ncKeys.votes(nc.rawPostId), { member: comment.id, score: 1 }),
          redis.hSet(ncKeys.stats, { [username]: JSON.stringify(stats) }),
          redis.zIncrBy(ncKeys.playsAlltime, username, 1),
          redis.zIncrBy(ncKeys.plays(today), username, 1),
          redis.expire(ncKeys.plays(today), 90 * 24 * 3600),
          seedHallEntry(nc.rawPostId, nc.hex, comment.id, entry),
        ]);

        return {
          status: 'ok' as const,
          name: check.name,
          url: commentUrl(comment.permalink),
        };
      }),

    // Manual pull of fresh vote counts. Respects the same floor the cron does,
    // so mashing it costs nothing.
    refresh: publicProcedure.mutation(async () => {
      const nc = await resolveNameColorCtx();
      return { swept: await sweepPost(nc.rawPostId) };
    }),

    // A live snapshot of the best-scoring names across every color, not a
    // permanent record — these are current vote counts, so the order moves as
    // votes come in and #1 can be overtaken later.
    getHallOfFame: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const size = await redis.zCard(ncKeys.hall);
      const raw = size > 0 ? (await redis.zRange(ncKeys.hall, Math.max(0, size - 50), size - 1, { by: 'rank' })).reverse() : [];

      const metaRaw = raw.length > 0 ? await redis.hMGet(ncKeys.hallMeta, raw.map(r => r.member)) : [];
      const top = raw.flatMap((r, i) => {
        const m = metaRaw[i];
        if (!m) return [];
        const e = JSON.parse(m) as HallEntry;
        return [{ id: r.member, votes: r.score, name: e.name, author: e.author, hex: e.hex, url: commentUrl(e.url) }];
      });

      const [statStr, snoovatars] = await Promise.all([
        username ? redis.hGet(ncKeys.stats, username) : Promise.resolve(undefined),
        buildSnoovatars(top.map(t => t.author), username),
      ]);
      const idx = top.findIndex(t => t.author === username);

      return {
        top, username, snoovatars,
        userRank: idx >= 0 ? idx + 1 : null,
        stats: statStr ? (JSON.parse(statStr) as UserStats) : null,
      };
    }),

    getAnalytics: publicProcedure.query(async () => {
      if (!await isCurrentUserMod()) throw new Error('Not authorized');
      const nc = await resolveNameColorCtx();
      const now = new Date();
      const dates: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(now); d.setDate(d.getDate() - i);
        dates.push(d.toISOString().split('T')[0]!);
      }

      const [dayCounts, alltimeCount, thisPostNames] = await Promise.all([
        Promise.all(dates.map(d => redis.zCard(ncKeys.plays(d)))),
        redis.zCard(ncKeys.playsAlltime),
        redis.hLen(ncKeys.entries(nc.rawPostId)),
      ]);

      return {
        perDay: dates.map((date, i) => ({ date, count: dayCounts[i] ?? 0 })),
        todayCount: dayCounts[0] ?? 0,
        weekTotal: dayCounts.slice(0, 7).reduce((a, b) => a + (b ?? 0), 0),
        monthTotal: dayCounts.reduce((a, b) => a + (b ?? 0), 0),
        alltimeCount,
        thisPostNames,
      };
    }),

    createCustomPost: publicProcedure
      .input(z.object({ hex: z.string(), title: z.string().max(60).optional() }))
      .mutation(async ({ input }) => {
        const username = context.username ?? null;
        const subredditName = context.subredditName;
        if (!username) throw new Error('Not authenticated');
        if (!subredditName) throw new Error('No subreddit');
        if (!isHex(input.hex)) throw new Error('Pick a color first.');

        // The post goes up as the user, so Reddit's own post rate limit applies
        // — and a new account will hit it. Say which wall they hit; "could not
        // post" reads as the app being broken when the fix is to wait.
        try {
          const post = await createNameColorPost(input.hex.toUpperCase(), username, input.title);
          return { postUrl: `https://www.reddit.com/r/${subredditName}/comments/${rawId(post.id)}/` };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (RATE_LIMIT_RE.test(msg)) throw new Error("Reddit's rate limit — try posting again in a few minutes.");
          throw e;
        }
      }),
  }),
});

export type AppRouter = typeof appRouter;

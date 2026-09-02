import { reddit, redis, context } from '@devvit/web/server';
import type { WireTier } from '../../shared/wire-core';

type SpecialConfig = { prefix: string; backgroundColor: string; textColor: 'light' | 'dark' };

const SPECIAL_USERS: Record<string, SpecialConfig> = {
  Poetress: {
    prefix: 'Color Guessr Tester Goddess 🐱',
    backgroundColor: '#FF007F',
    textColor: 'light',
  },
};

const PLAYER_BG = '#46D160';
const PLAYER_TEXT_COLOR = 'light' as const;

function buildStatsPart(stats: { games: number; bestScore: number; totalScore: number }): string {
  const avg = stats.games > 0 ? Math.round(stats.totalScore / stats.games) : 0;
  return `🎨 Best: ${stats.bestScore} | Avg: ${avg} | Games: ${stats.games}`;
}

export async function updateUserFlair(
  username: string,
  stats: { games: number; bestScore: number; totalScore: number }
): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;

  const special = SPECIAL_USERS[username];
  const statsPart = buildStatsPart(stats);
  const text = special ? `${special.prefix} | ${statsPart}` : statsPart;

  try {
    await reddit.setUserFlair({
      subredditName,
      username,
      text,
      backgroundColor: special ? special.backgroundColor : PLAYER_BG,
      textColor: special ? special.textColor : PLAYER_TEXT_COLOR,
    });
  } catch (e) {
    console.error(`setUserFlair failed for ${username}:`, e);
  }
}

export async function applySpecialFlair(username: string): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  const special = SPECIAL_USERS[username];
  if (!special) return;

  const statsStr = await redis.hGet('color-guesser:stats', username);
  const stats = statsStr
    ? (JSON.parse(statsStr) as { games: number; bestScore: number; totalScore: number })
    : null;

  const statsPart = stats && stats.games > 0 ? ` | ${buildStatsPart(stats)}` : '';
  const text = `${special.prefix}${statsPart}`;

  try {
    await reddit.setUserFlair({
      subredditName,
      username,
      text,
      backgroundColor: special.backgroundColor,
      textColor: special.textColor,
    });
  } catch (e) {
    console.error(`applySpecialFlair failed for ${username}:`, e);
  }
}

// ── Post flair ───────────────────────────────────────────────────────────────
// A coloured pill on the board itself. Reddit filters a subreddit by flair
// *template*, so free text would render but never become a browse button —
// hence templates. Note the subreddit must have link flair position set to
// left or right, or Reddit accepts every call here and displays nothing.
type FlairSpec = { text: string; backgroundColor: string; textColor: 'light' | 'dark' };

const FLAIR_KEY = 'post-flair-templates:v2';

const WIRE_FLAIR: Record<WireTier, FlairSpec> = {
  easy: { text: 'EASY', backgroundColor: '#1B7A47', textColor: 'light' },
  medium: { text: 'MEDIUM', backgroundColor: '#B45309', textColor: 'light' },
  hard: { text: 'HARD', backgroundColor: '#9F1239', textColor: 'light' },
};

const DAILY_FLAIR: FlairSpec = { text: 'DAILY', backgroundColor: '#1D4ED8', textColor: 'light' };

// Created lazily on the first post that needs one rather than on app install:
// the install trigger has to answer fast, and a subreddit that never gets a
// board never needs the templates at all.
async function flairTemplateId(subredditName: string, spec: FlairSpec): Promise<string | null> {
  const cached = await redis.hGet(FLAIR_KEY, spec.text);
  if (cached) return cached;

  // Not mod-only: some boards are submitted by the player, and Reddit drops a
  // mod-only flair applied to such a post without reporting an error.
  const shape = {
    subredditName,
    text: spec.text,
    backgroundColor: spec.backgroundColor,
    textColor: spec.textColor,
    allowableContent: 'text' as const,
    modOnly: false,
    allowUserEdits: false,
  };
  try {
    const existing = await reddit.getPostFlairTemplates(subredditName);
    const match = existing.find(t => t.text === spec.text);
    let id: string;
    if (match) {
      id = match.id;
      // An earlier build created these mod-only. Repair in place.
      if (match.modOnly) await reddit.editFlairTemplate({ ...shape, id: match.id });
    } else {
      id = (await reddit.createPostFlairTemplate(shape)).id;
    }
    await redis.hSet(FLAIR_KEY, { [spec.text]: id });
    return id;
  } catch (e) {
    console.error(`post flair: template lookup/create failed for ${spec.text}:`, e);
    return null;
  }
}

// Must be awaited by callers: Devvit tears the request down on return, so a
// floating promise here never actually reaches Reddit.
async function applyPostFlair(postId: string, spec: FlairSpec): Promise<void> {
  const subredditName = context.subredditName;
  if (!subredditName) return;
  const fullId = (postId.startsWith('t3_') ? postId : `t3_${postId}`) as `t3_${string}`;
  try {
    const templateId = await flairTemplateId(subredditName, spec);
    if (!templateId) throw new Error('no flair template');
    await reddit.setPostFlair({ subredditName, postId: fullId, flairTemplateId: templateId });
  } catch (e) {
    console.error(`post flair: template path failed for ${postId} (${spec.text}):`, e);
    // Drop the cache: a stale template id is the likeliest cause.
    try { await redis.hDel(FLAIR_KEY, [spec.text]); } catch { /* noop */ }
    // Free text still renders the badge, it just isn't a browse filter.
    try {
      await reddit.setPostFlair({ subredditName, postId: fullId, text: spec.text });
    } catch (e2) {
      // A post without its badge is still a post — never fail the post over it.
      console.error(`post flair: text path failed for ${postId} (${spec.text}):`, e2);
    }
  }
}

/** EASY/MEDIUM/HARD, measured from the board. Player-created Colorwire only. */
export async function setWireDifficultyFlair(postId: string, tier: WireTier): Promise<void> {
  await applyPostFlair(postId, WIRE_FLAIR[tier]);
}

/** DAILY, for every game mode's once-a-day post. */
export async function setDailyFlair(postId: string): Promise<void> {
  await applyPostFlair(postId, DAILY_FLAIR);
}

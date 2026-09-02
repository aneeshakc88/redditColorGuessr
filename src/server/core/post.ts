import { reddit, redis, context } from '@devvit/web/server';
import { setDailyFlair } from './flair';
import { getDailyColors } from './colors';
import { MASTERMIND_CONFIG, getDailyMastermind } from '../../shared/mastermind-core';
import { getDailyFlagPuzzle, getGauntletRounds } from '../../shared/flag-core';
import { getDailyPuzzle } from '../../shared/wire-core';
import { EQUINOX_BANK, EQUINOX_BANK_N } from '../../shared/equinox-bank';
import { equinoxPuzzleNumber, pickDaily } from '../../shared/equinox-core';
import { NAMECOLOR_CONFIG, randomHex } from '../../shared/namecolor-core';
import { ncKeys, type NameColorMeta } from './namecolor';
import type { ColorTheme } from './color-themes';

const LAUNCH_DATE = new Date('2026-06-05T00:00:00Z');
const FLAG_LAUNCH_DATE = new Date('2026-07-05T00:00:00Z');

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
};

const formatPostDate = (launch = LAUNCH_DATE) => {
  const now = new Date();
  const puzzleNum = Math.max(1, Math.floor((now.getTime() - launch.getTime()) / 86400000) + 1);
  const month = now.toLocaleString('en-US', { month: 'long' });
  return `#${puzzleNum} — ${month} ${ordinal(now.getDate())}, ${now.getFullYear()}`;
};

export const createPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `ColorGuessr ${formatPostDate()}`,
  });

  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  // Fire-and-forget: return early so gRPC response beats keepalive timeout
  void (async () => {
    try {
      const stickyComment = await reddit.submitComment({
        id: postFullId,
        text: '**Score Thread** — Share your Color Guessr results here! Tap "Comment My Score" in the game to post your score.',
        runAs: 'APP',
      });
      await stickyComment.distinguish(true);
      await redis.set(`color-guesser:sticky:${rawPostId}`, stickyComment.id);
    } catch (e) {
      console.error('createPost background sticky failed:', e);
    }
    try {
      const today = new Date().toISOString().split('T')[0]!;
      await getDailyColors(today);
    } catch (e) {
      console.error('createPost background getDailyColors failed:', e);
    }
  })();

  return post;
};

export const createCustomPost = async (creatorUsername: string, title?: string) => {
  const postTitle = title?.trim()
    ? `${title.trim()} — Custom ColorGuessr by u/${creatorUsername}`
    : `Custom ColorGuessr by u/${creatorUsername}`;

  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: postTitle,
    runAs: 'USER',
    userGeneratedContent: { text: postTitle },
  });

  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  await redis.set(`color-guesser:post-type:${rawPostId}`, 'custom');
  await redis.set(`color-guesser:custom-meta:${rawPostId}`, JSON.stringify({ creator: creatorUsername }));

  const stickyComment = await reddit.submitComment({
    id: postFullId,
    text: `**Custom ColorGuessr by u/${creatorUsername}** — Share your results here! Tap "Comment My Score" to post your score.`,
    runAs: 'APP',
  });
  await stickyComment.distinguish(true);
  await redis.set(`color-guesser:sticky:${rawPostId}`, stickyComment.id);

  return post;
};

export const createMastermindPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const day = now.getDate();
  const year = now.getFullYear();
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `Crack the Code — ${month} ${day}, ${year}`,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;
  // Freeze the code to this post's creation date, the same way flag/wire posts
  // snapshot theirs — otherwise an old post plays whatever today's code is.
  const dateStr = new Date().toISOString().split('T')[0]!;
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'mastermind-daily'),
    redis.set(`mastermind:date:${rawPostId}`, dateStr),
    redis.set(`mastermind:snapshot:${rawPostId}`, JSON.stringify(getDailyMastermind(dateStr))),
  ]);
  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: `**Crack the Code Score Thread** — Can you crack the secret ${MASTERMIND_CONFIG.daily.secretLen}-color code? Share your results here!`,
        runAs: 'APP',
      });
      await sticky.distinguish(true);
    } catch (e) {
      console.error('createMastermindPost sticky failed:', e);
    }
  })();
  await setDailyFlair(post.id);
  return post;
};

export const createFlagPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `Flag ColorGuessr ${formatPostDate(FLAG_LAUNCH_DATE)}`,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  // Snapshot this post to its creation date. Puzzle content is frozen per-post so
  // old posts remain an exact archive even if FLAGS_DATA or the picker later change.
  const today = new Date().toISOString().split('T')[0]!;
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'flag-daily'),
    redis.set(`flag:date:${rawPostId}`, today),
    redis.set(`flag:snapshot:${rawPostId}`, JSON.stringify(getDailyFlagPuzzle(today))),
  ]);
  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: '**Flag ColorGuessr Score Thread** — One colour is wrong in each flag. How sharp is your colour memory? Share your results here!',
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(`flag:sticky:${rawPostId}`, sticky.id);
    } catch (e) {
      console.error('createFlagPost background sticky failed:', e);
    }
  })();
  await setDailyFlair(post.id);
  return post;
};

// Dev-only sibling of createFlagPost: every playable region as its own round, so the
// real game chrome can be paged through on a device. Progress lives under its own
// `gauntlet-<date>` namespace and never touches the daily leaderboard.
export const createFlagGauntletPost = async () => {
  const subredditName = context.subredditName;
  const rounds = getGauntletRounds();
  const post = await reddit.submitCustomPost({
    subredditName,
    title: `[dev] Flag Gauntlet — all ${rounds.length} rounds`,
  });
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;
  const today = new Date().toISOString().split('T')[0]!;
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'flag-daily'),
    redis.set(`flag:date:${rawPostId}`, `gauntlet-${today}`),
    redis.set(`flag:gauntlet:${rawPostId}`, '1'),
  ]);
  return post;
};

export const createMemoryPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `The Run — Color Memory ${month} ${ordinal(now.getDate())}, ${now.getFullYear()}`,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;
  await redis.set(`color-guesser:post-type:${rawPostId}`, 'memory-daily');
  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: '**The Run — Score Thread** — Memorize the stack, then rebuild it. Each clear grows the stack by one. How deep can you go? Share your depth here!',
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(`memory:sticky:${rawPostId}`, sticky.id);
    } catch (e) {
      console.error('createMemoryPost background sticky failed:', e);
    }
  })();
  await setDailyFlair(post.id);
  return post;
};

// Mod-dropped bonus Run. Numbered per-day (Bonus #1, #2, …), own leaderboard,
// distinct puzzle (seed variant = bonus number). Isolated from the daily.
export const createBonusMemoryPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const now = new Date();
  const today = now.toISOString().split('T')[0]!;
  const n = await redis.incrBy(`memory:bonus-count:${today}`, 1);
  const month = now.toLocaleString('en-US', { month: 'long' });
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `The Run — Bonus #${n} — ${month} ${ordinal(now.getDate())}, ${now.getFullYear()}`,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'memory-bonus'),
    redis.set(`memory:bonus:${rawPostId}`, JSON.stringify({ date: today, n })),
  ]);
  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: `**The Run — Bonus #${n} Score Thread** — A fresh stack, just for fun. Doesn't touch your daily streak. How deep can you go? Share your depth here!`,
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(`memory:sticky:${rawPostId}`, sticky.id);
    } catch (e) {
      console.error('createBonusMemoryPost background sticky failed:', e);
    }
  })();
  return post;
};

export const createWirePost = async (title?: string) => {
  const subredditName = context.subredditName;
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `Colorwire — ${month} ${ordinal(now.getDate())}, ${now.getFullYear()}`,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  // Snapshot the board to the creation date so the post stays an exact archive
  // even if the generator changes later. The solution is deliberately not
  // stored — the client never needs it and submissions are checked, not compared.
  const today = new Date().toISOString().split('T')[0]!;
  const puzzle = getDailyPuzzle(today);
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'wire-daily'),
    redis.set(`wire:date:${rawPostId}`, today),
    redis.set(`wire:snapshot:${rawPostId}`, JSON.stringify({ w: puzzle.w, h: puzzle.h, pairs: puzzle.pairs })),
  ]);
  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: '**Colorwire Score Thread** — Connect every pair, fill every cell, no crossing wires. Share your time here!',
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(`wire:sticky:${rawPostId}`, sticky.id);
    } catch (e) {
      console.error('createWirePost background sticky failed:', e);
    }
  })();
  await setDailyFlair(post.id);
  return post;
};

export const createEquinoxPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const today = now.toISOString().split('T')[0]!;

  // The very first post ever made becomes the anchor, so whenever Equinox goes
  // live that board is #1 — no build-time date to keep in sync with review.
  let launch = await redis.get('equinox:first-date');
  if (!launch) {
    launch = today;
    await redis.set('equinox:first-date', today);
  }
  const puzzleNum = equinoxPuzzleNumber(today, launch);

  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || `Equinox #${puzzleNum} — ${month} ${ordinal(now.getDate())}, ${now.getFullYear()}`,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  // Snapshot the board AND its number so neither a regenerated bank nor a lost
  // anchor can renumber an already-published post.
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'equinox-daily'),
    redis.set(`equinox:date:${rawPostId}`, today),
    redis.set(`equinox:num:${rawPostId}`, String(puzzleNum)),
    redis.set(`equinox:snapshot:${rawPostId}`, JSON.stringify({ n: EQUINOX_BANK_N, ...pickDaily(EQUINOX_BANK, today) })),
  ]);
  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: `**Equinox #${puzzleNum} Score Thread** — Every row and column needs ${EQUINOX_BANK_N / 2} orange and ${EQUINOX_BANK_N / 2} navy. Numbers count matching neighbours, and no two lines side by side may be identical. Share your time here!`,
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(`equinox:sticky:${rawPostId}`, sticky.id);
    } catch (e) {
      console.error('createEquinoxPost background sticky failed:', e);
    }
  })();
  await setDailyFlair(post.id);
  return post;
};

// "Name This Color" — a random swatch with no right answer. Players comment
// names, upvotes rank them. The sticky matters more here than elsewhere: every
// name is a reply to it, so the sweep and the vote thread share one root.
export const createNameColorPost = async (hex?: string, creator?: string, title?: string) => {
  const subredditName = context.subredditName;
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const postTitle = creator
    ? (title?.trim() ? `${title.trim()} — Name This Color by u/${creator}` : `Name This Color by u/${creator}`)
    : (title?.trim() || `Name This Color — ${month} ${ordinal(now.getDate())}, ${now.getFullYear()}`);

  const chosenHex = hex ?? randomHex();

  // The color rides along on the post itself. Without it the card paints a
  // neutral placeholder, waits for getSplash, then visibly repaints in the real
  // color under the reader — on a game about judging one color, that first wrong
  // color is the worst thing the card can show. postData reaches the client
  // before any request is made, so the very first paint is already right.
  const post = await reddit.submitCustomPost({
    subredditName,
    title: postTitle,
    postData: { hex: chosenHex },
    ...(creator ? { runAs: 'USER' as const, userGeneratedContent: { text: title?.trim() || postTitle } } : {}),
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  const meta: NameColorMeta = {
    hex: chosenHex,
    createdAt: Date.now(),
    creator: creator ?? null,
    title: title?.trim() || null,
  };
  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, creator ? 'namecolor-custom' : 'namecolor-daily'),
    redis.set(ncKeys.post(rawPostId), JSON.stringify(meta)),
    // The sweep works off this set, so the post has to be in it before any
    // name can be submitted.
    redis.zAdd(ncKeys.active, { member: rawPostId, score: meta.createdAt }),
  ]);

  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: `**Name Thread — ${meta.hex}** — There's no right answer. Submit a name in the post, then upvote the names you like best. Nothing ever closes: a standings comment lands here each day for the first ${NAMECOLOR_CONFIG.recapDays} days, and names and votes keep counting long after that.`,
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(ncKeys.sticky(rawPostId), sticky.id);
    } catch (e) {
      console.error('createNameColorPost background sticky failed:', e);
    }
  })();

  // Custom boards carry their creator; only the once-a-day drop is DAILY.
  if (!creator) await setDailyFlair(post.id);
  return post;
};

// App-authored custom ColorGuessr, pre-seeded with a fixed color theme (no
// human creator). Used by the scheduled cron slots, not the mod menu.
const SCHEDULED_CREATOR = 'ColorGuessr';

export const createThemedCustomPost = async (theme: ColorTheme) => {
  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: theme.title,
  });
  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  await Promise.all([
    redis.set(`color-guesser:post-type:${rawPostId}`, 'custom'),
    redis.set(`color-guesser:custom-meta:${rawPostId}`, JSON.stringify({ creator: SCHEDULED_CREATOR })),
    redis.set(`color-guesser:custom:${rawPostId}`, JSON.stringify({
      colors: theme.colors,
      hints: theme.colors.map(() => ''),
      creator: SCHEDULED_CREATOR,
      title: theme.title,
      inputMode: 'slider',
      createdAt: new Date().toISOString(),
    })),
  ]);

  void (async () => {
    try {
      const sticky = await reddit.submitComment({
        id: postFullId,
        text: `**${theme.title}** — Share your results here! Tap "Comment My Score" in the game to post your score.`,
        runAs: 'APP',
      });
      await sticky.distinguish(true);
      await redis.set(`color-guesser:sticky:${rawPostId}`, sticky.id);
    } catch (e) {
      console.error('createThemedCustomPost background sticky failed:', e);
    }
  })();

  return post;
};

export const createLeaderboardPost = async (title?: string) => {
  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: title?.trim() || 'ColorGuessr — Global Leaderboard',
  });
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;
  await redis.set(`color-guesser:post-type:${rawPostId}`, 'leaderboard');
  return post;
};

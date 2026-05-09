import { initTRPC } from '@trpc/server';
import { transformer } from '../shared/transformer';
import { Context } from './context';
import { context, reddit, redis } from '@devvit/web/server';
import { countDecrement, countGet, countIncrement } from './core/count';
import { calculateScore } from './core/game';
import { fetchAllPizzaColors, getDailyColors, PuzzleColor } from './core/colors';
import { createCustomPost } from './core/post';
import { z } from 'zod';

const t = initTRPC.context<Context>().create({ transformer });

export const router = t.router;
export const publicProcedure = t.procedure;

const rawId = (id: string) => id.startsWith('t3_') ? id.slice(3) : id;


async function getAvatarUrl(username: string): Promise<string | undefined> {
  const cacheKey = `color-guesser:avatar:${username}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached === 'none' ? undefined : cached;

  try {
    const res = await fetch(`https://www.reddit.com/user/${username}/about.json`, {
      headers: { 'User-Agent': 'devvit-color-guesser/1.0' },
    });
    if (!res.ok) { await redis.set(cacheKey, 'none', { expiration: new Date(Date.now() + 3600_000) }); return undefined; }
    const data = await res.json() as { data?: { snoovatar_img?: string; icon_img?: string } };
    const url = (data.data?.snoovatar_img || data.data?.icon_img || '').replace(/&amp;/g, '&');
    const result = url || undefined;
    await redis.set(cacheKey, result ?? 'none', { expiration: new Date(Date.now() + 3600_000) });
    return result;
  } catch {
    return undefined;
  }
}

type UserProgress = { guesses: ({ hex: string; score: number; actualHex: string; actualName: string } | null)[]; totalScore: number; completed: boolean };

// One-time migration: old data lived at string key color-guesser:stats:{username},
// new code uses a single hash color-guesser:stats. Uses plays:alltime as the user index.
async function migrateStatsToHash(): Promise<void> {
  const done = await redis.get('color-guesser:stats-migrated');
  if (done) return;

  const size = await redis.zCard('color-guesser:plays:alltime');
  if (size > 0) {
    const allEntries = await redis.zRange('color-guesser:plays:alltime', 0, size - 1, { by: 'rank' });
    const members = allEntries.map(e => e.member);
    const values = await redis.mGet(members.map(m => `color-guesser:stats:${m}`));
    await Promise.all(
      members.flatMap((m, i) => {
        const v = values[i];
        return v ? [redis.hSet('color-guesser:stats', m, v)] : [];
      })
    );
  }

  await redis.set('color-guesser:stats-migrated', '1');
}

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

    getLeaderboard: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const today = new Date().toISOString().split('T')[0]!;

      // Detect custom post
      const postId = context.postId;
      const rId = postId ? rawId(postId) : null;
      const postType = rId ? await redis.get(`color-guesser:post-type:${rId}`) : null;
      const isCustomPost = postType === 'custom';

      let activeKey: string;
      let lbMode: 'alltime' | 'daily' | 'custom';
      let dailyCount = 0;

      if (isCustomPost && rId) {
        activeKey = `color-guesser:custom-lb:${rId}`;
        lbMode = 'custom';
        // Backfill: user completed before custom-lb existed — add their score on first leaderboard open
        if (username) {
          const existing = await redis.zScore(activeKey, username);
          if (existing === null) {
            const progressStr = await redis.get(`color-guesser:custom:${rId}:${username}`);
            const progress = progressStr ? (JSON.parse(progressStr) as UserProgress) : null;
            if (progress?.completed) {
              await redis.zAdd(activeKey, { score: progress.totalScore, member: username });
            }
          }
        }
      } else {
        const lbKey = `color-guesser:lb:${today}`;
        const alltimeKey = `color-guesser:lb:alltime`;
        const [dc, ac] = await Promise.all([redis.zCard(lbKey), redis.zCard(alltimeKey)]);
        dailyCount = dc;
        const useAlltime = dc < 100 && ac > 0;
        activeKey = useAlltime ? alltimeKey : lbKey;
        lbMode = useAlltime ? 'alltime' : 'daily';
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
          await redis.hSet('color-guesser:stats', username, oldVal);
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

      return { top, userRank, userScore, username: username ?? null, stats, lbMode, dailyCount, isAlltime: lbMode === 'alltime', snoovatars };
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
        if (creator) creatorAvatar = (await getAvatarUrl(creator)) ?? null;
      }

      return {
        postType: isCustom ? 'custom' as const : 'daily' as const,
        creator,
        creatorAvatar,
        solvedCount,
        userRank,
        userScore: userScore ?? null,
        userAvatar: context.snoovatar ?? null,
        username,
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
          if (!raw) raw = await redis.hGet('color-guesser:stats', member);
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

      const avatarCandidates = [...new Set([
        ...entries.slice(0, 50).map(e => e.member),
        ...(username ? [username] : []),
      ])];
      const avatarResults = await Promise.all(avatarCandidates.map(m => getAvatarUrl(m)));
      const snoovatars: Record<string, string> = {};
      avatarCandidates.forEach((m, i) => { if (avatarResults[i]) snoovatars[m] = avatarResults[i]!; });
      if (username && context.snoovatar) snoovatars[username] = context.snoovatar;

      return { entries, username, snoovatars };
    }),

    getPostInfo: publicProcedure.query(async () => {
      const username = context.username ?? null;
      const postId = context.postId;
      if (!postId) return { postType: 'daily' as const, isCreator: false, configured: false, creator: null as string | null, title: null as string | null };

      const rId = rawId(postId);
      const postType = await redis.get(`color-guesser:post-type:${rId}`);
      if (postType === 'leaderboard') return { postType: 'leaderboard' as const, isCreator: false, configured: true, creator: null as string | null, title: null as string | null };
      if (postType !== 'custom') return { postType: 'daily' as const, isCreator: false, configured: false, creator: null as string | null, title: null as string | null };

      const [customStr, metaStr] = await Promise.all([
        redis.get(`color-guesser:custom:${rId}`),
        redis.get(`color-guesser:custom-meta:${rId}`),
      ]);
      const meta = metaStr ? (JSON.parse(metaStr) as { creator: string }) : null;
      const customData = customStr ? (JSON.parse(customStr) as { title?: string }) : null;

      return {
        postType: 'custom' as const,
        isCreator: meta?.creator === username,
        configured: !!customStr,
        creator: meta?.creator ?? null,
        title: customData?.title ?? null,
      };
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
        if (oldVal) { statsStr = oldVal; await redis.hSet('color-guesser:stats', username, oldVal); }
      }
      const userStats = statsStr
        ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number })
        : null;

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
          // Stats update on every first completion — daily and custom combined
          const statsStr = await redis.hGet('color-guesser:stats', username);
          const prev = statsStr ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number }) : null;
          const next = prev
            ? { games: prev.games + 1, totalScore: prev.totalScore + progress.totalScore, bestScore: Math.max(prev.bestScore, progress.totalScore) }
            : { games: 1, totalScore: progress.totalScore, bestScore: progress.totalScore };
          await redis.hSet('color-guesser:stats', username, JSON.stringify(next));

          const monthKey = `color-guesser:plays:${today.slice(0, 7)}`;
          if (!isCustom) {
            // Daily leaderboard — first score only (submitGuess only runs on first play; replays bypass via replayMode)
            const lbKey = `color-guesser:lb:${today}`;
            await Promise.all([
              redis.zAdd(lbKey, { score: progress.totalScore, member: username }),
              redis.expire(lbKey, 3 * 24 * 3600),
              redis.zIncrBy('color-guesser:plays:alltime', 1, username),
              redis.zIncrBy(monthKey, 1, username),
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
              redis.zIncrBy('color-guesser:plays:alltime', 1, username),
              redis.zIncrBy(monthKey, 1, username),
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
        const replayMonth = new Date().toISOString().slice(0, 7);
        const replayMonthKey = `color-guesser:plays:${replayMonth}`;
        await Promise.all([
          redis.hSet('color-guesser:stats', username, JSON.stringify(next)),
          redis.zIncrBy('color-guesser:plays:alltime', 1, username),
          redis.zIncrBy(replayMonthKey, 1, username),
          redis.expire(replayMonthKey, 90 * 24 * 3600),
        ]);

        // Backfill custom lb if user completed before this code was deployed
        if (input.postType === 'custom' && context.postId) {
          const rId = rawId(context.postId);
          const customLbKey = `color-guesser:custom-lb:${rId}`;
          const existing = await redis.zScore(customLbKey, username);
          if (existing === null) {
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

        await redis.set(`color-guesser:custom:${rId}`, JSON.stringify({
          colors: input.colors,
          hints: input.hints ?? input.colors.map(() => ''),
          creator: username,
          title: input.title ?? '',
          inputMode: input.inputMode ?? 'slider',
          createdAt: new Date().toISOString(),
        }));

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

        const statsStr = username ? await redis.hGet('color-guesser:stats', username) : null;
        const stats = statsStr
          ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number })
          : { games: 1, totalScore: input.total, bestScore: input.total };
        const avg = Math.round(stats.totalScore / stats.games);

        const scoreEmoji = (s: number) => s >= 17 ? '🟩' : s >= 13 ? '🟨' : s >= 9 ? '🟧' : '🟥';

        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(`\`Best: ${stats.bestScore} | Avg: ${avg} | Games: ${stats.games}\``);
        lines.push('');
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
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

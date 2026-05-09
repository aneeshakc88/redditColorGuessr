import { initTRPC } from '@trpc/server';
import { transformer } from '../shared/transformer';
import { Context } from './context';
import { context, reddit, redis } from '@devvit/web/server';
import { countDecrement, countGet, countIncrement } from './core/count';
import { getDailyPuzzle, calculateScore } from './core/game';
import { z } from 'zod';

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
  transformer,
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

export const appRouter = t.router({
  init: t.router({
    get: publicProcedure.query(async () => {
      const [count, username] = await Promise.all([
        countGet(),
        reddit.getCurrentUsername(),
      ]);

      return {
        count,
        postId: context.postId,
        username,
      };
    }),
  }),
  counter: t.router({
    increment: publicProcedure
      .input(z.number().optional())
      .mutation(async ({ input }) => {
        const { postId } = context;
        return {
          count: await countIncrement(input),
          postId,
          type: 'increment',
        };
      }),
    decrement: publicProcedure
      .input(z.number().optional())
      .mutation(async ({ input }) => {
        const { postId } = context;
        return {
          count: await countDecrement(input),
          postId,
          type: 'decrement',
        };
      }),
    get: publicProcedure.query(async () => {
      return await countGet();
    }),
  }),
  game: t.router({
    getPuzzle: publicProcedure.query(async () => {
      const username = await reddit.getCurrentUsername();
      const puzzle = getDailyPuzzle();
      const today = new Date().toISOString().split('T')[0];
      const userKey = `ColorGuessr:${username}:${today}`;

      // Get user's progress on today's puzzle
      const userProgressStr = await redis.get(userKey);
      const userProgress = userProgressStr ? JSON.parse(userProgressStr) : { guesses: [], totalScore: 0, completed: false };

      return {
        colors: puzzle.map((c) => ({ name: c.name, hex: c.hex })),
        totalRounds: puzzle.length,
        completedRounds: userProgress.guesses.length,
        totalScore: userProgress.totalScore,
        completed: userProgress.completed,
        date: today,
      };
    }),

    submitGuess: publicProcedure
      .input(
        z.object({
          roundIndex: z.number().min(0).max(4),
          guessHex: z.string().startsWith('#'),
        })
      )
      .mutation(async ({ input }) => {
        const username = await reddit.getCurrentUsername();
        const puzzle = getDailyPuzzle();
        const today = new Date().toISOString().split('T')[0];
        const userKey = `ColorGuessr:${username}:${today}`;

        // Validate round index
        if (input.roundIndex < 0 || input.roundIndex >= puzzle.length) {
          throw new Error('Invalid round index');
        }

        const actualColor = puzzle[input.roundIndex];
        if (!actualColor) {
          throw new Error('Color not found for this round');
        }

        const score = calculateScore(actualColor.hex, input.guessHex);

        // Get current progress
        const userProgressStr = await redis.get(userKey);
        const userProgress = userProgressStr
          ? JSON.parse(userProgressStr)
          : { guesses: [], totalScore: 0, completed: false };

        // Check if already guessed this round
        if (userProgress.guesses[input.roundIndex]) {
          throw new Error('Already guessed this round');
        }

        // Add guess
        userProgress.guesses[input.roundIndex] = {
          hex: input.guessHex,
          score,
          actualHex: actualColor.hex,
          actualName: actualColor.name,
        };

        // Update total score
        userProgress.totalScore = userProgress.guesses.reduce((sum: number, g: any) => sum + (g?.score ?? 0), 0);

        // Check if completed
        const wasCompleted = userProgress.completed;
        userProgress.completed = userProgress.guesses.filter(Boolean).length === puzzle.length;

        // Save progress (expires after 2 days)
        await redis.set(userKey, JSON.stringify(userProgress), {
          expiration: new Date(Date.now() + 172800 * 1000),
        });

        // Update lifetime stats when game first completes
        if (!wasCompleted && userProgress.completed && username) {
          const statsKey = `ColorGuessr:stats:${username}`;
          const statsStr = await redis.get(statsKey);
          const prev = statsStr ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number }) : null;
          const next = prev
            ? { games: prev.games + 1, totalScore: prev.totalScore + userProgress.totalScore, bestScore: Math.max(prev.bestScore, userProgress.totalScore) }
            : { games: 1, totalScore: userProgress.totalScore, bestScore: userProgress.totalScore };
          await redis.set(statsKey, JSON.stringify(next));
        }

        return {
          score,
          actualHex: actualColor.hex,
          actualName: actualColor.name,
          totalScore: userProgress.totalScore,
          roundsCompleted: userProgress.guesses.length,
          completed: userProgress.completed,
        };
      }),

    postComment: publicProcedure
      .input(z.object({
        text: z.string().max(500),
        total: z.number().min(0).max(100),
        date: z.string(),
        rounds: z.array(z.object({ name: z.string(), score: z.number() })),
      }))
      .mutation(async ({ input }) => {
        const username = await reddit.getCurrentUsername();
        const postId = context.postId;
        if (!postId) throw new Error('No post ID available');

        // Fetch lifetime stats
        const statsKey = `ColorGuessr:stats:${username}`;
        const statsStr = await redis.get(statsKey);
        const stats = statsStr
          ? (JSON.parse(statsStr) as { games: number; totalScore: number; bestScore: number })
          : { games: 1, totalScore: input.total, bestScore: input.total };

        const avg = Math.round(stats.totalScore / stats.games);

        // Format date: "Mon, Apr 20"
        const [y, m, d] = input.date.split('-').map(Number);
        const dt = new Date(y!, m! - 1, d!);
        const dateStr = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

        const scoreEmoji = (s: number) => s >= 17 ? '🟩' : s >= 13 ? '🟨' : s >= 9 ? '🟧' : '🟥';

        // Build comment
        const lines: string[] = [];
        if (input.text.trim()) { lines.push(input.text.trim()); lines.push(''); }
        lines.push(`**Color Guessr — ${dateStr}**`);
        lines.push(`\`Best: ${stats.bestScore} | Avg: ${avg} | Games: ${stats.games}\``);
        lines.push(`**${input.total}/100**`);
        lines.push('');
        lines.push(input.rounds.map((r) => scoreEmoji(r.score)).join(''));

        // context.postId may already be a fullname (t3_xxx) or just the ID
        const fullId = postId.startsWith('t3_') ? postId : `t3_${postId}`;
        await reddit.submitComment({ id: fullId, text: lines.join('\n') });
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;

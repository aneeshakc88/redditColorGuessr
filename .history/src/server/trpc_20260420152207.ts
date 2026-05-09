import { initTRPC } from '@trpc/server';
import { transformer } from '../shared/transformer';
import { Context } from './context';
import { context, reddit, redis } from '@devvit/web/server';
import { countDecrement, countGet, countIncrement } from './core/count';
import { getDailyPuzzle, calculateScore, COLOR_PALETTE } from './core/game';
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
      const userKey = `color-guesser:${username}:${today}`;

      // Get user's progress on today's puzzle
      const userProgressStr = await redis.get(userKey);
      const userProgress = userProgressStr ? JSON.parse(userProgressStr) : { guesses: [], totalScore: 0, completed: false };

      return {
        colors: puzzle.map((c) => ({ name: c.name })),
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
        const userKey = `color-guesser:${username}:${today}`;

        // Validate round index
        if (input.roundIndex < 0 || input.roundIndex >= puzzle.length) {
          throw new Error('Invalid round index');
        }

        const actualColor = puzzle[input.roundIndex];
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
        userProgress.completed = userProgress.guesses.length === puzzle.length;

        // Save progress (expires after 1 day)
        await redis.set(userKey, JSON.stringify(userProgress), {
          expiration: 86400,
        });

        return {
          score,
          actualHex: actualColor.hex,
          actualName: actualColor.name,
          totalScore: userProgress.totalScore,
          roundsCompleted: userProgress.guesses.length,
          completed: userProgress.completed,
        };
      }),
  }),
});

export type AppRouter = typeof appRouter;

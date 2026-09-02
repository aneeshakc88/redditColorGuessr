import { describe, expect, it } from 'vitest';
import { EQUINOX_BANK, EQUINOX_BANK_N } from './equinox-bank';
import {
  EMPTY, EQUINOX_CONFIG, countSolutions, decodePuzzle, pickDaily, sameNeighbourCount, solveLogical,
  verifyPuzzle, violations,
} from './equinox-core';

// The bank is what actually ships. Every board in it is re-checked here, so a
// puzzle that is ambiguous or needs guesswork fails the build rather than the
// player. If this ever goes red, regenerate with `npm run equinox-bank`.
describe('the shipped puzzle bank', () => {
  it('is big enough that boards do not repeat for a year', () => {
    expect(EQUINOX_BANK.length).toBeGreaterThanOrEqual(365);
  });

  it('matches the daily board size', () => {
    expect(EQUINOX_BANK_N).toBe(EQUINOX_CONFIG.dailyN);
  });

  it('holds no duplicate boards', () => {
    const keys = new Set(EQUINOX_BANK.map(e => `${e.clues}|${e.numbers}`));
    expect(keys.size).toBe(EQUINOX_BANK.length);
  });

  it('ships only boards that are unique, deducible and worth playing', () => {
    EQUINOX_BANK.forEach((entry, index) => {
      const puzzle = decodePuzzle({ n: EQUINOX_BANK_N, ...entry });
      const total = EQUINOX_BANK_N * EQUINOX_BANK_N;

      expect(puzzle.clues, `#${index}`).toHaveLength(total);
      expect(puzzle.clues.includes(-1), `#${index} bad clue character`).toBe(false);

      const empties = puzzle.clues.filter(c => c === EMPTY).length;
      expect(empties, `#${index} nothing left to solve`).toBeGreaterThan(0);
      expect(total - empties, `#${index} too bare`).toBeGreaterThanOrEqual(6);

      // Numbers only ever sit on a coloured clue.
      for (let i = 0; i < total; i++) {
        if (puzzle.numbers[i]! >= 0) expect(puzzle.clues[i], `#${index} number on empty cell ${i}`).not.toBe(EMPTY);
      }

      // The clues alone must not already break a rule.
      expect(violations(EQUINOX_BANK_N, puzzle.clues, puzzle.numbers), `#${index} clues break a rule`).toEqual([]);

      // Deduction alone finishes it, with no guessing.
      const logical = solveLogical(puzzle);
      expect(logical.solved, `#${index} needs guesswork`).toBe(true);

      // Exactly one answer exists, and the search actually finished.
      const exhaustive = countSolutions(puzzle, 3);
      expect(exhaustive.exhausted, `#${index} search budget ran out`).toBe(true);
      expect(exhaustive.count, `#${index}`).toBe(1);
      expect(exhaustive.first, `#${index} solvers disagree`).toEqual(logical.cells);

      // The answer obeys all three rules, and every number matches it.
      expect(violations(EQUINOX_BANK_N, logical.cells, puzzle.numbers), `#${index}`).toEqual([]);
      for (let i = 0; i < total; i++) {
        if (puzzle.numbers[i]! >= 0) {
          expect(puzzle.numbers[i], `#${index} number ${i}`).toBe(sameNeighbourCount(logical.cells, i, EQUINOX_BANK_N));
        }
      }

      expect(verifyPuzzle(puzzle), `#${index}`).toEqual({ ok: true });
    });
  });

  it('gives every board a number clue to hang the deduction on', () => {
    const bare = EQUINOX_BANK.filter(e => !/[0-8]/.test(e.numbers));
    expect(bare).toHaveLength(0);
  });

  it('serves a decodable board for a year of dates', () => {
    for (let d = 0; d < 365; d++) {
      const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().split('T')[0]!;
      const puzzle = decodePuzzle({ n: EQUINOX_BANK_N, ...pickDaily(EQUINOX_BANK, date) });
      expect(solveLogical(puzzle).solved, date).toBe(true);
    }
  });
});

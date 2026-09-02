import { describe, expect, it } from 'vitest';
import {
  EMPTY, EQUINOX_CONFIG, EQUINOX_LAUNCH_DATE, NAVY, ORANGE, countSolutions, decodePuzzle, encodePuzzle,
  equinoxPuzzleNumber, equinoxScore,
  generatePuzzle, generateSolution, mulberry32, pickDaily, sameNeighbourCount, solveLogical,
  verifyPuzzle, violations, type EquinoxPuzzle,
} from './equinox-core';
import { EQUINOX_BANK } from './equinox-bank';

const none = (n: number) => new Array<number>(n * n).fill(-1);

const boardIsLegal = (n: number, cells: number[]) => {
  expect(cells).toHaveLength(n * n);
  expect(cells.every(c => c === ORANGE || c === NAVY)).toBe(true);
  expect(violations(n, cells, none(n))).toEqual([]);
};

describe('neighbour counting', () => {
  it('counts the 8 surrounding cells and never the cell itself', () => {
    // O O N
    // O N N
    // N O O
    const cells = [ORANGE, ORANGE, NAVY, ORANGE, NAVY, NAVY, NAVY, ORANGE, ORANGE];
    expect(sameNeighbourCount(cells, 4, 3)).toBe(3); // centre navy: 2, 5, 6
    expect(sameNeighbourCount(cells, 0, 3)).toBe(2); // corner orange: 1, 3
    expect(sameNeighbourCount(cells, 1, 3)).toBe(2); // edge orange: 0, 3
  });
});

describe('rule checking', () => {
  it('accepts a legal board', () => {
    // O N O N
    // N O N O
    // O O N N
    // N N O O
    const cells = [
      ORANGE, NAVY, ORANGE, NAVY,
      NAVY, ORANGE, NAVY, ORANGE,
      ORANGE, ORANGE, NAVY, NAVY,
      NAVY, NAVY, ORANGE, ORANGE,
    ];
    expect(violations(4, cells, none(4))).toEqual([]);
  });

  it('flags an unbalanced row and the columns it breaks', () => {
    const cells = [
      ORANGE, ORANGE, ORANGE, NAVY,
      NAVY, ORANGE, NAVY, ORANGE,
      ORANGE, NAVY, ORANGE, NAVY,
      NAVY, NAVY, NAVY, ORANGE,
    ];
    const found = violations(4, cells, none(4));
    expect(found).toContainEqual({ kind: 'row', index: 0 });
  });

  it('flags identical adjacent rows and columns', () => {
    const cells = [
      ORANGE, ORANGE, NAVY, NAVY,
      ORANGE, ORANGE, NAVY, NAVY,
      NAVY, NAVY, ORANGE, ORANGE,
      NAVY, NAVY, ORANGE, ORANGE,
    ];
    const found = violations(4, cells, none(4));
    expect(found).toContainEqual({ kind: 'twin-rows', a: 0, b: 1 });
    expect(found).toContainEqual({ kind: 'twin-cols', a: 0, b: 1 });
  });

  it('flags a number that has too many or too few matches', () => {
    const cells = [
      ORANGE, NAVY, ORANGE, NAVY,
      NAVY, ORANGE, NAVY, ORANGE,
      ORANGE, ORANGE, NAVY, NAVY,
      NAVY, NAVY, ORANGE, ORANGE,
    ];
    const numbers = none(4);
    numbers[5] = sameNeighbourCount(cells, 5, 4);
    expect(violations(4, cells, numbers)).toEqual([]);

    numbers[5] += 1;
    expect(violations(4, cells, numbers)).toContainEqual({ kind: 'number', cell: 5 });
  });

  it('stays quiet on a partly filled board that is still salvageable', () => {
    const cells = new Array<number>(16).fill(EMPTY);
    cells[0] = ORANGE;
    cells[1] = ORANGE;
    expect(violations(4, cells, none(4))).toEqual([]);
  });
});

describe('solution generation', () => {
  it('builds legal boards at 4x4, 6x6 and 8x8', () => {
    for (const n of [4, 6, 8]) {
      for (let s = 0; s < 25; s++) {
        const cells = generateSolution(n, mulberry32(s * 7919 + n));
        expect(cells, `n=${n} seed=${s}`).not.toBeNull();
        boardIsLegal(n, cells!);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    expect(generateSolution(6, mulberry32(42))).toEqual(generateSolution(6, mulberry32(42)));
  });
});

describe('puzzle generation', () => {
  const sizes: [number, number][] = [[4, 40], [6, 60], [8, 20]];

  for (const [n, runs] of sizes) {
    it(`produces uniquely and logically solvable ${n}x${n} boards`, () => {
      for (let s = 0; s < runs; s++) {
        const gen = generatePuzzle(n, s * 1_000_003 + n);
        expect(gen, `n=${n} seed=${s}`).not.toBeNull();
        const { puzzle, solution } = gen!;

        boardIsLegal(n, solution);

        // Clues and numbers must agree with the answer they came from.
        for (let i = 0; i < n * n; i++) {
          if (puzzle.clues[i] !== EMPTY) expect(puzzle.clues[i], `clue ${i}`).toBe(solution[i]);
          if (puzzle.numbers[i]! >= 0) {
            expect(puzzle.clues[i], `number on empty cell ${i}`).not.toBe(EMPTY);
            expect(puzzle.numbers[i], `number ${i}`).toBe(sameNeighbourCount(solution, i, n));
          }
        }

        // Solvable by deduction alone, and it lands on the intended answer.
        const logical = solveLogical(puzzle);
        expect(logical.solved, `n=${n} seed=${s} deduction stalled`).toBe(true);
        expect(logical.cells).toEqual(solution);

        // And exhaustively: exactly one answer exists, search fully explored.
        const exhaustive = countSolutions(puzzle, 3);
        expect(exhaustive.exhausted).toBe(true);
        expect(exhaustive.count, `n=${n} seed=${s}`).toBe(1);
        expect(exhaustive.first).toEqual(solution);

        expect(verifyPuzzle(puzzle, solution)).toEqual({ ok: true });
      }
    });
  }

  it('leaves some cells for the player to fill', () => {
    for (let s = 0; s < 20; s++) {
      const gen = generatePuzzle(6, s * 31 + 5)!;
      expect(gen.clueCount).toBeLessThan(36);
    }
  });

  it('is deterministic for a given seed', () => {
    expect(generatePuzzle(6, 777)).toEqual(generatePuzzle(6, 777));
  });
});

describe('the fail-closed gate', () => {
  const base = () => generatePuzzle(6, 12345)!;

  it('rejects a puzzle with a clue removed that the deduction rules needed', () => {
    const { puzzle, solution } = base();
    const stripped: EquinoxPuzzle = { n: puzzle.n, clues: new Array<number>(36).fill(EMPTY), numbers: none(6) };
    const res = verifyPuzzle(stripped, solution);
    expect(res.ok).toBe(false);
  });

  it('rejects a clue that contradicts the answer', () => {
    const { puzzle, solution } = base();
    const i = puzzle.clues.findIndex(c => c !== EMPTY);
    const tampered: EquinoxPuzzle = {
      ...puzzle,
      clues: puzzle.clues.map((c, k) => (k === i ? (c === ORANGE ? NAVY : ORANGE) : c)),
    };
    expect(verifyPuzzle(tampered, solution).ok).toBe(false);
  });

  it('rejects a number sitting on an empty cell', () => {
    const { puzzle, solution } = base();
    const i = puzzle.clues.findIndex(c => c === EMPTY);
    const tampered: EquinoxPuzzle = { ...puzzle, numbers: puzzle.numbers.map((v, k) => (k === i ? 3 : v)) };
    expect(verifyPuzzle(tampered, solution)).toEqual({ ok: false, reason: `number on empty cell ${i}` });
  });

  it('rejects an odd board size', () => {
    expect(verifyPuzzle({ n: 5, clues: new Array<number>(25).fill(ORANGE), numbers: none(5) }).ok).toBe(false);
  });
});

describe('bank encoding', () => {
  it('round-trips a puzzle unchanged', () => {
    const { puzzle } = generatePuzzle(6, 2024)!;
    const enc = encodePuzzle(puzzle);
    expect(enc.clues).toHaveLength(36);
    expect(enc.numbers).toHaveLength(36);
    expect(decodePuzzle(enc)).toEqual(puzzle);
  });
});

describe('daily selection', () => {
  const bank = Array.from({ length: 5 }, (_, i) => i);

  it('is stable for a date', () => {
    expect(pickDaily(bank, '2026-09-01')).toBe(pickDaily(bank, '2026-09-01'));
  });

  it('walks the bank without repeating until it cycles', () => {
    const seen = Array.from({ length: bank.length }, (_, d) => {
      const date = new Date(Date.UTC(2026, 8, 1 + d)).toISOString().split('T')[0]!;
      return pickDaily(bank, date);
    });
    expect(new Set(seen).size).toBe(bank.length);
  });

  it('refuses an empty bank rather than serving nothing', () => {
    expect(() => pickDaily([], '2026-09-01')).toThrow();
  });
});

// A post is snapshotted to its creation date, so these two facts are what make
// "repost today = same board, tomorrow = new board, and last week's post still
// plays last week's board" true.
describe('puzzle numbering', () => {
  it('gives every post made on one date the same board and number', () => {
    expect(equinoxPuzzleNumber('2026-08-26')).toBe(equinoxPuzzleNumber('2026-08-26'));
    expect(pickDaily(EQUINOX_BANK, '2026-08-26')).toBe(pickDaily(EQUINOX_BANK, '2026-08-26'));
  });

  it('advances one per day from the launch date', () => {
    expect(equinoxPuzzleNumber(EQUINOX_LAUNCH_DATE)).toBe(1);
    expect(equinoxPuzzleNumber('2026-08-25')).toBe(2);
    expect(equinoxPuzzleNumber('2026-08-27')).toBe(4);
    expect(pickDaily(EQUINOX_BANK, '2026-08-26')).not.toBe(pickDaily(EQUINOX_BANK, '2026-08-27'));
  });

  // Live posts anchor on the first post's date, so whenever Equinox goes live
  // that board is #1 no matter how long review took.
  it('counts from whichever launch date it is given', () => {
    expect(equinoxPuzzleNumber('2026-09-10', '2026-09-10')).toBe(1);
    expect(equinoxPuzzleNumber('2026-09-11', '2026-09-10')).toBe(2);
    expect(equinoxPuzzleNumber('2026-10-10', '2026-09-10')).toBe(31);
  });

  it('never numbers a pre-launch board below 1', () => {
    expect(equinoxPuzzleNumber('2020-01-01')).toBe(1);
    expect(equinoxPuzzleNumber('2026-09-01', '2026-09-10')).toBe(1);
  });
});

describe('scoring', () => {
  it('decays with time and nothing else', () => {
    expect(equinoxScore(0)).toBe(3000);
    expect(equinoxScore(90)).toBe(2550);
    expect(equinoxScore(180)).toBe(2100);
    expect(equinoxScore(300)).toBe(1500);
    expect(equinoxScore(480)).toBe(600);
  });

  it('never drops below the floor, however slow the solve', () => {
    expect(equinoxScore(540)).toBe(EQUINOX_CONFIG.floorScore);
    expect(equinoxScore(99999)).toBe(EQUINOX_CONFIG.floorScore);
  });

  it('ignores a negative clock', () => {
    expect(equinoxScore(-50)).toBe(3000);
  });
});

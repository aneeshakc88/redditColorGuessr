import { describe, expect, it } from 'vitest';
import {
  WIRE_CONFIG, WIRE_TIERS, advanceWire, checkSolution, generateForTier, generatePuzzle, getDailyPuzzle,
  pairRangeFor, rateBoard, solvePuzzle, solveWire, tierOf, wireScore, type WireTier,
} from './wire-core';

const dates = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 6, 1 + i));
  return d.toISOString().split('T')[0]!;
});

describe('daily generation', () => {
  it('produces a full-coverage, well-formed board every day', () => {
    for (const date of dates) {
      const p = getDailyPuzzle(date);
      expect(p.pairs.length, date).toBe(WIRE_CONFIG.dailyPairs);
      expect(p.solution.length, date).toBe(WIRE_CONFIG.dailyPairs);

      const cells = new Set<number>();
      for (const path of p.solution) {
        expect(path.length, date).toBeGreaterThanOrEqual(WIRE_CONFIG.minPathLen);
        for (const c of path) cells.add(c);
      }
      expect(cells.size, date).toBe(p.w * p.h);

      const dots = new Set(p.pairs.flatMap(pair => [pair.a, pair.b]));
      expect(dots.size, date).toBe(p.pairs.length * 2);

      const res = checkSolution(p, p.solution.map((cellsArr, color) => ({ color, cells: cellsArr })));
      expect(res.solved, `${date}: ${res.reason ?? ''}`).toBe(true);
    }
  });

  it('is deterministic', () => {
    expect(getDailyPuzzle('2026-07-27')).toEqual(getDailyPuzzle('2026-07-27'));
  });
});

describe('solver', () => {
  it('solves generated boards it has never seen the answer to', () => {
    for (const size of [5, 6, 7]) {
      const p = generatePuzzle(size * 1234567, size, size, Math.max(4, size - 1));
      const routes = solvePuzzle({ w: p.w, h: p.h, pairs: p.pairs });
      expect(routes, `size ${size}`).not.toBeNull();
      const res = checkSolution(p, routes!.map((cells, color) => ({ color, cells })));
      expect(res.solved, `size ${size}: ${res.reason ?? ''}`).toBe(true);
    }
  });

  it('rejects a board that cannot be filled', () => {
    // 3x3, two pairs pinned so the centre column can never be covered.
    const impossible = { w: 3, h: 3, pairs: [{ a: 0, b: 2 }, { a: 6, b: 8 }] };
    const solved = solveWire(impossible, 20000);
    expect(solved.routes).toBeNull();
    expect(solved.exhausted).toBe(false);
  });

  // The 9x9 boards are where the search used to blow past its node cap and
  // come back as a flat "no solution" on a board that was fine.
  // Uninstrumented this batch runs in ~1s; the default 5s limit is not a speed
  // budget, and coverage instrumentation alone was enough to trip it.
  it('settles every generated 9x9 board inside the creator budget', () => {
    for (let seed = 0; seed < 12; seed++) {
      const p = generatePuzzle(seed * 7919 + 13, 9, 9, 6 + (seed % 4));
      const solved = solveWire({ w: 9, h: 9, pairs: p.pairs }, 1200000);
      expect(solved.routes, `seed ${seed}`).not.toBeNull();
    }
  }, 60000);

  it('reports running out of search as unproven, not unsolvable', () => {
    const p = generatePuzzle(13, 9, 9, 6);
    const solved = solveWire({ w: 9, h: 9, pairs: p.pairs }, 50);
    expect(solved.routes).toBeNull();
    expect(solved.exhausted).toBe(true);
  });
});

describe('checkSolution', () => {
  it('flags broken paths and overlaps', () => {
    const p = getDailyPuzzle('2026-07-27');
    const routes = p.solution.map((cells, color) => ({ color, cells }));
    const broken = routes.map((r, i) => (i === 0 ? { ...r, cells: [r.cells[0]!, r.cells[r.cells.length - 1]!] } : r));
    expect(checkSolution(p, broken).solved).toBe(false);
  });
});

describe('advanceWire', () => {
  // 4x4 board. Red: 0 -> 3 (top row). Blue: 8 -> 11 (third row).
  const pairs = [{ a: 0, b: 3 }, { a: 8, b: 11 }];
  const W = 4;

  it('takes an adjacent empty cell and finishes on its own dot', () => {
    const routes = [[0], []];
    expect(advanceWire(routes, pairs, W, 0, 1).outcome).toBe('ok');
    expect(advanceWire(routes, pairs, W, 0, 2).outcome).toBe('ok');
    expect(advanceWire(routes, pairs, W, 0, 3).outcome).toBe('done');
    expect(routes[0]).toEqual([0, 1, 2, 3]);
  });

  it('rewinds when the wire crosses its own trail', () => {
    const routes = [[0, 1, 2], []];
    expect(advanceWire(routes, pairs, W, 0, 1).outcome).toBe('ok');
    expect(routes[0]).toEqual([0, 1]);
  });

  it('blocks non-adjacent steps and other colours dots', () => {
    expect(advanceWire([[0], []], pairs, W, 0, 6).outcome).toBe('blocked');
    expect(advanceWire([[0, 4], []], pairs, W, 0, 8).outcome).toBe('blocked');
  });

  it('cuts another colour wire at the crossing point', () => {
    const routes = [[0], [8, 9, 5, 6]];
    const res = advanceWire(routes, pairs, W, 0, 1);
    expect(res.outcome).toBe('ok');
    expect(res.cut).toBe(false);
    const res2 = advanceWire(routes, pairs, W, 0, 5);
    expect(res2.cut).toBe(true);
    expect(routes[1]).toEqual([8, 9]);
    expect(routes[0]).toEqual([0, 1, 5]);
  });
});

describe('wireScore', () => {
  it('rewards fast, tidy solves', () => {
    expect(wireScore(60, 12, 81)).toBeGreaterThan(wireScore(180, 40, 81));
    expect(wireScore(9999, 999, 81)).toBe(200);
  });
});

// The eight bench boards, rated by hand against measured human solve times and
// signed off by eye before the formula was written down. They are the only
// thing keeping a tweak to `rateBoard` from silently re-labelling every board
// on the sub.
const BENCH: { w: number; h: number; tier: WireTier; score: number; pairs: { a: number; b: number }[]; solution: number[][] }[] = [
  { w: 9, h: 9, tier: "hard", score: 9.07,
    pairs: [{a: 8,b: 6}, {a: 15,b: 1}, {a: 0,b: 65}, {a: 74,b: 70}, {a: 48,b: 19}],
    solution: [[8,7,6], [15,14,5,4,3,2,1], [0,9,18,27,36,45,54,63,72,73,64,65], [74,75,66,57,56,55,46,47,38,37,28,29,20,21,30,39,40,31,32,41,50,59,68,69,70], [48,49,58,67,76,77,78,79,80,71,62,53,44,35,26,17,16,25,34,43,52,61,60,51,42,33,24,23,22,13,12,11,10,19]] },
  { w: 10, h: 10, tier: "hard", score: 7.5,
    pairs: [{a: 0,b: 48}, {a: 17,b: 38}, {a: 36,b: 52}, {a: 61,b: 31}, {a: 84,b: 72}, {a: 89,b: 97}],
    solution: [[0,10,20,30,40,50,60,70,71,81,80,90,91,92,82,83,93,94,95,96,86,85,75,76,66,65,55,56,46,47,57,67,77,87,88,78,79,69,68,58,59,49,48], [17,7,8,9,19,18,28,29,39,38], [36,37,27,26,16,6,5,15,25,35,45,44,34,24,14,4,3,13,12,2,1,11,21,22,23,33,32,42,43,53,54,64,63,62,52], [61,51,41,31], [84,74,73,72], [89,99,98,97]] },
  { w: 10, h: 10, tier: "hard", score: 7.04,
    pairs: [{a: 90,b: 4}, {a: 91,b: 21}, {a: 11,b: 43}, {a: 94,b: 88}, {a: 27,b: 87}, {a: 18,b: 13}, {a: 84,b: 65}, {a: 46,b: 57}],
    solution: [[90,80,70,60,50,40,30,20,10,0,1,2,3,4], [91,81,71,61,51,41,42,32,31,21], [11,12,22,23,33,43], [94,93,92,82,83,73,72,62,52,53,63,64,54,44,34,24,25,35,45,55,56,66,67,68,78,88], [27,17,7,8,9,19,29,39,49,48,58,59,69,79,89,99,98,97,96,95,85,86,76,77,87], [18,28,38,37,36,26,16,6,5,15,14,13], [84,74,75,65], [46,47,57]] },
  { w: 9, h: 9, tier: "hard", score: 6.33,
    pairs: [{a: 80,b: 25}, {a: 34,b: 11}, {a: 14,b: 54}, {a: 28,b: 32}, {a: 23,b: 48}, {a: 63,b: 79}],
    solution: [[80,71,62,53,44,35,26,25], [34,43,52,61,70,69,60,51,42,33,24,15,16,17,8,7,6,5,4,3,2,11], [14,13,12,21,20,19,10,1,0,9,18,27,36,45,54], [28,37,46,47,56,55,64,65,66,57,58,67,68,59,50,49,40,41,32], [23,22,31,30,29,38,39,48], [63,72,73,74,75,76,77,78,79]] },
  { w: 10, h: 10, tier: "medium", score: 5.56,
    pairs: [{a: 90,b: 77}, {a: 9,b: 4}, {a: 19,b: 49}, {a: 47,b: 27}, {a: 44,b: 12}, {a: 11,b: 42}],
    solution: [[90,91,92,93,94,95,85,86,96,97,87,77], [9,8,18,28,38,48,58,59,69,79,89,99,98,88,78,68,67,57,56,46,45,55,54,64,65,66,76,75,74,84,83,73,63,53,52,62,72,82,81,80,70,71,61,60,50,51,41,40,30,20,10,0,1,2,3,4], [19,29,39,49], [47,37,27], [44,43,33,34,35,36,26,16,17,7,6,5,15,25,24,14,13,23,22,12], [11,21,31,32,42]] },
  { w: 9, h: 9, tier: "medium", score: 5.4,
    pairs: [{a: 72,b: 2}, {a: 80,b: 57}, {a: 46,b: 35}, {a: 40,b: 61}, {a: 42,b: 44}, {a: 3,b: 13}],
    solution: [[72,63,54,45,36,27,18,9,0,1,2], [80,71,62,53,52,51,60,69,68,59,50,41,32,31,30,39,48,57], [46,55,64,73,74,75,66,65,56,47,38,37,28,29,20,19,10,11,12,21,22,23,14,5,6,15,24,33,34,25,16,7,8,17,26,35], [40,49,58,67,76,77,78,79,70,61], [42,43,44], [3,4,13]] },
  { w: 10, h: 10, tier: "medium", score: 4.71,
    pairs: [{a: 9,b: 81}, {a: 90,b: 75}, {a: 60,b: 23}, {a: 13,b: 61}, {a: 62,b: 27}, {a: 53,b: 77}, {a: 17,b: 54}],
    solution: [[9,19,29,39,49,59,69,79,89,99,98,88,87,97,96,95,94,93,92,91,81], [90,80,70,71,72,82,83,73,74,84,85,86,76,75], [60,50,40,30,20,10,0,1,11,21,22,23], [13,12,2,3,4,14,24,34,33,32,31,41,51,61], [62,63,64,65,66,67,57,47,37,27], [53,52,42,43,44,45,35,25,15,5,6,7,8,18,28,38,48,58,68,78,77], [17,16,26,36,46,56,55,54]] },
  { w: 9, h: 9, tier: "easy", score: 3.73,
    pairs: [{a: 8,b: 13}, {a: 14,b: 32}, {a: 15,b: 58}, {a: 48,b: 62}, {a: 41,b: 75}],
    solution: [[8,17,26,35,44,53,52,43,34,25,16,7,6,5,4,13], [14,23,32], [15,24,33,42,51,50,49,58], [48,57,66,67,76,77,68,59,60,61,70,69,78,79,80,71,62], [41,40,31,22,21,12,3,2,11,20,29,30,39,38,47,56,65,64,55,46,37,28,19,10,1,0,9,18,27,36,45,54,63,72,73,74,75]] },
];

describe('difficulty', () => {
  it('reproduces the bench scores and tiers', () => {
    for (const b of BENCH) {
      const r = rateBoard({ w: b.w, h: b.h, pairs: b.pairs }, b.solution);
      expect(Math.round(r.score * 100) / 100, `${b.w}x${b.h} @ ${b.score}`).toBeCloseTo(b.score, 2);
      expect(r.tier, `${b.w}x${b.h} @ ${b.score}`).toBe(b.tier);
    }
  });

  it('bands the anchor boards the way they actually played', () => {
    expect(tierOf(9.8)).toBe('hard');    // 5+ min, one solver
    expect(tierOf(6.86)).toBe('hard');   // 2+ min
    expect(tierOf(5.5)).toBe('medium');  // 1:28
    expect(tierOf(4.07)).toBe('medium'); // the dailies
    expect(tierOf(3.33)).toBe('easy');   // 0:33
  });

  it('ignores the mop-up wire when measuring stretch', () => {
    // One wire snakes over more than 45% of the board: its region has a single
    // possible owner, so it is forced rather than a trap.
    const puzzle = { w: 4, h: 4, pairs: [{ a: 0, b: 3 }, { a: 4, b: 7 }] };
    const solution = [[0, 1, 2, 3], [4, 8, 12, 13, 14, 15, 11, 10, 9, 5, 6, 7]];
    expect(rateBoard(puzzle, solution).maxStretch).toBe(1);
  });

  it('generates boards that land in the tier asked for', () => {
    for (const tier of WIRE_TIERS) {
      let hits = 0;
      for (let s = 0; s < 6; s++) {
        const got = generateForTier(1000 + s * 7919, 9, 9, tier);
        if (got.onTarget) {
          expect(got.rating.tier, tier).toBe(tier);
          hits++;
        }
      }
      expect(hits, `${tier} never landed on target`).toBeGreaterThan(0);
    }
  });

  it('keeps hard inside the 5-8 pair hump on 9x9', () => {
    const { lo, hi } = pairRangeFor('hard', 9, 9);
    expect(lo).toBe(5);
    expect(hi).toBe(8);
  });
});

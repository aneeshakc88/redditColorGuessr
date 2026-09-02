// Rewire's level-1 tile shuffle. Level 2 is exactly Colorwire — reuse
// wire-core directly for that (generatePuzzle, solveWire, checkSolution,
// wireScore, WIRE_CONFIG, WIRE_COLORS).
import { mulberry32 } from './wire-core';

export const REWIRE_SIZES = [5, 6] as const;

// perm[gridPosition] = index of the image tile shown there. Solved when every
// tile sits at its own index. Deterministic per seed so every player faces the
// same layout — same fairness principle as Colorwire's fixed daily board.
export function generateShuffle(seed: number, w: number, h: number): number[] {
  const n = w * h;
  const rand = mulberry32(seed);
  const perm = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  // A freshly shuffled permutation can still leave a tile on its own square —
  // trivial for that one tile, so those get folded into a cycle with the rest.
  const fixed = perm.reduce<number[]>((acc, v, i) => (v === i ? [...acc, i] : acc), []);
  if (fixed.length === 1) {
    const a = fixed[0]!, b = (a + 1) % n;
    [perm[a], perm[b]] = [perm[b]!, perm[a]!];
  } else {
    for (let k = 0; k < fixed.length; k++) {
      const a = fixed[k]!, b = fixed[(k + 1) % fixed.length]!;
      [perm[a], perm[b]] = [perm[b]!, perm[a]!];
    }
  }
  return perm;
}

export const isSolvedShuffle = (perm: number[]): boolean => perm.every((v, i) => v === i);

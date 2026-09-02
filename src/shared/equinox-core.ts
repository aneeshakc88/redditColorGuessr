// Equinox — a two-colour balance-logic grid.
//
// Rules:
//   1. Every row and every column holds exactly n/2 orange and n/2 navy.
//   2. A numbered cell states how many of its 8 surrounding cells share its
//      own colour (the cell itself is not counted).
//   3. No two adjacent rows may be identical; likewise for adjacent columns.
//
// Puzzles are carved backwards out of a finished board and are only accepted
// if a guessing-free solver can still finish them, so every shipped board is
// both unique and human-solvable. Generation runs offline (scripts/), never
// on the server — see `decodePuzzle` / `pickDaily` for the runtime half.

export const EMPTY = 0;
export const ORANGE = 1;
export const NAVY = 2;

export const EQUINOX_CONFIG = {
  dailyN: 6,
  baseScore: 3000,
  decayPerSec: 5,
  floorScore: 300,
  maxSec: 3600,
} as const;

// Sun and sky on a black ground. `navy` is the sky tile — the name is kept so
// the encoded board format and every stored solve stay valid.
export const EQUINOX_COLORS = {
  orange: '#f2842b',
  navy: '#3b8fe0',
  empty: '#212228',
  // White washes out on the sun tile, so each colour carries its own numeral ink.
  inkOnOrange: '#2a1403',
  inkOnNavy: '#ffffff',
} as const;

export type EquinoxPuzzle = {
  n: number;
  /** EMPTY | ORANGE | NAVY per cell. Non-empty cells are locked clues. */
  clues: number[];
  /** Neighbour-match count per cell, or -1. Only ever set on a clue cell. */
  numbers: number[];
};

export type Violation =
  | { kind: 'row'; index: number }
  | { kind: 'col'; index: number }
  | { kind: 'number'; cell: number }
  | { kind: 'twin-rows'; a: number; b: number }
  | { kind: 'twin-cols'; a: number; b: number };

export const other = (c: number) => (c === ORANGE ? NAVY : ORANGE);

// ── RNG ──────────────────────────────────────────────────────────────────────
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

// ── Grid geometry (cached per board size) ────────────────────────────────────
type Geo = { n: number; nbrs: number[][]; rows: number[][]; cols: number[][] };
const geoCache = new Map<number, Geo>();

export function geometry(n: number): Geo {
  const hit = geoCache.get(n);
  if (hit) return hit;

  const nbrs: number[][] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const list: number[] = [];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < n && cc >= 0 && cc < n) list.push(rr * n + cc);
        }
      }
      nbrs.push(list);
    }
  }

  const rows: number[][] = [];
  const cols: number[][] = [];
  for (let i = 0; i < n; i++) {
    rows.push(Array.from({ length: n }, (_, k) => i * n + k));
    cols.push(Array.from({ length: n }, (_, k) => k * n + i));
  }

  const geo: Geo = { n, nbrs, rows, cols };
  geoCache.set(n, geo);
  return geo;
}

/** How many of cell `i`'s 8 neighbours share its colour. */
export function sameNeighbourCount(cells: number[], i: number, n: number): number {
  const colour = cells[i]!;
  if (colour === EMPTY) return 0;
  let same = 0;
  for (const j of geometry(n).nbrs[i]!) if (cells[j] === colour) same++;
  return same;
}

// ── Validation ───────────────────────────────────────────────────────────────
// Reports only *definite* breaches, so it is equally valid on a half-filled
// board (used for the live board) and a finished one (used to judge a submit).
export function violations(n: number, cells: number[], numbers: number[]): Violation[] {
  const geo = geometry(n);
  const half = n / 2;
  const out: Violation[] = [];

  const scanLines = (lines: number[][], kind: 'row' | 'col') => {
    lines.forEach((line, index) => {
      let o = 0, b = 0;
      for (const i of line) { if (cells[i] === ORANGE) o++; else if (cells[i] === NAVY) b++; }
      if (o > half || b > half) out.push({ kind, index });
    });
  };
  scanLines(geo.rows, 'row');
  scanLines(geo.cols, 'col');

  for (let i = 0; i < n * n; i++) {
    const want = numbers[i]!;
    if (want < 0 || cells[i] === EMPTY) continue;
    const colour = cells[i]!;
    let same = 0, empty = 0;
    for (const j of geo.nbrs[i]!) {
      if (cells[j] === colour) same++;
      else if (cells[j] === EMPTY) empty++;
    }
    if (same > want || same + empty < want) out.push({ kind: 'number', cell: i });
  }

  const scanTwins = (lines: number[][], kind: 'twin-rows' | 'twin-cols') => {
    for (let a = 0; a + 1 < lines.length; a++) {
      const la = lines[a]!, lb = lines[a + 1]!;
      let identical = true;
      for (let k = 0; k < n; k++) {
        const va = cells[la[k]!]!, vb = cells[lb[k]!]!;
        if (va === EMPTY || vb === EMPTY || va !== vb) { identical = false; break; }
      }
      if (identical) out.push({ kind, a, b: a + 1 });
    }
  };
  scanTwins(geo.rows, 'twin-rows');
  scanTwins(geo.cols, 'twin-cols');

  return out;
}

export const isSolved = (p: EquinoxPuzzle, cells: number[]): boolean =>
  cells.every(c => c !== EMPTY) && violations(p.n, cells, p.numbers).length === 0;

// ── Deduction ────────────────────────────────────────────────────────────────
// The four rules a human has. Every step here is forced, never a guess, so a
// board this finishes is by definition solvable without trial and error — and
// therefore has exactly one answer.
function propagate(n: number, cells: number[], numbers: number[]): 'ok' | 'contradiction' {
  const geo = geometry(n);
  const half = n / 2;

  for (;;) {
    let changed = false;

    // Rule D — quota: a line that has used up one colour is the other colour.
    for (const lines of [geo.rows, geo.cols]) {
      for (const line of lines) {
        let o = 0, b = 0, empty = 0;
        for (const i of line) {
          const v = cells[i];
          if (v === ORANGE) o++; else if (v === NAVY) b++; else empty++;
        }
        if (o > half || b > half) return 'contradiction';
        if (empty === 0) continue;
        const fill = o === half ? NAVY : b === half ? ORANGE : EMPTY;
        if (fill !== EMPTY) {
          for (const i of line) if (cells[i] === EMPTY) cells[i] = fill;
          changed = true;
        }
      }
    }

    // Rules A & B — a number that is already satisfied, or that needs every
    // empty neighbour it has left.
    for (let i = 0; i < n * n; i++) {
      const want = numbers[i]!;
      const colour = cells[i]!;
      if (want < 0 || colour === EMPTY) continue;
      let same = 0;
      const empties: number[] = [];
      for (const j of geo.nbrs[i]!) {
        if (cells[j] === colour) same++;
        else if (cells[j] === EMPTY) empties.push(j);
      }
      if (same > want || same + empties.length < want) return 'contradiction';
      if (empties.length === 0) continue;
      if (same === want) {
        const opp = other(colour);
        for (const j of empties) cells[j] = opp;
        changed = true;
      } else if (same + empties.length === want) {
        for (const j of empties) cells[j] = colour;
        changed = true;
      }
    }

    // Rule C — a line one cell away from copying its neighbour.
    for (const lines of [geo.rows, geo.cols]) {
      for (let a = 0; a + 1 < lines.length; a++) {
        for (const [x, y] of [[a, a + 1], [a + 1, a]] as const) {
          const done = lines[x]!, near = lines[y]!;
          let gap = -1, mismatched = false;
          for (let k = 0; k < n; k++) {
            const vd = cells[done[k]!]!, vn = cells[near[k]!]!;
            if (vd === EMPTY) { mismatched = true; break; }
            if (vn === EMPTY) { if (gap >= 0) { mismatched = true; break; } gap = k; }
            else if (vn !== vd) { mismatched = true; break; }
          }
          if (!mismatched && gap >= 0) {
            cells[near[gap]!] = other(cells[done[gap]!]!);
            changed = true;
          }
        }
      }
    }

    if (!changed) return 'ok';
  }
}

/** Solve using forced deductions only. `solved` false means a human would stall. */
export function solveLogical(p: EquinoxPuzzle): { solved: boolean; cells: number[] } {
  const cells = p.clues.slice();
  const status = propagate(p.n, cells, p.numbers);
  if (status === 'contradiction') return { solved: false, cells };
  return { solved: isSolved(p, cells), cells };
}

// ── Exhaustive solver ────────────────────────────────────────────────────────
// Backtracking with the same (sound) propagation for pruning. Counts answers
// up to `limit`. `exhausted` false means the node budget ran out before the
// search finished — callers must treat that as "reject", never as "fine".
export function countSolutions(
  p: EquinoxPuzzle,
  limit = 2,
  budget = 2_000_000
): { count: number; exhausted: boolean; first: number[] | null } {
  const { n, numbers } = p;
  let count = 0;
  let nodes = 0;
  let first: number[] | null = null;

  const rec = (cells: number[]): void => {
    if (count >= limit || nodes > budget) return;
    nodes++;
    if (propagate(n, cells, numbers) === 'contradiction') return;

    let pick = -1;
    for (let i = 0; i < cells.length; i++) if (cells[i] === EMPTY) { pick = i; break; }
    if (pick < 0) {
      if (violations(n, cells, numbers).length === 0) {
        if (!first) first = cells.slice();
        count++;
      }
      return;
    }
    for (const v of [ORANGE, NAVY]) {
      const next = cells.slice();
      next[pick] = v;
      rec(next);
      if (count >= limit || nodes > budget) return;
    }
  };

  rec(p.clues.slice());
  return { count, exhausted: nodes <= budget, first };
}

// ── Generation ───────────────────────────────────────────────────────────────
function balancedRows(n: number): number[][] {
  const half = n / 2;
  const out: number[][] = [];
  const walk = (row: number[], oranges: number) => {
    const k = row.length;
    if (k === n) { if (oranges === half) out.push(row.slice()); return; }
    if (oranges < half) { row.push(ORANGE); walk(row, oranges + 1); row.pop(); }
    if (k - oranges < half) { row.push(NAVY); walk(row, oranges); row.pop(); }
  };
  walk([], 0);
  return out;
}

const sameRow = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);

/** A complete board satisfying all three rules. */
export function generateSolution(n: number, rng: () => number): number[] | null {
  const half = n / 2;
  const patterns = balancedRows(n);
  const colOranges = new Array<number>(n).fill(0);
  const chosen: number[][] = [];

  const colsAreLegal = (): boolean => {
    for (let c = 0; c + 1 < n; c++) {
      let identical = true;
      for (let r = 0; r < n; r++) if (chosen[r]![c] !== chosen[r]![c + 1]) { identical = false; break; }
      if (identical) return false;
    }
    return true;
  };

  const place = (r: number): boolean => {
    if (r === n) return colsAreLegal();
    for (const pat of shuffle(patterns.slice(), rng)) {
      if (r > 0 && sameRow(pat, chosen[r - 1]!)) continue;
      let fits = true;
      for (let c = 0; c < n; c++) {
        const oranges = colOranges[c]! + (pat[c] === ORANGE ? 1 : 0);
        const navies = r + 1 - oranges;
        if (oranges > half || navies > half) { fits = false; break; }
      }
      if (!fits) continue;

      chosen.push(pat);
      for (let c = 0; c < n; c++) if (pat[c] === ORANGE) colOranges[c]!++;
      if (place(r + 1)) return true;
      for (let c = 0; c < n; c++) if (pat[c] === ORANGE) colOranges[c]!--;
      chosen.pop();
    }
    return false;
  };

  if (!place(0)) return null;
  return chosen.flat();
}

/**
 * Strip the solution down to a puzzle. A cell only stays stripped if the
 * logic-only solver can still finish the board, so solvability is preserved
 * at every single step rather than checked at the end and hoped for.
 */
export function carvePuzzle(
  n: number,
  solution: number[],
  rng: () => number,
  numberDensity = 0.3
): EquinoxPuzzle {
  const total = n * n;
  const numbers = new Array<number>(total).fill(-1);
  const order = shuffle(Array.from({ length: total }, (_, i) => i), rng);
  for (const i of order.slice(0, Math.round(total * numberDensity))) {
    numbers[i] = sameNeighbourCount(solution, i, n);
  }

  const p: EquinoxPuzzle = { n, clues: solution.slice(), numbers };

  // Pass 1 — drop the whole clue (colour, and its number if it had one).
  for (const i of shuffle(order.slice(), rng)) {
    const colour = p.clues[i]!, num = p.numbers[i]!;
    p.clues[i] = EMPTY;
    p.numbers[i] = -1;
    if (!solveLogical(p).solved) { p.clues[i] = colour; p.numbers[i] = num; }
  }

  // Pass 2 — thin out numbers that survived but are no longer pulling weight.
  for (const i of shuffle(order.slice(), rng)) {
    if (p.numbers[i]! < 0) continue;
    const num = p.numbers[i]!;
    p.numbers[i] = -1;
    if (!solveLogical(p).solved) p.numbers[i] = num;
  }

  return p;
}

/** Fail-closed gate. Nothing reaches a player without passing this. */
export function verifyPuzzle(p: EquinoxPuzzle, solution?: number[]): { ok: boolean; reason?: string } {
  const total = p.n * p.n;
  if (p.n % 2 !== 0) return { ok: false, reason: 'board size must be even' };
  if (p.clues.length !== total || p.numbers.length !== total) return { ok: false, reason: 'bad array length' };
  for (let i = 0; i < total; i++) {
    if (p.numbers[i]! >= 0 && p.clues[i] === EMPTY) return { ok: false, reason: `number on empty cell ${i}` };
  }

  const logical = solveLogical(p);
  if (!logical.solved) return { ok: false, reason: 'not solvable by deduction alone' };

  const exhaustive = countSolutions(p, 2);
  if (!exhaustive.exhausted) return { ok: false, reason: 'search budget exhausted' };
  if (exhaustive.count !== 1) return { ok: false, reason: `${exhaustive.count} solutions` };

  if (solution) {
    if (!logical.cells.every((v, i) => v === solution[i])) return { ok: false, reason: 'answer mismatch' };
    for (let i = 0; i < total; i++) {
      if (p.clues[i] !== EMPTY && p.clues[i] !== solution[i]) return { ok: false, reason: `clue ${i} contradicts answer` };
      if (p.numbers[i]! >= 0 && p.numbers[i] !== sameNeighbourCount(solution, i, p.n)) {
        return { ok: false, reason: `number ${i} contradicts answer` };
      }
    }
  }

  return { ok: true };
}

export type GeneratedPuzzle = { puzzle: EquinoxPuzzle; solution: number[]; clueCount: number };

export function generatePuzzle(n: number, seed: number, attempts = 40): GeneratedPuzzle | null {
  for (let a = 0; a < attempts; a++) {
    const rng = mulberry32(seed + a * 0x9e3779b9);
    const solution = generateSolution(n, rng);
    if (!solution) continue;
    const puzzle = carvePuzzle(n, solution, rng);
    if (!verifyPuzzle(puzzle, solution).ok) continue;
    return { puzzle, solution, clueCount: puzzle.clues.filter(c => c !== EMPTY).length };
  }
  return null;
}

// ── Bank encoding ────────────────────────────────────────────────────────────
// Two same-length strings per board, so a few hundred pre-verified puzzles sit
// in the repo as readable text rather than a blob.
const CLUE_CHARS = ['.', 'o', 'n'];

export type EncodedPuzzle = { n: number; clues: string; numbers: string };

export function encodePuzzle(p: EquinoxPuzzle): EncodedPuzzle {
  return {
    n: p.n,
    clues: p.clues.map(c => CLUE_CHARS[c]!).join(''),
    numbers: p.numbers.map(v => (v < 0 ? '.' : String(v))).join(''),
  };
}

export function decodePuzzle(e: EncodedPuzzle): EquinoxPuzzle {
  return {
    n: e.n,
    clues: [...e.clues].map(ch => CLUE_CHARS.indexOf(ch)),
    numbers: [...e.numbers].map(ch => (ch === '.' ? -1 : Number(ch))),
  };
}

export const dayNumber = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);

/** Fallback anchor, used only until the first live post records the real one.
 *  In production the anchor is the date of the very first Equinox post, stored
 *  once in redis, so the first board published is always #1. */
export const EQUINOX_LAUNCH_DATE = '2026-08-24';

/** Numbering runs off the board's date, so an archived post keeps the number it
 *  was published with however long ago that was. */
export const equinoxPuzzleNumber = (date: string, launchDate = EQUINOX_LAUNCH_DATE): number =>
  Math.max(1, dayNumber(date) - dayNumber(launchDate) + 1);

/** Walks the bank in order, so no board repeats until the whole bank cycles. */
export function pickDaily<T>(bank: readonly T[], date: string): T {
  if (bank.length === 0) throw new Error('empty puzzle bank');
  const i = ((dayNumber(date) % bank.length) + bank.length) % bank.length;
  return bank[i]!;
}

// ── Scoring ──────────────────────────────────────────────────────────────────
// Time is the only input. Clicks, undos and resets are deliberately free — the
// clock already prices them, and a costly reset makes stuck players quit.
export function equinoxScore(elapsedSec: number): number {
  const { baseScore, decayPerSec, floorScore, maxSec } = EQUINOX_CONFIG;
  const t = Math.min(Math.max(elapsedSec, 0), maxSec);
  return Math.max(floorScore, Math.round(baseScore - t * decayPerSec));
}

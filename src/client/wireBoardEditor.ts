// Colorwire's dot-placement + verify/repair logic, extracted out of
// wire-creator.tsx so Rewire's creator can build a board with the exact same
// validated flow (just placed over an image instead of a blank grid).
import {
  WIRE_CONFIG, areAdjacent, checkSolution, generateForTier, generatePuzzle, rateBoard,
  solvePuzzle, solveWire, type WireRating, type WireTier,
} from '../shared/wire-core';

export type Pair = { a: number; b: number };
// Half-placed pairs are allowed while editing; `b: null` means "one dot down".
export type Dot = { a: number; b: number | null };
export type Check = { state: 'idle' | 'checking' | 'ok' | 'bad'; reason?: string };

export const maxPairsFor = (cells: number) => Math.min(WIRE_CONFIG.maxPairs, Math.floor(cells / 3));

// Repair budget. The solver blocks the main thread, so a repair is many short
// searches rather than one deep one, and it gives up quickly for a rebuild.
const REPAIR_MS = 1200;
const REPAIR_NODES = 150000;
// Verification budget. The solver blocks the main thread, so this is capped at
// a few seconds' work rather than the server's much larger budget; a board the
// phone cannot settle is handed to the server instead of being called broken.
// A search that runs out of nodes proves nothing — reporting that as "no
// solution" is what made solvable boards look unsolvable.
export const VERIFY_NODES = 1200000;

const neighborCells = (i: number, w: number, h: number) => {
  const r = Math.floor(i / w), c = i % w;
  const out: number[] = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
};

export const verify = (pairs: Pair[], w: number, h: number) =>
  pairs.length >= WIRE_CONFIG.minPairs
  && pairs.length <= maxPairsFor(w * h)
  && !!solvePuzzle({ w, h, pairs }, VERIFY_NODES);

// Generation fills the grid by construction, but the solver still has to *find*
// that solution inside its node cap, and a fallback board can overshoot the pair
// count — so a generated board only counts once it verifies.
export async function generateVerified(w: number, h: number, target: number): Promise<Pair[] | null> {
  const cap = maxPairsFor(w * h);
  let t = Math.max(WIRE_CONFIG.minPairs, Math.min(cap, target));
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 0));
    const p = generatePuzzle(Math.floor(Math.random() * 2 ** 31), w, h, t).pairs;
    if (verify(p, w, h)) return p;
    // Few pairs on a big grid means long snaking wires, which is what actually
    // defeats the node cap (9×9 fails ~60% at 5 pairs, ~5% at 9). So each retry
    // nudges density up rather than just reshuffling the same difficulty.
    t = Math.min(cap, t + 1);
  }
  return null;
}

// Least-disruptive fix first: shift one dot, then drop one pair, then rebuild.
// Null means every route failed and the board is left alone.
export async function repairPairs(pairs: Pair[], w: number, h: number): Promise<Pair[] | null> {
  const until = Date.now() + REPAIR_MS;
  const occupied = new Set<number>();
  for (const p of pairs) { occupied.add(p.a); occupied.add(p.b); }

  let calls = 0;
  const solvable = async (cand: Pair[]) => {
    if (++calls % 4 === 0) await new Promise(r => setTimeout(r, 0));
    return !!solvePuzzle({ w, h, pairs: cand }, REPAIR_NODES);
  };

  for (let i = 0; i < pairs.length && Date.now() < until; i++) {
    for (const end of ['a', 'b'] as const) {
      const other = pairs[i]![end === 'a' ? 'b' : 'a'];
      for (const n of neighborCells(pairs[i]![end], w, h)) {
        if (occupied.has(n) || areAdjacent(n, other, w)) continue;
        const cand = pairs.map((p, j) => (j === i ? { ...p, [end]: n } : p));
        if (await solvable(cand)) return cand;
        if (Date.now() >= until) break;
      }
    }
  }

  if (pairs.length - 1 >= WIRE_CONFIG.minPairs) {
    for (let i = 0; i < pairs.length && Date.now() < until; i++) {
      const cand = pairs.filter((_, j) => j !== i);
      if (await solvable(cand)) return cand;
    }
  }

  return generateVerified(w, h, Math.max(WIRE_CONFIG.minPairs, pairs.length));
}

// Solved locally first so the creator gets an instant verdict; the server
// re-runs the same solver, with a bigger budget, before it will publish
// anything. 'unknown' means the local search ran out of nodes: that is not a
// verdict, so the post goes ahead and the server settles it.
export function runCheck(complete: Pair[], w: number, h: number): { verdict: 'ok' | 'unknown' | 'bad'; check: Check; solution?: number[][] } {
  if (complete.length < WIRE_CONFIG.minPairs) {
    return { verdict: 'bad', check: { state: 'bad', reason: `Place at least ${WIRE_CONFIG.minPairs} pairs.` } };
  }
  const solved = solveWire({ w, h, pairs: complete }, VERIFY_NODES);
  if (!solved.routes) {
    return {
      verdict: solved.exhausted ? 'unknown' : 'bad',
      check: {
        state: 'bad',
        reason: solved.exhausted
          ? 'Still checking this one — posting will settle it, or try Repair.'
          : 'No solution fills every cell. Move a dot or two and try again.',
      },
    };
  }
  // Handing the solution back saves the caller a second search: the post needs
  // one to prove the board and to measure its difficulty.
  return { verdict: 'ok', check: { state: 'ok' }, solution: solved.routes };
}

// Tap-to-place-pairs editing: tapping an empty cell drops a dot (or completes
// the active pair); tapping a placed dot picks it back up.
export function tapCell(cell: number, pairs: Dot[], active: number, maxPairs: number, onMax: () => void): { pairs: Dot[]; active: number } {
  const dotAt = new Map<number, number>();
  pairs.forEach((p, i) => { dotAt.set(p.a, i); if (p.b != null) dotAt.set(p.b, i); });
  const owner = dotAt.get(cell);

  if (owner != null) {
    const p = pairs[owner]!;
    const next = [...pairs];
    if (p.b == null) next.splice(owner, 1);
    else if (p.a === cell) next[owner] = { a: p.b, b: null };
    else next[owner] = { a: p.a, b: null };
    return { pairs: next, active: Math.min(owner, next.length) };
  }

  const next = [...pairs];
  const cur = next[active];
  if (cur && cur.b == null) {
    next[active] = { a: cur.a, b: cell };
    return { pairs: next, active: next.length }; // move on to a fresh colour
  }
  if (next.length >= maxPairs) {
    onMax();
    return { pairs, active };
  }
  next.push({ a: cell, b: null });
  return { pairs: next, active: next.length - 1 };
}

// ── Difficulty ───────────────────────────────────────────────────────────────
// The meter runs on a much smaller budget than the post check: it fires while
// the player is still placing dots, so a board it cannot settle is reported as
// "not measured yet" rather than being allowed to block the main thread.
const METER_NODES = 400000;

export type Rated = { pairs: Pair[]; solution: number[][]; rating: WireRating };

// A generated board carries its own carve, and that carve *is* a proof the
// board is solvable — checkSolution verifies it in O(cells) instead of asking
// the solver to search for it again. That is what makes 10×10 usable: searching
// a 10×10 from scratch costs seconds on a phone, checking one costs a millisecond.
export function verifiedSolution(pairs: Pair[], solution: number[][], w: number, h: number): boolean {
  if (pairs.length !== solution.length) return false;
  return checkSolution({ w, h, pairs }, solution.map((cells, color) => ({ color, cells }))).solved;
}

export async function generateForTierVerified(w: number, h: number, tier: WireTier): Promise<Rated | null> {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    const got = generateForTier(Math.floor(Math.random() * 2 ** 31), w, h, tier);
    const pairs = got.puzzle.pairs;
    if (pairs.length < WIRE_CONFIG.minPairs || pairs.length > maxPairsFor(w * h)) continue;
    if (!verifiedSolution(pairs, got.puzzle.solution, w, h)) continue;
    if (got.onTarget || i === 3) return { pairs, solution: got.puzzle.solution, rating: got.rating };
  }
  return null;
}

// Hand-built boards have no carve to lean on, so the meter has to find a
// solution before it can measure one. 'unknown' means the search ran out of
// nodes, which is not a verdict — the board may well be fine.
export function rateBuilt(pairs: Pair[], w: number, h: number, nodeCap = METER_NODES): Rated | 'unknown' | null {
  if (pairs.length < WIRE_CONFIG.minPairs) return null;
  const solved = solveWire({ w, h, pairs }, nodeCap);
  if (!solved.routes) return solved.exhausted ? 'unknown' : null;
  return { pairs, solution: solved.routes, rating: rateBoard({ w, h, pairs }, solved.routes) };
}

// Nudges a player's own board up a tier instead of replacing it. Two levers,
// cheapest first: drop a pair (fewer wires means longer wires means more
// stretch), then pull the most-stretched wire's dots together (same route,
// shorter straight line, so the lie gets bigger). Both keep the board theirs.

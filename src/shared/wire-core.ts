// Colorwire — deterministic puzzle generation, solving, validation, scoring.
// A puzzle is a set of dot pairs on a w×h grid. A solution routes every pair
// with a non-crossing path, and the paths together fill every cell.

export const WIRE_CONFIG = {
  dailyW: 9,
  dailyH: 9,
  dailyPairs: 12,
  minPathLen: 3,
  minSize: 5,
  maxSize: 10,
  minPairs: 3,
  maxPairs: 14,
} as const;

// Index into this array is the pair's colour id. Kept vivid + well separated so
// 14 simultaneous wires stay tellable apart on a small phone screen.
export const WIRE_COLORS: string[] = [
  '#ef4444', // red
  '#3b82f6', // blue
  '#22c55e', // green
  '#eab308', // yellow
  '#f97316', // orange
  '#a855f7', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f5f5f5', // white
  '#84cc16', // lime
  '#15803d', // forest
  '#991b1b', // maroon
  '#a8a29e', // stone
  '#1e40af', // navy
];

export type WirePuzzle = { w: number; h: number; pairs: { a: number; b: number }[] };
export type WireRoute = { color: number; cells: number[] };

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

// ── Grid helpers ─────────────────────────────────────────────────────────────
export const rowOf = (i: number, w: number) => Math.floor(i / w);
export const colOf = (i: number, w: number) => i % w;

function neighborsOf(i: number, w: number, h: number): number[] {
  const r = Math.floor(i / w), c = i % w;
  const out: number[] = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
}

export function areAdjacent(a: number, b: number, w: number): boolean {
  const d = Math.abs(a - b);
  if (d === w) return true;
  return d === 1 && Math.floor(a / w) === Math.floor(b / w);
}

const manhattan = (a: number, b: number, w: number) =>
  Math.abs(Math.floor(a / w) - Math.floor(b / w)) + Math.abs((a % w) - (b % w));

// ── Generation ───────────────────────────────────────────────────────────────
// Phase 1: carve the whole grid into simple paths. Each walk is capped near
// the average wire length the target pair count implies, so the board comes
// out as many medium wires instead of one grid-filling snake. The step choice
// is Warnsdorff-biased (prefer the most constrained neighbour) most of the
// time, which is what stops the walk stranding single cells behind it, but
// stays random often enough that boards differ day to day.
function carve(rand: () => number, w: number, h: number, avgLen: number): number[][] {
  const n = w * h;
  const owner = new Int32Array(n).fill(-1);
  const paths: number[][] = [];
  let free = n;

  const freeNbrCount = (i: number) => neighborsOf(i, w, h).reduce((acc, x) => acc + (owner[x] === -1 ? 1 : 0), 0);

  const step = (head: number): number | null => {
    const opts = neighborsOf(head, w, h).filter(x => owner[x] === -1);
    if (!opts.length) return null;
    if (rand() < 0.25) return opts[Math.floor(rand() * opts.length)]!;
    let best = Infinity, picks: number[] = [];
    for (const o of opts) {
      const c = freeNbrCount(o);
      if (c < best) { best = c; picks = [o]; }
      else if (c === best) picks.push(o);
    }
    return picks[Math.floor(rand() * picks.length)]!;
  };

  while (free > 0) {
    // Start from the most constrained free cells so pockets get consumed first.
    let best = Infinity, picks: number[] = [];
    for (let i = 0; i < n; i++) {
      if (owner[i] !== -1) continue;
      const c = freeNbrCount(i);
      if (c < best) { best = c; picks = [i]; }
      else if (c === best) picks.push(i);
    }
    const start = picks[Math.floor(rand() * picks.length)]!;
    const id = paths.length;
    owner[start] = id;
    free--;
    const path = [start];
    paths.push(path);

    const cap = Math.max(WIRE_CONFIG.minPathLen, Math.round(avgLen * (0.6 + rand() * 1.1)));
    while (path.length < cap) {
      const next = step(path[path.length - 1]!);
      if (next === null) break;
      owner[next] = id;
      free--;
      path.push(next);
    }
    // Grow backwards too if the forward walk died early.
    while (path.length < cap) {
      const next = step(path[0]!);
      if (next === null) break;
      owner[next] = id;
      free--;
      path.unshift(next);
    }
  }
  return paths;
}

// Phase 2: absorb 1-cell paths — a pair whose two dots share a cell can't be
// drawn. Prefer welding onto another path's end; otherwise split that path.
function absorbSingles(paths: number[][], w: number, h: number): boolean {
  for (let guard = 0; guard < 400; guard++) {
    const idx = paths.findIndex(p => p.length === 1);
    if (idx === -1) return true;
    const cell = paths[idx]![0]!;
    const nbrs = neighborsOf(cell, w, h);

    let done = false;
    // Weld onto an endpoint.
    for (let j = 0; j < paths.length && !done; j++) {
      if (j === idx) continue;
      const p = paths[j]!;
      if (nbrs.includes(p[0]!)) { p.unshift(cell); done = true; }
      else if (nbrs.includes(p[p.length - 1]!)) { p.push(cell); done = true; }
    }
    // Otherwise cut a neighbouring path in two and weld onto the cut end.
    for (let j = 0; j < paths.length && !done; j++) {
      if (j === idx) continue;
      const p = paths[j]!;
      const at = p.findIndex(c => nbrs.includes(c));
      if (at <= 0 || at >= p.length - 1) continue;
      const head = p.slice(0, at + 1);
      const tail = p.slice(at + 1);
      head.push(cell);
      paths[j] = head;
      paths.push(tail);
      done = true;
    }
    if (!done) return false;
    paths.splice(idx, 1);
  }
  return false;
}

// Phase 3: merge end-to-end / split long paths until the pair count matches.
function tuneCount(rand: () => number, paths: number[][], target: number, w: number): void {
  const shuffle = <T,>(arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
    return arr;
  };

  while (paths.length > target) {
    const order = shuffle(paths.map((_, i) => i));
    let merged = false;
    outer: for (const i of order) {
      for (const j of order) {
        if (i === j) continue;
        const a = paths[i]!, b = paths[j]!;
        if (!a || !b) continue;
        const aEnd = a[a.length - 1]!, aStart = a[0]!;
        const bEnd = b[b.length - 1]!, bStart = b[0]!;
        let joined: number[] | null = null;
        if (areAdjacent(aEnd, bStart, w)) joined = [...a, ...b];
        else if (areAdjacent(aEnd, bEnd, w)) joined = [...a, ...[...b].reverse()];
        else if (areAdjacent(aStart, bStart, w)) joined = [...[...a].reverse(), ...b];
        else if (areAdjacent(aStart, bEnd, w)) joined = [...b, ...a];
        if (joined) {
          paths[i] = joined;
          paths.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
    if (!merged) return;
  }

  while (paths.length < target) {
    let longest = 0;
    for (let i = 1; i < paths.length; i++) if (paths[i]!.length > paths[longest]!.length) longest = i;
    const p = paths[longest]!;
    if (p.length < WIRE_CONFIG.minPathLen * 2) return;
    const cut = Math.floor(p.length / 2);
    paths[longest] = p.slice(0, cut);
    paths.push(p.slice(cut));
  }
}

// Rejects boards that would play flat: a too-short wire, dots sitting next to
// each other, or too many pairs solved by a single straight line.
function isGoodBoard(paths: number[][], target: number, w: number): boolean {
  if (paths.length !== target) return false;
  let straight = 0;
  for (const p of paths) {
    if (p.length < WIRE_CONFIG.minPathLen) return false;
    const a = p[0]!, b = p[p.length - 1]!;
    const md = manhattan(a, b, w);
    if (md < 2) return false;
    if (md === p.length - 1 && (Math.floor(a / w) === Math.floor(b / w) || a % w === b % w)) straight++;
  }
  return straight <= 2;
}

export type GeneratedPuzzle = WirePuzzle & { solution: number[][] };

export function generatePuzzle(seed: number, w: number, h: number, targetPairs: number): GeneratedPuzzle {
  const target = Math.min(targetPairs, WIRE_COLORS.length);
  let fallback: GeneratedPuzzle | null = null;

  const avgLen = (w * h) / target;
  for (let attempt = 0; attempt < 120; attempt++) {
    const rand = mulberry32(seed + attempt * 0x9e3779b9);
    const paths = carve(rand, w, h, avgLen);
    if (!absorbSingles(paths, w, h)) continue;
    tuneCount(rand, paths, target, w);
    if (paths.some(p => p.length < 2)) continue;

    const built: GeneratedPuzzle = {
      w, h,
      pairs: paths.map(p => ({ a: p[0]!, b: p[p.length - 1]! })),
      solution: paths,
    };
    if (isGoodBoard(paths, target, w)) return built;
    // Keep the closest miss so generation can't hard-fail on odd sizes.
    if (!fallback || Math.abs(paths.length - target) < Math.abs(fallback.pairs.length - target)) fallback = built;
  }
  return fallback ?? { w, h, pairs: [], solution: [] };
}

export function getDailyPuzzle(date: string): GeneratedPuzzle {
  return generatePuzzle(seedFromString(`colorwire:${date}`), WIRE_CONFIG.dailyW, WIRE_CONFIG.dailyH, WIRE_CONFIG.dailyPairs);
}

// ── Difficulty ───────────────────────────────────────────────────────────────
// Fitted to five boards with measured human solve times (33s → 5+ min). What
// separates them is not size, pair count or wire length — it is the *contrast*
// between an honest wire and a lying one on the same board.
//
//   stretch — cells a wire's real route covers ÷ cells a straight run would.
//             A wire whose dots sit two apart but must travel twenty cells
//             stretches 7×, and that is the wire that breaks people.
//   decoy   — a wire that is basically its own shortest path. It teaches
//             "draw short", which is the wrong lesson the stretched wire then
//             punishes. Uniformly hard boards are easy; mixed ones are brutal.
//
// A wire covering over 45% of the board is excluded from the stretch: that one
// is the mop-up, its region has a single possible owner, so it is forced rather
// than ambiguous. A 54% wire looked terrifying and solved in 33 seconds.
export const WIRE_DIFFICULTY = {
  // Above this share of the board a wire is mop-up, not a trap.
  mopUpShare: 0.45,
  // At or under this stretch a wire reads as "just draw it straight".
  decoyStretch: 1.5,
  // 4.0, not 4.2: the dailies measure 4.07 and play as medium, so a higher
  // boundary would file the game's own daily board under easy.
  mediumAt: 4,
  hardAt: 6,
} as const;

export type WireTier = 'easy' | 'medium' | 'hard';
export const WIRE_TIERS: readonly WireTier[] = ['easy', 'medium', 'hard'] as const;
export const WIRE_TIER_LABEL: Record<WireTier, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

export type WireRating = {
  score: number;
  tier: WireTier;
  maxStretch: number;
  decoys: number;
  pairs: number;
};

export function tierOf(score: number): WireTier {
  if (score >= WIRE_DIFFICULTY.hardAt) return 'hard';
  if (score >= WIRE_DIFFICULTY.mediumAt) return 'medium';
  return 'easy';
}

// `solution` is route i for pair i — either the generator's own carve or
// whatever the solver came back with for a hand-built board.
export function rateBoard(puzzle: WirePuzzle, solution: number[][]): WireRating {
  const { w, h, pairs } = puzzle;
  const cells = w * h;
  const mopUp = cells * WIRE_DIFFICULTY.mopUpShare;

  let maxStretch = 0;
  let decoys = 0;
  for (let i = 0; i < pairs.length; i++) {
    const route = solution[i];
    const pair = pairs[i];
    if (!route || !pair || route.length < 2) continue;
    // Cells a dead-straight run would cover, so an unforced wire scores 1.0.
    const straight = manhattan(pair.a, pair.b, w) + 1;
    const stretch = route.length / straight;
    if (stretch <= WIRE_DIFFICULTY.decoyStretch) decoys++;
    if (route.length <= mopUp && stretch > maxStretch) maxStretch = stretch;
  }

  // Decoys count as a *share*: raw counts rewarded the dailies, which have
  // eight or nine only because every one of their wires is short.
  const score = pairs.length ? maxStretch * (1 + decoys / pairs.length) : 0;
  return { score, tier: tierOf(score), maxStretch, decoys, pairs: pairs.length };
}

// Pair counts that make each tier reachable, scaled off the 9×9 sweep where
// hard boards only ever appeared between 5 and 8 pairs — never at 3–4 (no wire
// can be a decoy when every wire must be long) and never at 12+ (no wire can
// stretch when they are all short). Difficulty is a hump, not a slope.
const TIER_PAIRS: Record<WireTier, { lo: number; hi: number }> = {
  hard: { lo: 5, hi: 8 },
  medium: { lo: 6, hi: 11 },
  easy: { lo: 10, hi: 14 },
};

export function pairRangeFor(tier: WireTier, w: number, h: number): { lo: number; hi: number } {
  const scale = (w * h) / 81;
  const cap = Math.min(WIRE_CONFIG.maxPairs, Math.floor((w * h) / 3));
  const band = TIER_PAIRS[tier];
  // Hard never scales below five pairs. Under that every wire has to be long,
  // so no wire can play the decoy — the sweep found zero hard boards at 3-4
  // pairs however good their raw stretch looked.
  const floor = tier === 'hard' ? 5 : WIRE_CONFIG.minPairs;
  const lo = Math.max(floor, Math.min(cap, Math.round(band.lo * scale)));
  const hi = Math.max(lo, Math.min(cap, Math.round(band.hi * scale)));
  return { lo, hi };
}

// Generate → measure → reject → repeat. Hard lands about one try in four, and
// each try is a carve plus an O(cells) measure, so this stays in milliseconds.
// Crucially it does NOT raise the pair count between tries: more pairs is the
// one change that reliably destroys a hard board.
export function generateForTier(seed: number, w: number, h: number, tier: WireTier, tries = 24):
{ puzzle: GeneratedPuzzle; rating: WireRating; onTarget: boolean } {
  const { lo, hi } = pairRangeFor(tier, w, h);
  const rand = mulberry32(seed);
  let best: { puzzle: GeneratedPuzzle; rating: WireRating } | null = null;

  for (let i = 0; i < tries; i++) {
    const target = lo + Math.floor(rand() * (hi - lo + 1));
    const puzzle = generatePuzzle(Math.floor(rand() * 2 ** 31), w, h, target);
    if (!puzzle.pairs.length) continue;
    const rating = rateBoard(puzzle, puzzle.solution);
    if (rating.tier === tier) return { puzzle, rating, onTarget: true };
    // Closest miss by score keeps a small board from failing outright.
    const gap = tierGap(rating.score, tier);
    if (!best || gap < tierGap(best.rating.score, tier)) best = { puzzle, rating };
  }

  if (!best) {
    const puzzle = generatePuzzle(seed, w, h, lo);
    return { puzzle, rating: rateBoard(puzzle, puzzle.solution), onTarget: false };
  }
  return { ...best, onTarget: false };
}

function tierGap(score: number, tier: WireTier): number {
  const lo = tier === 'hard' ? WIRE_DIFFICULTY.hardAt : tier === 'medium' ? WIRE_DIFFICULTY.mediumAt : -Infinity;
  const hi = tier === 'easy' ? WIRE_DIFFICULTY.mediumAt : tier === 'medium' ? WIRE_DIFFICULTY.hardAt : Infinity;
  if (score < lo) return lo - score;
  if (score > hi) return score - hi;
  return 0;
}

// ── Solving ──────────────────────────────────────────────────────────────────
// Backtracking flow solver, used to prove a hand-built custom board is
// actually completable before it can be posted. `nodeCap` bounds the search so
// a pathological board fails fast instead of hanging the request.
export type SolveResult = {
  routes: number[][] | null;
  // Set when the search ran out of nodes before proving anything. The board may
  // well be solvable — callers must not report "no solution" on this.
  exhausted: boolean;
};

export function solveWire(puzzle: WirePuzzle, nodeCap = 400000): SolveResult {
  const { w, h, pairs } = puzzle;
  const n = w * h;
  const k = pairs.length;
  const no = (): SolveResult => ({ routes: null, exhausted: false });
  if (!k) return no();

  const grid = new Int32Array(n).fill(-1);
  for (let i = 0; i < k; i++) {
    const { a, b } = pairs[i]!;
    if (a === b || a < 0 || b < 0 || a >= n || b >= n) return no();
    if (grid[a] !== -1 || grid[b] !== -1) return no();
    grid[a] = i; grid[b] = i;
  }

  const nbrCache: number[][] = Array.from({ length: n }, (_, i) => neighborsOf(i, w, h));
  const routes: number[][] = pairs.map(() => []);
  const heads = new Int32Array(k);
  for (let c = 0; c < k; c++) heads[c] = pairs[c]!.a;
  let live: number[] = pairs.map((_, c) => c);   // colours still to route
  let nodes = 0;
  let capped = false;
  let empties = n - k * 2;

  // Scratch buffers reused across the whole search — the pruning check runs on
  // every placement, so per-call allocation would dominate the runtime.
  const endStamp = new Int32Array(n);   // stamped on every live head and target
  const endColor = new Int32Array(n);
  const endIsHead = new Uint8Array(n);
  const regStamp = new Int32Array(n);
  const stack = new Int32Array(n);
  const headMask = new Int32Array(n);   // per empty region: colours whose head touches it
  const tgtMask = new Int32Array(n);
  const serves = new Int32Array(n);     // per empty region: colours that touch it at both ends
  const regionOf = new Int32Array(n);
  // One 4-slot window per recursion level: a move list has to survive the
  // recursive call that runs between picking it and reading the next entry.
  const order = new Int32Array(4 * (n + 2));
  const orderKey = new Int32Array(4 * (n + 2));
  let mark = 0;
  // The region masks are bitfields, so that check only holds while a colour
  // index fits in one.
  const maskable = k <= 30;

  const freeDeg = (i: number) => {
    let d = 0;
    for (const nb of nbrCache[i]!) if (grid[nb] === -1) d++;
    return d;
  };

  // Three facts, each O(cells), checked after every placement:
  //   1. an empty cell is entered once and left once, so it needs two usable
  //      neighbours — another empty cell, a live head, or a live target;
  //   2. a live head must still have somewhere to step, and a live target must
  //      still be enterable;
  //   3. a wire only reaches an empty region from its head and only leaves it
  //      into its own target, so every region needs a colour touching it at
  //      both ends, and every colour needs such a region (or its target next
  //      door). That subsumes the older "can each head still reach its target"
  //      flood and is what keeps the node count survivable on 9×9.
  const feasible = (): boolean => {
    const ends = ++mark;
    for (const c of live) {
      const start = heads[c]!, target = pairs[c]!.b;
      endStamp[start] = ends; endColor[start] = c; endIsHead[start] = 1;
      endStamp[target] = ends; endColor[target] = c; endIsHead[target] = 0;
    }

    // Label the empty regions, noting which live head and target each touches.
    const reg = ++mark;
    let regions = 0;
    let served = 0;
    for (let i = 0; i < n; i++) {
      if (grid[i] !== -1 || regStamp[i] === reg) continue;
      const r = regions++;
      headMask[r] = 0; tgtMask[r] = 0;
      let sp = 0;
      stack[sp++] = i; regStamp[i] = reg; regionOf[i] = r;
      while (sp) {
        const cur = stack[--sp]!;
        for (const nb of nbrCache[cur]!) {
          if (grid[nb] === -1) {
            if (regStamp[nb] === reg) continue;
            regStamp[nb] = reg; regionOf[nb] = r;
            stack[sp++] = nb;
          } else if (endStamp[nb] === ends) {
            if (endIsHead[nb]) headMask[r] |= 1 << endColor[nb]!;
            else tgtMask[r] |= 1 << endColor[nb]!;
          }
        }
      }
      // A wire only enters a region from its head and only leaves it into its
      // own target, so a region no colour touches at both ends can never be
      // filled.
      const both = maskable ? headMask[r]! & tgtMask[r]! : -1;
      if (!both) return false;
      serves[r] = both;
      served |= both;
    }

    // An empty cell is entered once and left once, so it needs two usable
    // neighbours: another empty cell, or an end belonging to a colour that can
    // actually work this region.
    for (let i = 0; i < n; i++) {
      if (grid[i] !== -1) continue;
      const owners = serves[regionOf[i]!]!;
      let deg = 0;
      for (const nb of nbrCache[i]!) {
        if (grid[nb] === -1) deg++;
        else if (endStamp[nb] === ends && ((owners >> endColor[nb]!) & 1)) deg++;
      }
      if (deg < 2) return false;
    }

    // A live head must still have somewhere to step, a live target must still
    // be enterable, and a colour with no region to work must be closing onto a
    // target right next door.
    for (const c of live) {
      const start = heads[c]!, target = pairs[c]!.b;
      let out = 0, into = 0;
      for (const nb of nbrCache[start]!) if (grid[nb] === -1 || nb === target) out++;
      for (const nb of nbrCache[target]!) if (grid[nb] === -1 || nb === start) into++;
      if (!out || !into) return false;
      if (maskable && !((served >> c) & 1) && !areAdjacent(start, target, w)) return false;
    }
    return true;
  };

  // Route the most boxed-in wire first: a head with one way out is forced, and
  // taking forced moves early is what stops the search exploring the free wires
  // over and over under a choice that was already dead.
  const pickColor = (): number => {
    let best = -1, bestKey = 99;
    for (const c of live) {
      const key = freeDeg(heads[c]!);
      if (key < bestKey) { best = c; bestKey = key; }
    }
    return best;
  };

  const walk = (color: number, depth: number): boolean => {
    if (++nodes > nodeCap) { capped = true; return false; }
    const base = depth * 4;
    const head = heads[color]!;
    const route = routes[color]!;
    const target = pairs[color]!.b;

    // Warnsdorff order: step into the most boxed-in cell first. Wires then hug
    // walls and each other instead of cutting the board in half, which is what
    // the region check would otherwise reject a few thousand nodes later.
    let count = 0;
    let hitTarget = false;
    for (const nb of nbrCache[head]!) {
      if (nb === target) { hitTarget = true; continue; }
      if (grid[nb] !== -1) continue;
      order[base + count] = nb; orderKey[base + count] = freeDeg(nb); count++;
    }
    for (let i = 1; i < count; i++) {
      const v = order[base + i]!, key = orderKey[base + i]!;
      let j = i - 1;
      while (j >= 0 && orderKey[base + j]! > key) { order[base + j + 1] = order[base + j]!; orderKey[base + j + 1] = orderKey[base + j]!; j--; }
      order[base + j + 1] = v; orderKey[base + j + 1] = key;
    }

    if (hitTarget) {
      route.push(target);
      const rest = live.filter(c => c !== color);
      if (!rest.length) {
        if (empties === 0) return true;
      } else {
        const prev = live;
        live = rest;
        const next = pickColor();
        routes[next]!.push(heads[next]!);
        if (feasible() && walk(next, depth + 1)) return true;
        routes[next]!.length = 0;
        live = prev;
      }
      route.pop();
      if (capped) return false;
    }

    for (let i = 0; i < count; i++) {
      const nb = order[base + i]!;
      grid[nb] = color;
      empties--;
      route.push(nb);
      heads[color] = nb;
      if (feasible() && walk(color, depth + 1)) return true;
      heads[color] = head;
      route.pop();
      empties++;
      grid[nb] = -1;
      if (capped) return false;
    }
    return false;
  };

  const first = pickColor();
  routes[first]!.push(pairs[first]!.a);
  if (!feasible()) return no();
  if (walk(first, 0)) return { routes, exhausted: false };
  return { routes: null, exhausted: capped };
}

export function solvePuzzle(puzzle: WirePuzzle, nodeCap = 400000): number[][] | null {
  return solveWire(puzzle, nodeCap).routes;
}

// ── Validation ───────────────────────────────────────────────────────────────
export type CheckResult = { solved: boolean; filled: number; connected: number; reason?: string };

export function checkSolution(puzzle: WirePuzzle, routes: WireRoute[]): CheckResult {
  const { w, h, pairs } = puzzle;
  const n = w * h;
  const used = new Int32Array(n).fill(-1);
  let connected = 0;
  let filled = 0;

  for (const route of routes) {
    const pair = pairs[route.color];
    if (!pair) return { solved: false, filled: 0, connected: 0, reason: 'unknown color' };
    const cells = route.cells;
    if (cells.length < 2) continue;
    const first = cells[0]!, last = cells[cells.length - 1]!;
    const endsMatch = (first === pair.a && last === pair.b) || (first === pair.b && last === pair.a);

    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]!;
      if (c < 0 || c >= n) return { solved: false, filled: 0, connected: 0, reason: 'off-board cell' };
      if (used[c] !== -1) return { solved: false, filled: 0, connected: 0, reason: 'cells overlap' };
      if (i > 0 && !areAdjacent(cells[i - 1]!, c, w)) return { solved: false, filled: 0, connected: 0, reason: 'path breaks' };
      used[c] = route.color;
      filled++;
    }
    if (endsMatch) connected++;
  }

  // A wire may not run over another pair's dot.
  for (let i = 0; i < pairs.length; i++) {
    const { a, b } = pairs[i]!;
    if ((used[a] !== -1 && used[a] !== i) || (used[b] !== -1 && used[b] !== i)) {
      return { solved: false, filled, connected, reason: 'covers another dot' };
    }
  }

  return { solved: connected === pairs.length && filled === n, filled, connected };
}

// ── Drawing ──────────────────────────────────────────────────────────────────
// One orthogonal step of the wire the player is dragging. Mutates `routes`
// (already a caller-owned copy) and reports what happened:
//   ok      — cell taken, keep going
//   blocked — illegal step, the drag stops here
//   done    — the wire reached its own second dot
// Re-entering the wire's own trail rewinds it; entering another colour's wire
// truncates that one, like pulling a crossed cable out of the way.
export type StepOutcome = { outcome: 'ok' | 'blocked' | 'done'; cut: boolean };

export function advanceWire(routes: number[][], pairs: WirePuzzle['pairs'], w: number, color: number, cell: number): StepOutcome {
  const path = routes[color];
  const last = path?.[path.length - 1];
  if (!path || last == null || !areAdjacent(last, cell, w)) return { outcome: 'blocked', cut: false };

  const back = path.indexOf(cell);
  if (back !== -1) { routes[color] = path.slice(0, back + 1); return { outcome: 'ok', cut: false }; }

  let dotColor = -1;
  for (let i = 0; i < pairs.length; i++) if (pairs[i]!.a === cell || pairs[i]!.b === cell) { dotColor = i; break; }
  if (dotColor !== -1 && dotColor !== color) return { outcome: 'blocked', cut: false };

  let cut = false;
  for (let k = 0; k < routes.length; k++) {
    if (k === color) continue;
    const at = routes[k]!.indexOf(cell);
    if (at !== -1) { routes[k] = routes[k]!.slice(0, at); cut = true; }
  }

  routes[color] = [...path, cell];
  return { outcome: dotColor === color ? 'done' : 'ok', cut };
}

// ── Scoring ──────────────────────────────────────────────────────────────────
// Time is the headline; each pipe redraw costs a little so a clean solve beats
// a scribbled one. Board size sets the base so custom sizes stay comparable.
export function wireScore(elapsedSec: number, moves: number, cells: number): number {
  const base = 60 * cells;
  const t = Math.min(Math.max(elapsedSec, 0), 3600);
  return Math.max(200, Math.round(base - t * 10 - moves * 20));
}

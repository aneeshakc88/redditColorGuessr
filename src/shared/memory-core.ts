// "The Run" — color memory stack game. Shared, deterministic engine (server-authoritative).

export const MEMORY_CONFIG = {
  startSize: 6,
  maxSize: 10,
  largeThreshold: 10, // stacks >= this use the large palette + longer memorize time
  paletteSmall: 6,
  paletteLarge: 8,
  timeSmallMs: 8000,
  timeLargeMs: 10000,
} as const;

// Vivid, well-separated named colors. The day's palette is an 8-color subset of these.
const MEMORY_COLORS: { name: string; hex: string }[] = [
  { name: 'Red',     hex: '#E53935' },
  { name: 'Orange',  hex: '#FB8C00' },
  { name: 'Amber',   hex: '#FFB300' },
  { name: 'Yellow',  hex: '#FDD835' },
  { name: 'Lime',    hex: '#7CB342' },
  { name: 'Green',   hex: '#43A047' },
  { name: 'Teal',    hex: '#00897B' },
  { name: 'Cyan',    hex: '#00ACC1' },
  { name: 'Blue',    hex: '#1E88E5' },
  { name: 'Indigo',  hex: '#3949AB' },
  { name: 'Purple',  hex: '#8E24AA' },
  { name: 'Magenta', hex: '#D81B60' },
  { name: 'Pink',    hex: '#EC407A' },
  { name: 'Brown',   hex: '#6D4C41' },
];

function seededRand(seed: number) {
  let s = seed;
  return () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
}

function dateSeed(date: string, salt: number): number {
  return date.split('-').map(Number).reduce((a, b) => a * 31 + b, salt);
}

export function memorizeMs(size: number): number {
  return size >= MEMORY_CONFIG.largeThreshold ? MEMORY_CONFIG.timeLargeMs : MEMORY_CONFIG.timeSmallMs;
}

export function paletteSize(size: number): number {
  return size >= MEMORY_CONFIG.largeThreshold ? MEMORY_CONFIG.paletteLarge : MEMORY_CONFIG.paletteSmall;
}

// `variant` perturbs the seed for bonus rounds; variant 0 reproduces the daily exactly.
const VARIANT_SALT = 1_000_003;

// The day's fixed 8-color palette (order stable across the run). Small stacks use the first 6.
export function getDailyPalette(date: string, variant = 0): { name: string; hex: string }[] {
  const rand = seededRand(dateSeed(date, 7919 + variant * VARIANT_SALT));
  const pool = [...MEMORY_COLORS];
  const out: { name: string; hex: string }[] = [];
  while (out.length < MEMORY_CONFIG.paletteLarge && pool.length) {
    const idx = Math.floor(rand() * pool.length);
    out.push(pool.splice(idx, 1)[0]!);
  }
  return out;
}

// Deterministic color-index sequence (into the 8-palette) for a given date + stack size.
export function getStackSequence(date: string, size: number, variant = 0): number[] {
  const pSize = paletteSize(size);
  const rand = seededRand(dateSeed(date, size * 100003 + 1 + variant * VARIANT_SALT));
  return Array.from({ length: size }, () => Math.floor(rand() * pSize));
}

// depth = deepest fully cleared stack size (startSize-1 if none cleared).
export function runScore(depth: number, failed: boolean, failR: number): number {
  let s = 0;
  for (let k = MEMORY_CONFIG.startSize; k <= depth; k++) s += k * k;
  if (failed) {
    const failedSize = depth + 1;
    if (failedSize <= MEMORY_CONFIG.maxSize) s += failR * failedSize;
  }
  return s;
}

// The headline stack a player "reached": the one they failed, or maxSize if they cleared everything.
export function reachedStack(depth: number, failed: boolean): number {
  return failed ? Math.min(depth + 1, MEMORY_CONFIG.maxSize) : MEMORY_CONFIG.maxSize;
}

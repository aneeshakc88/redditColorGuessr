export const MASTERMIND_CONFIG = {
  daily: { poolSize: 7, secretLen: 5, maxGuesses: 15 },
  custom: { poolSize: 6, secretLen: 4, maxGuesses: 11 },
} as const;

export function mmConfig(isCustom: boolean) {
  return isCustom ? MASTERMIND_CONFIG.custom : MASTERMIND_CONFIG.daily;
}

const MASTERMIND_COLORS: { name: string; hex: string }[] = [
  { name: 'Red',     hex: '#E53935' },
  { name: 'Orange',  hex: '#FB8C00' },
  { name: 'Yellow',  hex: '#FDD835' },
  { name: 'Green',   hex: '#43A047' },
  { name: 'Teal',    hex: '#00897B' },
  { name: 'Blue',    hex: '#1E88E5' },
  { name: 'Indigo',  hex: '#3949AB' },
  { name: 'Purple',  hex: '#8E24AA' },
  { name: 'Pink',    hex: '#E91E63' },
  { name: 'Brown',   hex: '#6D4C41' },
  { name: 'Coral',   hex: '#FF7043' },
  { name: 'Lime',    hex: '#7CB342' },
  { name: 'Cyan',    hex: '#00ACC1' },
  { name: 'Violet',  hex: '#7B1FA2' },
  { name: 'Magenta', hex: '#D81B60' },
  { name: 'Amber',   hex: '#FFB300' },
  { name: 'Navy',    hex: '#1565C0' },
  { name: 'Sage',    hex: '#558B2F' },
];

// FNV-1a: neighbouring dates must land on unrelated seeds. The old seed was an
// arithmetic blend of Y/M/D, so consecutive days differed by exactly 1.
function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32. The old generator was `Math.sin(seed++)`, which made day N+1's
// number stream day N's stream shifted one step — and since the pool loop
// consumes a variable number of draws (it rejects duplicate colours), nearby
// days kept landing on the same stream position and drawing the same code.
// Aug 8/11 and Aug 9/10 of 2026 collided exactly that way.
function seededRand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDailyMastermind(today: string): { poolColors: { name: string; hex: string }[]; secret: string[] } {
  const { poolSize, secretLen } = MASTERMIND_CONFIG.daily;
  const rand = seededRand(hashSeed(`mastermind:${today}`));

  const pool: { name: string; hex: string }[] = [];
  const used = new Set<number>();
  while (pool.length < poolSize) {
    const idx = Math.floor(rand() * MASTERMIND_COLORS.length);
    if (!used.has(idx)) { used.add(idx); pool.push(MASTERMIND_COLORS[idx]!); }
  }

  const secret: string[] = [];
  for (let i = 0; i < secretLen; i++) {
    secret.push(pool[Math.floor(rand() * poolSize)]!.hex);
  }

  return { poolColors: pool, secret };
}

export function getMastermindFeedback(secret: string[], guess: string[]): { greens: number; yellows: number } {
  let greens = 0;
  const sLeft: Record<string, number> = {};
  const gLeft: Record<string, number> = {};

  for (let i = 0; i < secret.length; i++) {
    if (secret[i] === guess[i]) {
      greens++;
    } else {
      sLeft[secret[i]!] = (sLeft[secret[i]!] ?? 0) + 1;
      gLeft[guess[i]!] = (gLeft[guess[i]!] ?? 0) + 1;
    }
  }

  let yellows = 0;
  for (const c of Object.keys(gLeft)) yellows += Math.min(gLeft[c]!, sLeft[c] ?? 0);

  return { greens, yellows };
}

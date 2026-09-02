import { FLAGS_DATA } from './flags-data';
import { viewBoxRatio } from './flag-highlight';

export type DailyFlagRound = {
  flag: { name: string; svg: string };
  hiddenHex: string;
  wrongHex: string;
  // Element positions this region owns; absent means the whole hex is fair game.
  hiddenIdx?: number[];
};

// ── colour helpers (shared so client + server agree on the "wrong" colour) ──────

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return '#' + to(r) + to(g) + to(b);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Produce a plausible-but-clearly-wrong colour for the hidden region.
function makeWrongHex(hex: string, rand: () => number): string {
  const { h, s, l } = hexToHsl(hex);
  if (s < 0.12) {
    // near black/white/grey — give it an obvious tint, keep dark/light bias
    const nh = rand() * 360;
    const ns = 0.45 + rand() * 0.25;
    const nl = l > 0.5 ? 0.55 + rand() * 0.2 : 0.28 + rand() * 0.2;
    return hslToHex(nh, ns, nl);
  }
  const nh = h + 70 + rand() * 160; // rotate 70–230°
  const ns = clamp(s * (0.7 + rand() * 0.5), 0.35, 1);
  const nl = clamp(l + (rand() - 0.5) * 0.24, 0.22, 0.8);
  return hslToHex(nh, ns, nl);
}

function seededRand(seed: number) {
  let s = seed;
  return () => { const x = Math.sin(s++) * 10000; return x - Math.floor(x); };
}

function pickRoundsForDate(date: string, excludeNames: Set<string>): DailyFlagRound[] {
  const seed = date.split('-').map(Number).reduce((a, b) => a * 31 + b, 4271);
  const rand = seededRand(seed);

  const rounds: DailyFlagRound[] = [];
  const used = new Set<number>();

  for (let i = 0; i < 5; i++) {
    let idx: number;
    let tries = 0;
    do {
      idx = Math.floor(rand() * FLAGS_DATA.length);
      tries++;
    } while ((used.has(idx) || excludeNames.has(FLAGS_DATA[idx]!.name)) && tries < 200);
    used.add(idx);

    const flag = FLAGS_DATA[idx]!;
    const region = flag.hideable[Math.floor(rand() * flag.hideable.length)]!;
    rounds.push({
      flag: { name: flag.name, svg: flag.svg },
      hiddenHex: region.hex,
      wrongHex: makeWrongHex(region.hex, rand),
      ...(region.idx ? { hiddenIdx: region.idx } : {}),
    });
  }

  return rounds;
}

const FLAG_EPOCH = '2026-07-05';

function dateToDayNum(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function dayNumToDate(n: number): string {
  return new Date(n * 86400000).toISOString().split('T')[0]!;
}

// Walks day-by-day from launch so no flag repeats within any 3 consecutive
// dailies (today excludes yesterday's and the day-before's picks). Cheap even
// after years of daily posts — a few thousand iterations of 5-item picks.
export function getDailyFlagPuzzle(date: string): DailyFlagRound[] {
  const targetDay = dateToDayNum(date);
  const epochDay = dateToDayNum(FLAG_EPOCH);

  let prev1 = new Set<string>();
  let prev2 = new Set<string>();
  let rounds: DailyFlagRound[] = [];

  for (let day = epochDay; day <= targetDay; day++) {
    const exclude = new Set([...prev1, ...prev2]);
    rounds = pickRoundsForDate(dayNumToDate(day), exclude);
    const names = new Set(rounds.map(r => r.flag.name));
    prev2 = prev1;
    prev1 = names;
  }

  return rounds;
}

// Dev gauntlet: every playable region, so one pass covers all of them — a flag's
// colours land back to back. Widest aspect ratio first (Qatar 4.17:1 → Nepal 0.82:1)
// so the layout extremes show up in the first and last few rounds.
export function getGauntletRounds(): DailyFlagRound[] {
  const rand = seededRand(4271);
  return [...FLAGS_DATA]
    .sort((a, b) => viewBoxRatio(b.svg) - viewBoxRatio(a.svg))
    .flatMap(flag =>
      flag.hideable.map(region => ({
        flag: { name: flag.name, svg: flag.svg },
        hiddenHex: region.hex,
        wrongHex: makeWrongHex(region.hex, rand),
        ...(region.idx ? { hiddenIdx: region.idx } : {}),
      })));
}

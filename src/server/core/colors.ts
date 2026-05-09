import { redis } from '@devvit/web/server';
import { getDailyPuzzle } from './game';
import { NTC_COLORS } from '../../shared/ntc_colors';

export type PuzzleColor = { name: string; hex: string };

export function fetchAllPizzaColors(): PuzzleColor[] {
  return NTC_COLORS;
}

function pickDailyFromAll(all: PuzzleColor[], today: string): PuzzleColor[] {
  const seed = today.split('-').map(Number).reduce((a, b) => a * 31 + b, 0);
  const rand = (s: number) => { const x = Math.sin(s) * 10000; return x - Math.floor(x); };
  const selected: PuzzleColor[] = [];
  const used = new Set<number>();
  for (let i = 0; i < 5; i++) {
    let idx: number;
    do { idx = Math.floor(rand(seed + i * 0.123456789) * all.length); } while (used.has(idx));
    used.add(idx);
    selected.push(all[idx]!);
  }
  return selected;
}

export async function getDailyColors(today: string): Promise<PuzzleColor[]> {
  const dailyKey = `color-guesser:daily-colors:${today}`;

  // 1. Check daily cache
  try {
    const cached = await redis.get(dailyKey);
    if (cached) {
      const parsed = JSON.parse(cached) as PuzzleColor[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* fall through */ }

  // 2. Pick from bundled NTC colors (no API call)
  if (NTC_COLORS.length >= 5) {
    const selected = pickDailyFromAll(NTC_COLORS, today);
    try { await redis.set(dailyKey, JSON.stringify(selected)); } catch { /* ok */ }
    return selected;
  }

  // 3. Local palette fallback
  const colors = getDailyPuzzle(new Date(today)).map(c => ({ name: c.name, hex: c.hex }));
  try { await redis.set(dailyKey, JSON.stringify(colors)); } catch { /* ok */ }
  return colors;
}

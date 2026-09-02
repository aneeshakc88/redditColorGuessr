import { COLOR_PALETTE, hexToLab } from '../../shared/colors';
export type { Color } from '../../shared/colors';
export { COLOR_PALETTE };

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

export function getDailyPuzzle(date: Date = new Date()) {
  const dateString = date.toISOString().split('T')[0] ?? '2025-01-01';
  const seed = dateString.split('-').map(Number).reduce((a, b) => a * 31 + b, 0);

  const selected: (typeof COLOR_PALETTE)[number][] = [];
  const used = new Set<number>();

  for (let i = 0; i < 5; i++) {
    let index;
    do {
      const random = seededRandom(seed + i * 0.123456789);
      index = Math.floor(random * COLOR_PALETTE.length);
    } while (used.has(index));

    used.add(index);
    const color = COLOR_PALETTE[index];
    if (color) selected.push(color);
  }

  return selected;
}

export function calculateScore(actualHex: string, guessHex: string, maxScore = 20): number {
  const [l1, a1, b1] = hexToLab(actualHex);
  const [l2, a2, b2] = hexToLab(guessHex);
  const de = Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
  return Math.min(maxScore, Math.max(0, Math.round((1 - Math.min(de, 100) / 100) * maxScore)));
}

export function formatHexColor(hex: string): string {
  return hex.toUpperCase();
}

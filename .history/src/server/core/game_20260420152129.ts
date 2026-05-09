// Color palette for the game - carefully selected colors with nice names
export const COLOR_PALETTE = [
  // Red tones
  { name: 'Crimson', hex: '#DC143C' },
  { name: 'Scarlet', hex: '#FF2400' },
  { name: 'Burgundy', hex: '#800020' },
  { name: 'Maroon', hex: '#800000' },
  { name: 'Coral', hex: '#FF7F50' },

  // Orange tones
  { name: 'Tangerine', hex: '#F28500' },
  { name: 'Saffron', hex: '#F4C430' },
  { name: 'Apricot', hex: '#FBCEB1' },
  { name: 'Peach', hex: '#FFDAB9' },
  { name: 'Pumpkin', hex: '#FF7518' },

  // Yellow tones
  { name: 'Amber', hex: '#FFBF00' },
  { name: 'Gold', hex: '#FFD700' },
  { name: 'Mustard', hex: '#FFDB58' },
  { name: 'Lemon', hex: '#FFFACD' },
  { name: 'Canary', hex: '#FFFF99' },

  // Green tones
  { name: 'Emerald', hex: '#50C878' },
  { name: 'Forest', hex: '#228B22' },
  { name: 'Sage', hex: '#9DC183' },
  { name: 'Olive', hex: '#808000' },
  { name: 'Mint', hex: '#98FF98' },

  // Blue tones
  { name: 'Azure', hex: '#007FFF' },
  { name: 'Sapphire', hex: '#0F52BA' },
  { name: 'Navy', hex: '#000080' },
  { name: 'Cerulean', hex: '#007BA7' },
  { name: 'Indigo', hex: '#4B0082' },

  // Purple tones
  { name: 'Violet', hex: '#EE82EE' },
  { name: 'Plum', hex: '#DDA0DD' },
  { name: 'Lavender', hex: '#E6E6FA' },
  { name: 'Mauve', hex: '#E0B0FF' },
  { name: 'Magenta', hex: '#FF00FF' },

  // Pink tones
  { name: 'Rose', hex: '#FF007F' },
  { name: 'Salmon', hex: '#FA8072' },
  { name: 'Blush', hex: '#FFB6C1' },
  { name: 'Fuchsia', hex: '#FF00FF' },
  { name: 'Hot Pink', hex: '#FF69B4' },

  // Brown/Neutral tones
  { name: 'Chocolate', hex: '#7B3F00' },
  { name: 'Caramel', hex: '#A0522D' },
  { name: 'Coffee', hex: '#6F4E37' },
  { name: 'Khaki', hex: '#C3B091' },
  { name: 'Taupe', hex: '#B38B6D' },

  // Grayscale
  { name: 'Charcoal', hex: '#36454F' },
  { name: 'Slate', hex: '#708090' },
  { name: 'Silver', hex: '#C0C0C0' },
  { name: 'Pearl', hex: '#FDEEF4' },
  { name: 'Ebony', hex: '#555D50' },
];

export type Color = (typeof COLOR_PALETTE)[number];

/**
 * Get a seeded random number based on seed
 */
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Generate today's puzzle using date as seed
 * Returns 5 unique colors for the daily puzzle
 */
export function getDailyPuzzle(date: Date = new Date()): Color[] {
  // Create a seed from the date (YYYY-MM-DD)
  const dateString = date.toISOString().split('T')[0];
  const seed = dateString.split('-').map(Number).reduce((a, b) => a * 31 + b, 0);

  const selected: Color[] = [];
  const used = new Set<number>();

  for (let i = 0; i < 5; i++) {
    let index;
    do {
      const random = seededRandom(seed + i * 0.123456789);
      index = Math.floor(random * COLOR_PALETTE.length);
    } while (used.has(index));

    used.add(index);
    selected.push(COLOR_PALETTE[index]);
  }

  return selected;
}

/**
 * Convert hex color to RGB
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Calculate Euclidean distance between two RGB colors
 * Returns a value between 0-1 where 0 is identical and 1 is maximum difference
 */
export function getColorDistance(color1Hex: string, color2Hex: string): number {
  const c1 = hexToRgb(color1Hex);
  const c2 = hexToRgb(color2Hex);

  const distance = Math.sqrt(
    Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2)
  );

  // Normalize to 0-1 range (max distance is sqrt(3 * 255^2) ≈ 441)
  const maxDistance = Math.sqrt(3 * Math.pow(255, 2));
  return distance / maxDistance;
}

/**
 * Calculate score based on color accuracy
 * Returns 0-20 points where 20 is perfect match
 */
export function calculateScore(actualHex: string, guessHex: string): number {
  const distance = getColorDistance(actualHex, guessHex);
  // Convert distance to score: 0 distance = 20 points, 1 distance = 0 points
  const score = Math.max(0, Math.round((1 - distance) * 20));
  return Math.min(20, score);
}

/**
 * Format hex to a shorter form for storage
 */
export function formatHexColor(hex: string): string {
  return hex.toUpperCase();
}

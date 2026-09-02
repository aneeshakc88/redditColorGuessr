// Readable label ink for a swatch of the given colour — game palettes run from
// near-black blues to bright yellows, so neither white nor dark works alone.
export const inkOn = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(((n >> 16) & 255) / 255) + 0.7152 * lin(((n >> 8) & 255) / 255) + 0.0722 * lin((n & 255) / 255);
  return L > 0.179 ? '#0b1220' : '#ffffff';
};

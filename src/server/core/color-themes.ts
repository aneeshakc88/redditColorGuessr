// Preset 5-color palettes for the auto-scheduled custom ColorGuessr posts.
// Built from common, recognizable color names (and their well-known shades) —
// no obscure/niche names — grouped so every requested base color appears once.
export type ThemeColor = { name: string; hex: string };
export type ColorTheme = { title: string; colors: ThemeColor[] };

export const COLOR_THEMES: ColorTheme[] = [
  {
    title: 'Blue Hour ColorGuessr',
    colors: [
      { name: 'Sky Blue', hex: '#87CEEB' },
      { name: 'Navy Blue', hex: '#000080' },
      { name: 'Royal Blue', hex: '#4169E1' },
      { name: 'Baby Blue', hex: '#89CFF0' },
      { name: 'Midnight Blue', hex: '#191970' },
    ],
  },
  {
    title: 'Green Scene ColorGuessr',
    colors: [
      { name: 'Forest Green', hex: '#228B22' },
      { name: 'Lime Green', hex: '#32CD32' },
      { name: 'Olive Green', hex: '#808000' },
      { name: 'Emerald Green', hex: '#50C878' },
      { name: 'Mint Green', hex: '#98FF98' },
    ],
  },
  {
    title: 'Red Alert ColorGuessr',
    colors: [
      { name: 'Crimson Red', hex: '#DC143C' },
      { name: 'Cherry Red', hex: '#D2042D' },
      { name: 'Brick Red', hex: '#CB4154' },
      { name: 'Scarlet Red', hex: '#FF2400' },
      { name: 'Ruby Red', hex: '#E0115F' },
    ],
  },
  {
    title: 'Purple Reign ColorGuessr',
    colors: [
      { name: 'Royal Purple', hex: '#7851A9' },
      { name: 'Lavender', hex: '#E6E6FA' },
      { name: 'Violet', hex: '#8F00FF' },
      { name: 'Plum', hex: '#8E4585' },
      { name: 'Orchid', hex: '#DA70D6' },
    ],
  },
  {
    title: 'Golden Hour ColorGuessr',
    colors: [
      { name: 'Golden Yellow', hex: '#FFD700' },
      { name: 'Sunflower Yellow', hex: '#FFDA03' },
      { name: 'Amber', hex: '#FFBF00' },
      { name: 'Mustard Yellow', hex: '#FFDB58' },
      { name: 'Lemon Yellow', hex: '#FFF44F' },
    ],
  },
  {
    title: 'Orange Crush ColorGuessr',
    colors: [
      { name: 'Burnt Orange', hex: '#CC5500' },
      { name: 'Tangerine', hex: '#F28500' },
      { name: 'Peach', hex: '#FFE5B4' },
      { name: 'Coral', hex: '#FF7F50' },
      { name: 'Apricot', hex: '#FBCEB1' },
    ],
  },
  {
    title: 'Pink Panther ColorGuessr',
    colors: [
      { name: 'Hot Pink', hex: '#FF69B4' },
      { name: 'Rose Pink', hex: '#FF007F' },
      { name: 'Salmon Pink', hex: '#FF91A4' },
      { name: 'Magenta', hex: '#FF00FF' },
      { name: 'Blush Pink', hex: '#DE5D83' },
    ],
  },
  {
    title: 'Maroon Moment ColorGuessr',
    colors: [
      { name: 'Maroon', hex: '#800000' },
      { name: 'Burgundy', hex: '#800020' },
      { name: 'Chestnut Brown', hex: '#954535' },
      { name: 'Sienna Brown', hex: '#A0522D' },
      { name: 'Rust', hex: '#B7410E' },
    ],
  },
  {
    title: 'Midnight Monochrome ColorGuessr',
    colors: [
      { name: 'Black', hex: '#000000' },
      { name: 'Charcoal Gray', hex: '#36454F' },
      { name: 'Gray', hex: '#808080' },
      { name: 'Silver', hex: '#C0C0C0' },
      { name: 'White', hex: '#FFFFFF' },
    ],
  },
  {
    title: 'Cream & Ivory ColorGuessr',
    colors: [
      { name: 'Cream', hex: '#FFFDD0' },
      { name: 'Ivory', hex: '#FFFFF0' },
      { name: 'Beige', hex: '#F5F5DC' },
      { name: 'Champagne', hex: '#F7E7CE' },
      { name: 'Vanilla', hex: '#F3E5AB' },
    ],
  },
  {
    title: 'Teal Tide ColorGuessr',
    colors: [
      { name: 'Teal', hex: '#008080' },
      { name: 'Turquoise', hex: '#40E0D0' },
      { name: 'Cyan', hex: '#00FFFF' },
      { name: 'Aquamarine', hex: '#7FFFD4' },
      { name: 'Seafoam Green', hex: '#9FE2BF' },
    ],
  },
  {
    title: 'Indigo Night ColorGuessr',
    colors: [
      { name: 'Indigo', hex: '#4B0082' },
      { name: 'Cobalt Blue', hex: '#0047AB' },
      { name: 'Denim Blue', hex: '#1560BD' },
      { name: 'Periwinkle', hex: '#CCCCFF' },
      { name: 'Slate Blue', hex: '#6A5ACD' },
    ],
  },
  {
    title: 'Earth & Sand ColorGuessr',
    colors: [
      { name: 'Tan', hex: '#D2B48C' },
      { name: 'Khaki', hex: '#C3B091' },
      { name: 'Sand', hex: '#C2B280' },
      { name: 'Terracotta', hex: '#E2725B' },
      { name: 'Umber Brown', hex: '#635147' },
    ],
  },
  {
    title: 'Wine & Copper ColorGuessr',
    colors: [
      { name: 'Wine Red', hex: '#722F37' },
      { name: 'Copper', hex: '#B87333' },
      { name: 'Bronze', hex: '#CD7F32' },
      { name: 'Mahogany', hex: '#4E2728' },
      { name: 'Rust Orange', hex: '#B7410E' },
    ],
  },
  {
    title: 'Pastel Party ColorGuessr',
    colors: [
      { name: 'Pastel Pink', hex: '#FFD1DC' },
      { name: 'Pastel Blue', hex: '#AEC6CF' },
      { name: 'Pastel Yellow', hex: '#FDFD96' },
      { name: 'Pastel Green', hex: '#77DD77' },
      { name: 'Pastel Purple', hex: '#B39EB5' },
    ],
  },
  {
    title: 'Neon Nights ColorGuessr',
    colors: [
      { name: 'Neon Green', hex: '#39FF14' },
      { name: 'Neon Pink', hex: '#FF6EC7' },
      { name: 'Neon Yellow', hex: '#FFFF33' },
      { name: 'Electric Blue', hex: '#7DF9FF' },
      { name: 'Neon Orange', hex: '#FF9F00' },
    ],
  },
  {
    title: 'Sunset Blend ColorGuessr',
    colors: [
      { name: 'Sunset Orange', hex: '#FD5E53' },
      { name: 'Flamingo Pink', hex: '#FC8EAC' },
      { name: 'Honey Yellow', hex: '#EBA937' },
      { name: 'Dusty Rose', hex: '#DCAE96' },
      { name: 'Lilac', hex: '#C8A2C8' },
    ],
  },
  {
    title: 'Cool Grays ColorGuessr',
    colors: [
      { name: 'Slate Gray', hex: '#708090' },
      { name: 'Ash Gray', hex: '#B2BEB5' },
      { name: 'Stone Gray', hex: '#928E85' },
      { name: 'Pewter Gray', hex: '#96A8A1' },
      { name: 'Gunmetal Gray', hex: '#2A3439' },
    ],
  },
  {
    title: 'Berry Mix ColorGuessr',
    colors: [
      { name: 'Blackberry', hex: '#4D0135' },
      { name: 'Raspberry', hex: '#E30B5D' },
      { name: 'Blueberry', hex: '#4F86F7' },
      { name: 'Grape Purple', hex: '#6F2DA8' },
      { name: 'Plum', hex: '#8E4585' },
    ],
  },
  {
    title: 'Tropical Splash ColorGuessr',
    colors: [
      { name: 'Turquoise', hex: '#40E0D0' },
      { name: 'Mango Orange', hex: '#FF8243' },
      { name: 'Papaya Orange', hex: '#FFEFD5' },
      { name: 'Lime Green', hex: '#32CD32' },
      { name: 'Hot Pink', hex: '#FF69B4' },
    ],
  },
];

// Deterministic daily rotation: slot 0-9 maps to a different theme each UTC
// day (shift by 1/day), and within any single day all 10 slots land on 10
// distinct themes (offsets 0-9 mod THEME_COUNT never collide). Full rotation
// repeats every COLOR_THEMES.length days — no repeats, no randomness.
export function themeForSlot(slot: number, now: Date = new Date()): ColorTheme {
  const dayNum = Math.floor(now.getTime() / 86400000);
  const idx = (dayNum + slot) % COLOR_THEMES.length;
  return COLOR_THEMES[idx]!;
}

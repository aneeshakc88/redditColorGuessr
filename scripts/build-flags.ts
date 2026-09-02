// Build-time only. Fetches official flag SVGs from flagcdn, normalizes colors,
// measures per-element visible area, decides which elements each colour owns, and
// emits src/shared/flags-data.ts. No runtime network — the emitted file is
// fully self-contained.
// Build+run: npm run flags
import { writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { enumerateElements, elementsWithColor } from '../src/shared/flag-elements';

const CODES = {
  France: 'fr', Italy: 'it', Belgium: 'be', Ireland: 'ie', Romania: 'ro', Nigeria: 'ng', Chad: 'td', Guinea: 'gn',
  Mali: 'ml', 'Ivory Coast': 'ci', Peru: 'pe', Germany: 'de', Netherlands: 'nl', Austria: 'at', Hungary: 'hu',
  Argentina: 'ar', Russia: 'ru', Bulgaria: 'bg', Lithuania: 'lt', Estonia: 'ee', Luxembourg: 'lu', Yemen: 'ye',
  'Sierra Leone': 'sl', Armenia: 'am', Gabon: 'ga', Poland: 'pl', Ukraine: 'ua', Indonesia: 'id', Monaco: 'mc',
  Spain: 'es', Colombia: 'co', Thailand: 'th', 'Costa Rica': 'cr', Botswana: 'bw', Sweden: 'se', Denmark: 'dk',
  Finland: 'fi', Norway: 'no', Iceland: 'is', Switzerland: 'ch', England: 'gb-eng', Japan: 'jp', Bangladesh: 'bd',
  Palau: 'pw', Morocco: 'ma', Vietnam: 'vn', Somalia: 'so', Bolivia: 'bo', Paraguay: 'py',
  Venezuela: 've', Latvia: 'lv', Ecuador: 'ec', Turkey: 'tr', Pakistan: 'pk', China: 'cn', 'San Marino': 'sm',
  Georgia: 'ge', India: 'in', Niger: 'ne', Egypt: 'eg', Laos: 'la', Ethiopia: 'et', Ghana: 'gh', Myanmar: 'mm',
  Mexico: 'mx', Andorra: 'ad', Senegal: 'sn', Cameroon: 'cm', 'Burkina Faso': 'bf', USA: 'us', Liberia: 'lr',
  Malaysia: 'my', Chile: 'cl', Cuba: 'cu', 'Puerto Rico': 'pr', Sudan: 'sd', Bahamas: 'bs', Jordan: 'jo',
  Brazil: 'br', 'El Salvador': 'sv', Nicaragua: 'ni', Guatemala: 'gt', Moldova: 'md', 'Equatorial Guinea': 'gq',
  Algeria: 'dz', Angola: 'ao', Benin: 'bj', Burundi: 'bi', 'Cabo Verde': 'cv', 'Central African Republic': 'cf',
  Comoros: 'km', Congo: 'cg', 'DR Congo': 'cd', Djibouti: 'dj', Eritrea: 'er', Eswatini: 'sz', Gambia: 'gm',
  'Guinea-Bissau': 'gw', Kenya: 'ke', Lesotho: 'ls', Libya: 'ly', Madagascar: 'mg', Malawi: 'mw', Mauritania: 'mr',
  Mozambique: 'mz', Namibia: 'na', Rwanda: 'rw', 'Sao Tome and Principe': 'st', Seychelles: 'sc', 'South Africa': 'za',
  'South Sudan': 'ss', Tanzania: 'tz', Togo: 'tg', Tunisia: 'tn', Uganda: 'ug', Zambia: 'zm', Zimbabwe: 'zw',
  'Antigua and Barbuda': 'ag', Mauritius: 'mu', Barbados: 'bb', Belize: 'bz', Canada: 'ca', Dominica: 'dm',
  'Dominican Republic': 'do', Grenada: 'gd', Guyana: 'gy', Haiti: 'ht', Honduras: 'hn', Jamaica: 'jm', Panama: 'pa',
  'Saint Kitts and Nevis': 'kn', 'Saint Lucia': 'lc', 'Saint Vincent and the Grenadines': 'vc', Suriname: 'sr',
  'Trinidad and Tobago': 'tt', Uruguay: 'uy', Afghanistan: 'af', Azerbaijan: 'az', Bahrain: 'bh',
  Cambodia: 'kh', Cyprus: 'cy', Iran: 'ir', Iraq: 'iq', Israel: 'il', Kuwait: 'kw',
  Lebanon: 'lb', Maldives: 'mv', Mongolia: 'mn', Nepal: 'np', 'North Korea': 'kp', Oman: 'om',
  'Papua New Guinea': 'pg', Philippines: 'ph', Qatar: 'qa', 'Saudi Arabia': 'sa', Singapore: 'sg', 'South Korea': 'kr',
  'Sri Lanka': 'lk', Syria: 'sy', Tajikistan: 'tj', 'Timor-Leste': 'tl',
  'United Arab Emirates': 'ae', Uzbekistan: 'uz', Albania: 'al', Belarus: 'by', 'Bosnia and Herzegovina': 'ba',
  Croatia: 'hr', Czechia: 'cz', Liechtenstein: 'li', Malta: 'mt', Montenegro: 'me', 'North Macedonia': 'mk',
  Portugal: 'pt', Slovakia: 'sk', Slovenia: 'si', 'United Kingdom': 'gb', Australia: 'au',
  Kiribati: 'ki', 'Marshall Islands': 'mh', Micronesia: 'fm', Nauru: 'nr', 'New Zealand': 'nz', Samoa: 'ws',
  'Solomon Islands': 'sb', Tonga: 'to', Tuvalu: 'tv', Vanuatu: 'vu',
  // Sovereign state previously missing. Bhutan/Fiji/Serbia stay out on purpose:
  // their drawn coats of arms cost 103 KB for 7 rounds (14.8 KB/round vs 0.4).
  Greece: 'gr',
  // US states — a second daily category, so five rounds are not five more countries.
  Alabama: 'us-al', Alaska: 'us-ak', Arizona: 'us-az', Colorado: 'us-co', Hawaii: 'us-hi',
  Maryland: 'us-md', Minnesota: 'us-mn', 'New Mexico': 'us-nm', Ohio: 'us-oh', Tennessee: 'us-tn',
  Texas: 'us-tx', Utah: 'us-ut',
  Scotland: 'gb-sct',
  Palestine: 'ps', Taiwan: 'tw', 'Western Sahara': 'eh',
  'Aland Islands': 'ax', Anguilla: 'ai', Antarctica: 'aq', Aruba: 'aw', 'Caribbean Netherlands': 'bq',
  'Christmas Island': 'cx', 'Curacao': 'cw', 'Faroe Islands': 'fo', 'French Guiana': 'gf',
  'French Southern and Antarctic Lands': 'tf', Gibraltar: 'gi', Greenland: 'gl', Guernsey: 'gg',
  'Hong Kong': 'hk', Macau: 'mo', Martinique: 'mq', Niue: 'nu', 'Reunion': 're', Tokelau: 'tk',
  'Wallis and Futuna': 'wf',
  'European Union': 'eu',
};

const NAMED = { white: 'FFFFFF', black: '000000', red: 'FF0000', green: '008000', blue: '0000FF', yellow: 'FFFF00', gray: '808080', grey: '808080', silver: 'C0C0C0' };

function canon(v) {
  v = v.trim().toLowerCase();
  if (v === 'none' || v === 'transparent' || v.startsWith('url(')) return null;
  if (NAMED[v]) return '#' + NAMED[v];
  let m = v.match(/^#([0-9a-f]{3})$/);
  if (m) { const c = m[1]; return ('#' + c[0] + c[0] + c[1] + c[1] + c[2] + c[2]).toUpperCase(); }
  m = v.match(/^#([0-9a-f]{6})$/);
  if (m) return ('#' + m[1]).toUpperCase();
  m = v.match(/^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('').toUpperCase();
  return null;
}

function normalize(svg) {
  // canonicalize fill/stroke attributes and style declarations
  svg = svg.replace(/(fill|stroke)="([^"]*)"/gi, (all, k, val) => { const c = canon(val); return c ? `${k}="${c}"` : all; });
  svg = svg.replace(/(fill|stroke)\s*:\s*([^;"'}]+)/gi, (all, k, val) => { const c = canon(val); return c ? `${k}:${c}` : all; });
  // some source SVGs carry a presentation-attribute fill AND a style="fill:..." on the
  // same element — style always wins at render, so the attribute is dead paint that
  // still gets picked up as a real colour by palette()/ownership(). Drop it.
  svg = svg.replace(/<([a-zA-Z][\w-]*)\s([^>]*)>/g, (tag, name, attrs) => {
    if (/\sfill="#[0-9A-F]{6}"/.test(' ' + attrs) && /\sstyle="[^"]*\bfill\s*:/.test(' ' + attrs)) {
      attrs = attrs.replace(/\s*\bfill="#[0-9A-F]{6}"/, '');
    }
    return `<${name} ${attrs}>`;
  });
  // ensure a viewBox so we can drop fixed width/height and let CSS size it
  const w = svg.match(/<svg[^>]*\bwidth="([\d.]+)"/i);
  const h = svg.match(/<svg[^>]*\bheight="([\d.]+)"/i);
  if (!/viewBox=/i.test(svg) && w && h) svg = svg.replace(/<svg/i, `<svg viewBox="0 0 ${w[1]} ${h[1]}"`);
  svg = svg.replace(/(<svg[^>]*?)\swidth="[\d.]+"/i, '$1').replace(/(<svg[^>]*?)\sheight="[\d.]+"/i, '$1');
  return svg.replace(/>\s+</g, '><').replace(/\s{2,}/g, ' ').trim();
}

// Prefix every id (and its href/url references) with the country code so that
// multiple flags inlined on one page (gallery, splash ring) never collide on `id="a"`.
function nsIds(svg, code) {
  const ids = new Set();
  for (const m of svg.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  for (const id of ids) {
    const nu = `${code}-${id}`;
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    svg = svg.replace(new RegExp(`\\bid="${esc}"`, 'g'), `id="${nu}"`)
      .replace(new RegExp(`href="#${esc}"`, 'g'), `href="#${nu}"`)
      .replace(new RegExp(`url\\(#${esc}\\)`, 'g'), `url(#${nu})`);
  }
  return svg;
}

function palette(svg: string): string[] {
  const set = new Set<string>();
  for (const m of svg.matchAll(/(?:fill|stroke)[=:]"?(#[0-9A-F]{6})/g)) set.add(m[1]!);
  return [...set];
}

// Germany's black stripe and Belgium's black band are drawn with no fill attribute
// at all — SVG's default paint is black, so they render fine but never show up in
// the palette, and the colour is unplayable. Spell that black out. Only touched
// where nothing can be inheriting a colour instead (no painted <g>, no root fill,
// no defs) and only on shapes with no paint of their own; the result is compared
// pixel-for-pixel against the original and thrown away if anything moved.
const SHAPES = new Set(['path', 'rect', 'polygon', 'polyline', 'circle', 'ellipse']);

function explicitDefaultBlack(svg: string): string {
  const openTag = svg.match(/^<svg[^>]*>/)?.[0] ?? '';
  if (/<defs/i.test(svg) || /\sfill=/.test(openTag) || /<g[^>]*\sfill=/.test(svg)) return svg;
  const els = enumerateElements(svg);
  let out = svg;
  let changed = false;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i]!;
    if (!SHAPES.has(el.tag) || /\s(fill|stroke)[=:]/.test(el.attrs) || /style="[^"]*\b(fill|stroke)\s*:/.test(el.attrs)) continue;
    out = out.slice(0, el.start) + `<${el.tag} fill="#000000"${el.attrs}` + out.slice(el.start + 1 + el.tag.length + el.attrs.length);
    changed = true;
  }
  if (!changed) return svg;
  return renderHash(out) === renderHash(svg) ? out : svg;
}

function renderHash(svg: string): string {
  return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 160 } }).render().pixels).toString('base64');
}

// ── per-element visible area ───────────────────────────────────────────────────
//
// One render answers "how much of the flag does each element actually show?".
// Every explicit fill/stroke is swapped for a colour that encodes the element's
// index, so occlusion is handled by the renderer: a shape covered by the one above
// it simply loses those pixels. Elements with no paint of their own keep whatever
// they inherit, which is what they render as anyway.

const MEASURE_W = 320;

function labelHex(i: number): string {
  const r = 8 + (i % 31) * 8, g = 8 + (Math.floor(i / 31) % 31) * 8, b = 8 + Math.floor(i / 961) * 8;
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function labelledSvg(svg: string): string {
  const els = enumerateElements(svg);
  let out = svg;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i]!;
    const lab = labelHex(i);
    const tag = out.slice(el.start, el.end)
      .replace(/(fill|stroke)="#[0-9A-F]{6}"/gi, `$1="${lab}"`)
      .replace(/(fill|stroke)\s*:\s*#[0-9A-F]{6}/gi, `$1:${lab}`);
    out = out.slice(0, el.start) + tag + out.slice(el.end);
  }
  return out;
}

// Fraction of the flag's opaque pixels each element index ends up owning.
function elementAreas(svg: string): number[] {
  const n = enumerateElements(svg).length;
  const png = new Resvg(labelledSvg(svg), { fitTo: { mode: 'width', value: MEASURE_W } }).render();
  const { pixels, width, height } = png;
  const byLabel = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (pixels[o + 3]! < 128) continue;
    total++;
    const r = pixels[o]!, g = pixels[o + 1]!, b = pixels[o + 2]!;
    // exact label hits only — antialiased blends fall between codes and are skipped
    if (r % 8 !== 0 || g % 8 !== 0 || b % 8 !== 0 || r === 0 || g === 0 || b === 0) continue;
    const idx = (r / 8 - 1) + (g / 8 - 1) * 31 + (b / 8 - 1) * 961;
    byLabel.set(idx, (byLabel.get(idx) ?? 0) + 1);
  }
  const areas = new Array<number>(n).fill(0);
  if (!total) return areas;
  for (const [idx, count] of byLabel) if (idx >= 0 && idx < n) areas[idx] = count / total;
  return areas;
}

// ── crest rule ────────────────────────────────────────────────────────────────
//
// A hex swap cannot tell a tricolour band from a crest detail painted the same red,
// so ownership is decided here instead. Measured against every shipped flag: at or
// above 6% of the flag an element is a region whatever its outline; below 0.8% it is
// filigree whatever its outline; in between, straight-edged and few-sided wins —
// which keeps bands, crosses, saltires, chevrons, triangles and stars, and rejects
// curves and <use> repeats.

const REGION_AREA = 0.06;
const FILIGREE_AREA = 0.008;
const MAX_VERTS = 16;

function straightAndSimple(tag: string, attrs: string): boolean {
  if (tag === 'rect') return !/\br[xy]=/.test(attrs);
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (attrs.match(/points="([^"]*)"/) || [])[1] || '';
    return pts.trim().split(/[\s,]+/).length / 2 <= MAX_VERTS;
  }
  if (tag !== 'path') return false; // circle/ellipse/use/g → not a plain shape
  const d = (attrs.match(/\bd="([^"]*)"/) || [])[1] || '';
  if (/[CcSsQqTtAa]/.test(d)) return false;
  return (d.match(/[MmLlHhVv]/g) || []).length <= MAX_VERTS;
}

// Nearest-palette-colour pixel tally. Only used for the handful of flags whose
// paint lives in a <style> class, where no element can be held responsible.
function legacyCoverage(svg: string, pal: string[]): Record<string, number> {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 160 } }).render();
  const { pixels, width, height } = png;
  const rgb = pal.map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
  const tally = new Array(pal.length).fill(0);
  let total = 0;
  for (let i = 0; i < width * height; i++) {
    const a = pixels[i * 4 + 3]!;
    if (a < 128) continue;
    total++;
    const r = pixels[i * 4]!, g = pixels[i * 4 + 1]!, b = pixels[i * 4 + 2]!;
    let best = 0, bd = Infinity;
    for (let k = 0; k < rgb.length; k++) {
      const d = (r - rgb[k]![0]!) ** 2 + (g - rgb[k]![1]!) ** 2 + (b - rgb[k]![2]!) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    tally[best]++;
  }
  const cov: Record<string, number> = {};
  pal.forEach((h, k) => { cov[h] = total ? tally[k] / total : 0; });
  return cov;
}

type Owned = { idx: number[]; coverage: number; scoped: boolean };

// What stays behind must read as a crest, not as a peer of what changed: if the
// leftover paint is more than a quarter of the playable area the colour is not
// cleanly a region (New Zealand's red is two Union Jack crosses plus four stars —
// recolour the crosses alone and the stars look like a bug), so the region goes.
const LEFTOVER_RATIO = 0.25;

function ownership(svg: string, hex: string, areas: number[]): Owned {
  const els = enumerateElements(svg);
  const candidates = elementsWithColor(svg, hex);
  const keep: number[] = [];
  for (const i of candidates) {
    const a = areas[i] ?? 0;
    const el = els[i]!;
    if (a >= REGION_AREA) keep.push(i);
    else if (a < FILIGREE_AREA) continue;
    else if (straightAndSimple(el.tag, el.attrs)) keep.push(i);
  }
  const kept = keep.reduce((s, i) => s + (areas[i] ?? 0), 0);
  const dropped = candidates.reduce((s, i) => s + (areas[i] ?? 0), 0) - kept;
  if (kept === 0 || dropped > kept * LEFTOVER_RATIO) return { idx: [], coverage: 0, scoped: false };
  return { idx: keep, coverage: +kept.toFixed(3), scoped: keep.length !== candidates.length };
}

type Region = { hex: string; coverage: number; idx?: number[] };
type Flag = { name: string; code: string; svg: string; hideable: Region[] };

// FLAGS_ONLY=Slovakia,Iraq — dry-run a few flags while tuning the crest rule.
// Nothing is written unless the whole set is built.
const only = process.env.FLAGS_ONLY ? new Set(process.env.FLAGS_ONLY.split(',')) : null;
const names = (Object.keys(CODES) as (keyof typeof CODES)[]).filter(n => !only || only.has(n));
const out: Flag[] = [];
const problems: string[] = [];
let splitCount = 0, dropCount = 0;
for (const name of names) {
  const code = CODES[name];
  try {
    const res = await fetch(`https://flagcdn.com/${code}.svg`);
    if (!res.ok) { problems.push(`${name} (${code}): HTTP ${res.status}`); continue; }
    let svg = await res.text();
    if (/<image|xlink:href|linearGradient|radialGradient/i.test(svg)) problems.push(`${name} (${code}): has image/gradient`);
    svg = explicitDefaultBlack(nsIds(normalize(svg), code));
    if (Buffer.byteLength(svg) > 50000) { problems.push(`${name} (${code}): SKIPPED — ${(Buffer.byteLength(svg) / 1024).toFixed(0)}KB (detailed crest)`); continue; }
    const pal = palette(svg);
    const areas = elementAreas(svg);
    // A colour that lives only in a <style> class can't be traced to an element, so
    // ownership can't be decided — those flags keep the whole-hex behaviour.
    const styled = /<style[\s\S]*?(fill|stroke)\s*:\s*#[0-9A-F]{6}/i.test(svg);

    const measured = pal.map(hex => {
      if (styled) return { hex, coverage: 0, idx: [] as number[], scoped: false, styled: true };
      return { hex, ...ownership(svg, hex, areas), styled: false };
    });
    if (styled) {
      // fall back to nearest-colour pixel tally, as before
      const cov = legacyCoverage(svg, pal);
      for (const m of measured) m.coverage = +cov[m.hex]!.toFixed(3);
    } else {
      for (const m of measured) if (m.idx.length === 0) dropCount++;
    }

    const hideable: Region[] = measured
      .filter(r => r.styled || r.idx.length > 0)
      .map(r => (r.scoped ? { hex: r.hex, coverage: r.coverage, idx: r.idx } : { hex: r.hex, coverage: r.coverage }))
      .filter(r => r.coverage >= 0.08)
      .sort((a, b) => b.coverage - a.coverage);
    splitCount += hideable.filter(r => r.idx).length;
    if (hideable.length === 0) {
      const top = measured.filter(r => r.styled || r.idx.length > 0).sort((a, b) => b.coverage - a.coverage)[0];
      if (top) hideable.push(top.scoped ? { hex: top.hex, coverage: top.coverage, idx: top.idx } : { hex: top.hex, coverage: top.coverage });
    }
    if (hideable.length === 0) { problems.push(`${name} (${code}): SKIPPED — no playable region`); continue; }
    out.push({ name, code, svg, hideable });
    process.stdout.write('.');
  } catch (e) { problems.push(`${name} (${code}): ${(e as Error).message}`); }
}
process.stdout.write('\n');

if (only) {
  for (const f of out) {
    console.log(`\n${f.name} (${f.code}) — ${(Buffer.byteLength(f.svg) / 1024).toFixed(1)} KB, ${enumerateElements(f.svg).length} elements`);
    const areas = elementAreas(f.svg);
    for (const r of f.hideable) {
      const all = elementsWithColor(f.svg, r.hex);
      const left = all.reduce((s, i) => s + (areas[i] ?? 0), 0) - r.coverage;
      console.log(`   ${r.hex}  ${(r.coverage * 100).toFixed(1).padStart(5)}%  ${r.idx ? `owns ${r.idx.length}/${all.length} [${r.idx.join(',')}], leftover ${(left * 100).toFixed(2)}% (${(left / r.coverage * 100).toFixed(0)}% of region)` : 'whole hex'}`);
    }
  }
  console.log(`\n(dry run — ${dropCount} regions dropped as emblem-only, nothing written)`);
  if (problems.length) console.log(`\nPROBLEMS:\n` + problems.join('\n'));
  process.exit(0);
}

const body = out.map(f => `  ${JSON.stringify(f)},`).join('\n');
const ts = `// AUTO-GENERATED by scripts/build-flags.ts — do not edit by hand.
// Official flag SVGs (flagcdn, public domain), colours normalized, per-element
// visible area measured. \`idx\` lists the element positions a region owns — absent
// means the whole hex is fair game; present means the rest of that colour (a crest,
// an ornament) must keep its paint.
export type FlagRegion = { hex: string; coverage: number; idx?: number[] };
export type FlagData = { name: string; code: string; svg: string; hideable: FlagRegion[] };
export const FLAGS_DATA: FlagData[] = [
${body}
];
`;
// run from the repo root via npm run flags (the bundle lives in node_modules/.cache)
writeFileSync('src/shared/flags-data.ts', ts);

const bytes = Buffer.byteLength(ts);
const regions = out.reduce((s, f) => s + f.hideable.length, 0);
console.log(`\nwrote src/shared/flags-data.ts — ${out.length} flags, ${(bytes / 1024).toFixed(0)} KB`);
console.log(`regions: ${regions} total, ${splitCount} scoped to specific elements, ${dropCount} dropped as emblem-only`);
console.log(`avg hideable regions: ${(regions / out.length).toFixed(1)}`);
const big = out.map(f => [f.name, f.svg.length] as const).sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('largest svgs:', big.map(([n, s]) => `${n}:${(s / 1024).toFixed(1)}k`).join(', '));
if (problems.length) console.log(`\nPROBLEM FLAGS (${problems.length}):\n` + problems.join('\n'));

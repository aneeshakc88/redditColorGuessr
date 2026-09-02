// Element-level addressing for flag SVGs, shared by the build script and the game
// so both agree on what "element 7" means. A region owns a list of these indices;
// recolouring by index is what keeps a coat of arms from repainting when the band
// beside it shares its hex.

export type SvgElement = { tag: string; start: number; end: number; attrs: string };

const TAG_RE = /<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)\s*\/?>/g;

// Every element in document order, <svg> included, defs contents included.
// Index into this array is the stable address stored in FlagRegion.idx.
export function enumerateElements(svg: string): SvgElement[] {
  const out: SvgElement[] = [];
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(svg))) {
    out.push({ tag: m[1]!, start: m.index, end: m.index + m[0]!.length, attrs: m[2]! });
  }
  return out;
}

function paints(attrs: string, hex: string): boolean {
  return (
    attrs.includes(`fill="${hex}"`) ||
    attrs.includes(`stroke="${hex}"`) ||
    attrs.includes(`fill:${hex}`) ||
    attrs.includes(`stroke:${hex}`)
  );
}

// Indices of every element whose own fill/stroke is this exact colour.
export function elementsWithColor(svg: string, hex: string): number[] {
  const target = hex.toUpperCase();
  const out: number[] = [];
  enumerateElements(svg).forEach((el, i) => { if (paints(el.attrs, target)) out.push(i); });
  return out;
}

function rewrite(attrs: string, from: string, to: string): string {
  return attrs
    .split(`fill="${from}"`).join(`fill="${to}"`)
    .split(`stroke="${from}"`).join(`stroke="${to}"`)
    .split(`fill:${from}`).join(`fill:${to}`)
    .split(`stroke:${from}`).join(`stroke:${to}`);
}

// Repaint `from` → `to`, but only inside the listed elements. Walks backwards so
// earlier offsets stay valid as later tags change length.
export function recolorElements(svg: string, idx: number[], from: string, to: string): string {
  const target = from.toUpperCase();
  const els = enumerateElements(svg);
  let out = svg;
  for (const i of [...idx].sort((a, b) => b - a)) {
    const el = els[i];
    if (!el) continue;
    const tag = out.slice(el.start, el.end);
    out = out.slice(0, el.start) + rewrite(tag, target, to) + out.slice(el.end);
  }
  return out;
}

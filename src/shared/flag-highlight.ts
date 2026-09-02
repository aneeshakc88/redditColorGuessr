// Flag SVG recolor + region-outline helpers, shared by the game (flag.tsx) and the
// dev highlight gallery so both render regions identically (no drift).
import { recolorElements } from './flag-elements';

// Replace the hidden region's colour with the guess colour. SVG colours are
// canonical #RRRRRR uppercase (baked by the build), so an exact string swap targets
// exactly that region. When the region owns only part of that colour — a tricolour
// band whose hex is also used inside the coat of arms — `idx` names the elements the
// swap is allowed to touch and the crest keeps its paint.
export function swapRegion(svg: string, hiddenHex: string, swapHex: string, idx?: number[]): string {
  const to = swapHex.toUpperCase();
  if (to === hiddenHex.toUpperCase()) return svg;
  if (idx) return recolorElements(svg, idx, hiddenHex, to);
  return svg.split(hiddenHex.toUpperCase()).join(to);
}

// Parsed viewBox (any origin — several flags centre on 0,0 with negative min).
function parseViewBox(svg: string): { x: number; y: number; w: number; h: number } | null {
  const m = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/);
  if (!m) return null;
  const x = +m[1]!, y = +m[2]!, w = +m[3]!, h = +m[4]!;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

// True aspect ratio from the flag's viewBox — so 2:1 flags aren't stretched to fit.
export function viewBoxRatio(svg: string): number {
  const vb = parseViewBox(svg);
  return vb ? vb.w / vb.h : 1.5;
}

// ── Marching-ants outline ──────────────────────────────────────────────────────
//
// The outline is computed from the ORIGINAL svg + hidden hex (never the guess-
// swapped one), returned as overlay markup, and stamped onto whatever recolour is
// currently displayed via applyOverlay. This keeps the ring stable when the guess
// colour happens to equal another region's colour, and the overlay is pure <path>
// markup — no ids, so any number can coexist on one page (the gallery).
//
// Two renderers produce the overlay:
//  • regionOutline — sync, exact geometry for axis-aligned (rectilinear) flags:
//    tricolours, bands, Nordic crosses. Returns null when the flag has curves.
//  • regionOutlineRaster — async, for everything else: renders a black/white
//    silhouette of the region, traces the pixel boundary (marching squares
//    flavour), simplifies, and emits the same ants paths. Needs a rasterizer
//    (canvas in the browser, resvg in node) injected by the caller.

export function regionOutline(svg: string, hex: string, idx?: number[]): string | null {
  const target = hex.toUpperCase();
  if (!svg.toUpperCase().includes(target)) return ''; // hex absent → no outline
  // A crest-scoped region is never a plain tricolour — hand it straight to the
  // raster tracer rather than teaching the geometry parser about element indices.
  if (idx) return null;
  return highlightRectilinear(svg, target);
}

export function applyOverlay(svg: string, overlay: string | null): string {
  return overlay ? svg.replace('</svg>', overlay + '</svg>') : svg;
}

// ── Geometry path: exact outline for axis-aligned (rectilinear) flags ──────────

type Ring = [number, number][];
type Shape = { rings: Ring[]; hex: string };

// Parse every drawable shape into axis-aligned polygon rings. Returns null the moment
// a shape has a curve, arc, or off-axis edge (circle, star, diagonal, <use>, group) —
// the caller then falls back to the raster renderer. Handles rectangles, Nordic/plus
// crosses, L-shapes and any other Manhattan polygon.
function parseShapes(svg: string, vb: { x: number; y: number; w: number; h: number }): Shape[] | null {
  const openTag = svg.match(/^<svg[^>]*>/)?.[0] ?? '';
  let inner = svg.slice(openTag.length, svg.lastIndexOf('</svg>'));
  inner = inner.replace(/<defs[\s\S]*?<\/defs>/g, '');
  if (/<svg[^>]*\sfill=/.test(openTag)) return null; // inherited root paint → bail

  const shapes: Shape[] = [];
  const tagRe = /<(\w+)([^>]*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(inner))) {
    const tag = m[1]!, attrs = m[2]!;
    if (tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'g') {
      if (tag === 'g' && /transform|clip-path|mask/.test(attrs)) return null;
      continue;
    }
    const fill = (attrs.match(/fill="([^"]*)"/) || [])[1];
    if (fill === 'none') continue;
    const hex = (fill || '#000000').toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) return null;

    if (tag === 'rect') {
      const x = num(attrs, 'x') ?? 0, y = num(attrs, 'y') ?? 0;
      const w = num(attrs, 'width'), h = num(attrs, 'height');
      if (w == null || h == null || attrs.includes('rx') || attrs.includes('ry')) return null;
      shapes.push({ rings: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]], hex });
    } else if (tag === 'path') {
      const d = (attrs.match(/\bd="([^"]*)"/) || [])[1] || '';
      const strokeM = attrs.match(/stroke="([^"]*)"/);
      const stroke = strokeM && strokeM[1] !== 'none' ? strokeM[1]!.toUpperCase() : null;
      if (stroke && (!fill || fill === 'none')) {
        // Stroked cross (Denmark, Sweden, England…): expand each axis-aligned segment
        // into a filled rect of the stroke width.
        if (!/^#[0-9A-F]{6}$/.test(stroke)) return null;
        const rings = rectilinearRings(d);
        if (!rings) return null;
        const sw = num(attrs, 'stroke-width') ?? 1;
        for (const ring of rings) {
          for (let k = 0; k + 1 < ring.length; k++) {
            const [x1, y1] = ring[k]!, [x2, y2] = ring[k + 1]!;
            const half = sw / 2;
            const [rx, ry, rw, rh] = y1 === y2
              ? [Math.min(x1, x2), y1 - half, Math.abs(x2 - x1), sw]
              : [x1 - half, Math.min(y1, y2), sw, Math.abs(y2 - y1)];
            if (rw > 0 && rh > 0) shapes.push({ rings: [[[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]]], hex: stroke });
          }
        }
        continue;
      }
      const rings = rectilinearRings(d);
      if (!rings) return null;
      shapes.push({ rings, hex });
    } else {
      return null; // circle/polygon/line/use/etc → bail
    }
  }
  if (shapes.length === 0) return null;
  shapes.unshift({ rings: [[[vb.x, vb.y], [vb.x + vb.w, vb.y], [vb.x + vb.w, vb.y + vb.h], [vb.x, vb.y + vb.h]]], hex: '#______' });
  return shapes;
}

function num(attrs: string, name: string): number | null {
  const m = attrs.match(new RegExp(`\\b${name}="([-\\d.]+)"`));
  return m ? +m[1]! : null;
}

// Walk a path; return its rings (one per subpath) iff every edge is axis-aligned.
// Any curve/arc/diagonal command → null.
function rectilinearRings(d: string): Ring[] | null {
  const toks = d.trim().match(/[a-zA-Z]|-?[\d.]+/g);
  if (!toks) return null;
  let x = 0, y = 0, sx = 0, sy = 0, cmd = '', i = 0;
  const rings: Ring[] = [];
  let cur: Ring = [];
  const rd = () => { const v = toks[i++]; return v == null ? NaN : +v; };
  const push = () => { if (cur.length) rings.push(cur); cur = []; };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i]!)) cmd = toks[i++]!;
    switch (cmd) {
      case 'M': push(); x = rd(); y = rd(); sx = x; sy = y; cur.push([x, y]); cmd = 'L'; break;
      case 'm': push(); x += rd(); y += rd(); sx = x; sy = y; cur.push([x, y]); cmd = 'l'; break;
      case 'H': x = rd(); cur.push([x, y]); break;
      case 'h': x += rd(); cur.push([x, y]); break;
      case 'V': y = rd(); cur.push([x, y]); break;
      case 'v': y += rd(); cur.push([x, y]); break;
      case 'L': { const nx = rd(), ny = rd(); if (nx !== x && ny !== y) return null; x = nx; y = ny; cur.push([x, y]); break; }
      case 'l': { const dx = rd(), dy = rd(); if (dx !== 0 && dy !== 0) return null; x += dx; y += dy; cur.push([x, y]); break; }
      case 'Z': case 'z': x = sx; y = sy; break;
      default: return null;
    }
    if (Number.isNaN(x) || Number.isNaN(y)) return null;
  }
  push();
  return rings.length ? rings : null;
}

// Even-odd point membership across a shape's rings (handles disjoint rects + holes).
function inShape(sh: Shape, px: number, py: number): boolean {
  let inside = false;
  for (const ring of sh.rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [xi, yi] = ring[a]!, [xj, yj] = ring[b]!;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function highlightRectilinear(svg: string, target: string): string | null {
  const vb = parseViewBox(svg);
  if (!vb) return null;
  const shapes = parseShapes(svg, vb);
  if (!shapes) return null;

  // Coordinate-compressed grid over every vertex → cells each uniformly one colour.
  const verts = shapes.flatMap(s => s.rings.flat());
  const xs = uniq(verts.map(v => v[0]).concat(vb.x, vb.x + vb.w));
  const ys = uniq(verts.map(v => v[1]).concat(vb.y, vb.y + vb.h));
  const nc = xs.length - 1, nr = ys.length - 1;
  if (nc <= 0 || nr <= 0 || nc * nr > 20000) return null;

  // vis[i][j] = is cell (column i, row j) painted the target colour on top?
  const vis: boolean[][] = [];
  let any = false;
  for (let i = 0; i < nc; i++) {
    vis[i] = [];
    const cx = (xs[i]! + xs[i + 1]!) / 2;
    for (let j = 0; j < nr; j++) {
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      let hex = '';
      for (const s of shapes) if (inShape(s, cx, cy)) hex = s.hex;
      vis[i]![j] = hex === target;
      if (vis[i]![j]) any = true;
    }
  }
  if (!any) return null; // target fully covered / absent → let raster try

  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= nc || j >= nr ? false : vis[i]![j]!);

  // Boundary edges: a grid line segment where the target region meets non-target
  // (or the flag border). Collect, then merge collinear runs into long dashes.
  const vSegs: [number, number, number][] = []; // x, y0, y1
  for (let i = 0; i <= nc; i++) {
    for (let j = 0; j < nr; j++) {
      if (at(i - 1, j) !== at(i, j)) vSegs.push([xs[i]!, ys[j]!, ys[j + 1]!]);
    }
  }
  const hSegs: [number, number, number][] = []; // y, x0, x1
  for (let j = 0; j <= nr; j++) {
    for (let i = 0; i < nc; i++) {
      if (at(i, j - 1) !== at(i, j)) hSegs.push([ys[j]!, xs[i]!, xs[i + 1]!]);
    }
  }

  let d = '';
  for (const [x, a, b] of mergeRuns(vSegs)) d += `M${f(x)} ${f(a)}V${f(b)}`;
  for (const [y, a, b] of mergeRuns(hSegs)) d += `M${f(a)} ${f(y)}H${f(b)}`;
  if (!d) return null;

  return antsPaths(d, Math.max(vb.w, vb.h));
}

// Merge segments that share a line and touch end-to-end into single spans.
function mergeRuns(segs: [number, number, number][]): [number, number, number][] {
  const byLine = new Map<number, [number, number][]>();
  for (const [line, a, b] of segs) {
    const arr = byLine.get(line) ?? [];
    arr.push([a, b]);
    byLine.set(line, arr);
  }
  const out: [number, number, number][] = [];
  for (const [line, spans] of byLine) {
    spans.sort((p, q) => p[0] - q[0]);
    let [ca, cb] = spans[0]!;
    for (let k = 1; k < spans.length; k++) {
      const [a, b] = spans[k]!;
      if (a <= cb + 1e-6) cb = Math.max(cb, b);
      else { out.push([line, ca, cb]); [ca, cb] = [a, b]; }
    }
    out.push([line, ca, cb]);
  }
  return out;
}

// Two coincident dashed strokes (dark base + offset white) animated for marching ants.
function antsPaths(d: string, S: number): string {
  const sw = (S / 130).toFixed(2);
  const dash = (S / 45).toFixed(2);
  return (
    `<path d="${d}" fill="none" stroke="#111" stroke-width="${sw}" stroke-dasharray="${dash} ${dash}"/>` +
    `<path d="${d}" fill="none" stroke="#fff" stroke-width="${sw}" stroke-dasharray="${dash} ${dash}" stroke-dashoffset="${dash}">` +
      `<animate attributeName="stroke-dashoffset" from="${(+dash * 2).toFixed(2)}" to="0" dur="0.55s" repeatCount="indefinite"/>` +
    `</path>`
  );
}

function uniq(a: number[]): number[] {
  return [...new Set(a.map(v => +v.toFixed(4)))].sort((p, q) => p - q);
}
function f(n: number): string {
  return (+n.toFixed(3)).toString();
}

// ── Raster path: traced outline for non-rectilinear flags ──────────────────────
//
// Render a silhouette (target region white, everything else black — shapes on top
// occlude in document order), threshold to a bit mask, morphologically close
// hairline gaps (chakra spokes, ornament lace) so the ring stays readable, trace
// the boundary of every remaining component and hole, simplify, and stroke it
// with the same ants paths as the geometry renderer.

export type Raster = { data: Uint8Array | Uint8ClampedArray; width: number; height: number };
export type Rasterize = (svg: string, width: number) => Promise<Raster>;

const RASTER_W = 512;

export async function regionOutlineRaster(svg: string, hex: string, rasterize: Rasterize, idx?: number[]): Promise<string> {
  const target = hex.toUpperCase();
  if (!svg.toUpperCase().includes(target)) return '';
  const vb = parseViewBox(svg) ?? { x: 0, y: 0, w: 3, h: 2 };

  const { data, width: W, height: H } = await rasterize(buildSilhouette(svg, target, vb, idx), RASTER_W);
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    mask[i] = data[o]! > 200 && data[o + 1]! > 200 && data[o + 2]! > 200 ? 1 : 0;
  }
  closeMask(mask, W, H, Math.max(2, Math.round(W / 170)));

  const minArea = W * H * 0.001; // drop antialias specks and sub-visible holes
  const sx = vb.w / W, sy = vb.h / H;
  let d = '';
  for (const loop of traceLoops(mask, W, H)) {
    if (Math.abs(loopArea(loop)) < minArea) continue;
    const pts = simplifyLoop(loop, 1.35);
    if (pts.length < 3) continue;
    d += 'M' + pts.map(([x, y]) => `${f(vb.x + x * sx)} ${f(vb.y + y * sy)}`).join('L') + 'Z';
  }
  return d ? antsPaths(d, Math.max(vb.w, vb.h)) : '';
}

// Target-coloured paint → white, all other hex paint → black, on a black canvas.
// With `idx`, only the elements the region owns are whitened, so the ring traces the
// band and not the identically-coloured filigree beside it.
const MARK = '@@T@@';

function buildSilhouette(svg: string, target: string, vb: { x: number; y: number; w: number; h: number }, idx?: number[]): string {
  if (idx) svg = recolorElements(svg, idx, target, MARK);
  const openTag = svg.match(/^<svg[^>]*>/)?.[0] ?? `<svg viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">`;
  const inner = svg.slice(openTag.length, svg.lastIndexOf('</svg>'));
  const rootFill = (openTag.match(/\sfill="([^"]*)"/) || [])[1] || '#000000';
  const rootStroke = (openTag.match(/\sstroke="([^"]*)"/) || [])[1] || 'none';
  let sil = `<g fill="${rootFill}" stroke="${rootStroke}">${inner}</g>`;
  if (!idx) sil = sil.split(target).join(MARK); // scoped regions are already marked
  sil = sil.replace(/(fill|stroke)="#[0-9A-Fa-f]{6}"/g, '$1="#000000"');
  sil = sil.split(MARK).join('#FFFFFF');
  return `${openTag}<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="#000000"/>${sil}</svg>`;
}

// Morphological close (dilate then erode, square window) — fills gaps < ~2r px.
function closeMask(mask: Uint8Array, W: number, H: number, r: number): void {
  morph(mask, W, H, r, 1);
  morph(mask, W, H, r, 0);
}

function morph(mask: Uint8Array, W: number, H: number, r: number, val: number): void {
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let v = 1 - val;
      for (let k = Math.max(0, x - r), e = Math.min(W - 1, x + r); k <= e; k++) {
        if (mask[row + k] === val) { v = val; break; }
      }
      tmp[row + x] = v;
    }
  }
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = 1 - val;
      for (let k = Math.max(0, y - r), e = Math.min(H - 1, y + r); k <= e; k++) {
        if (tmp[k * W + x] === val) { v = val; break; }
      }
      mask[y * W + x] = v;
    }
  }
}

// Chain the pixel-boundary edges of the mask into closed loops (outer contours and
// holes alike). At checkerboard corners the walk prefers the right turn, keeping
// diagonally-touching components as separate loops.
function traceLoops(mask: Uint8Array, W: number, H: number): Ring[] {
  const NK = W + 1;
  const edges = new Map<number, [number, number][]>();
  const add = (x1: number, y1: number, x2: number, y2: number) => {
    const k = y1 * NK + x1;
    const a = edges.get(k);
    if (a) a.push([x2, y2]); else edges.set(k, [[x2, y2]]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (y === 0 || !mask[(y - 1) * W + x]) add(x, y, x + 1, y);
      if (x === W - 1 || !mask[y * W + x + 1]) add(x + 1, y, x + 1, y + 1);
      if (y === H - 1 || !mask[(y + 1) * W + x]) add(x + 1, y + 1, x, y + 1);
      if (x === 0 || !mask[y * W + x - 1]) add(x, y + 1, x, y);
    }
  }
  const loops: Ring[] = [];
  for (const [k, outs] of edges) {
    while (outs.length) {
      const startX = k % NK, startY = (k / NK) | 0;
      let [cx, cy] = outs.pop()!;
      let px = startX, py = startY;
      const loop: Ring = [[startX, startY]];
      let guard = 8 * W * H;
      while ((cx !== startX || cy !== startY) && guard-- > 0) {
        loop.push([cx, cy]);
        const cands = edges.get(cy * NK + cx);
        if (!cands || cands.length === 0) { loop.length = 0; break; }
        let pick = 0;
        if (cands.length > 1) {
          const rx = -(cy - py), ry = cx - px; // incoming dir rotated right (y-down)
          const j = cands.findIndex(([ex, ey]) => ex - cx === rx && ey - cy === ry);
          if (j >= 0) pick = j;
        }
        const [ex, ey] = cands.splice(pick, 1)[0]!;
        px = cx; py = cy; cx = ex; cy = ey;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function loopArea(loop: Ring): number {
  let a = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    a += (loop[j]![0] + loop[i]![0]) * (loop[j]![1] - loop[i]![1]);
  }
  return a / 2;
}

// Collapse collinear runs, then Ramer-Douglas-Peucker so pixel stairs on curves
// and diagonals become clean polylines.
function simplifyLoop(loop: Ring, tol: number): Ring {
  const pts: Ring = [];
  for (let i = 0; i < loop.length; i++) {
    const p = loop[(i + loop.length - 1) % loop.length]!, c = loop[i]!, n = loop[(i + 1) % loop.length]!;
    if ((c[0] - p[0]) * (n[1] - c[1]) !== (c[1] - p[1]) * (n[0] - c[0])) pts.push(c);
  }
  if (pts.length <= 4) return pts;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i]![0] - pts[0]![0], dy = pts[i]![1] - pts[0]![1];
    const dist = dx * dx + dy * dy;
    if (dist > fd) { fd = dist; far = i; }
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp(pts.slice(far).concat([pts[0]!]), tol);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

function rdp(pts: Ring, tol: number): Ring {
  if (pts.length <= 2) return pts;
  const [x1, y1] = pts[0]!, [x2, y2] = pts[pts.length - 1]!;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const dist = Math.abs(dx * (y1 - pts[i]![1]) - dy * (x1 - pts[i]![0])) / len;
    if (dist > fd) { fd = dist; far = i; }
  }
  if (fd <= tol) return [pts[0]!, pts[pts.length - 1]!];
  return rdp(pts.slice(0, far + 1), tol).slice(0, -1).concat(rdp(pts.slice(far), tol));
}

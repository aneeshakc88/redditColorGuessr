// Card geometry for the splash flag ring, shared with scripts/gen-ring-preview.ts
// so the preview page renders exactly what the splash does.
//
// Flags ship 24 different aspect ratios (Nepal 0.82 → Qatar 4.17) but the ring
// needs every card the same width, or neighbours look like different sizes. So:
// each card is a fixed box with a mat, and the flag is fitted inside it —
// stretched only when its ratio is within FIT_TOLERANCE of the card's, matted
// otherwise. Uniform cards, no visible distortion.

export const RING_TILT = -7;    // rotateX
export const RING_ROLL = -18;   // rotateZ
export const CARD_BEND = 26;    // per-card convex arc, degrees
export const CARD_STRIPS = 12;  // slices used to fake the bend
export const RING_COPIES = 3;   // repeat the day's flags around the ring → dense band
export const RADIUS_PAD = -6;   // gap: slightly under the touching baseline → edge-to-edge
export const RING_CARD_W = 150; // card box at scale 1
export const RING_CARD_H = 98;

export const CARD_MAT = 'rgba(10,15,27,0.9)'; // frame behind the flag
export const CARD_FRAME = 0.045;              // frame width, share of card height
export const FIT_TOLERANCE = 1.1;             // ≤10% stretch reads as no distortion

export const ringRadius = (cardW: number, n: number, scale = 1) =>
  Math.max(12, Math.round((cardW / 2) / Math.tan(Math.PI / n)) + RADIUS_PAD * scale);

export const flagAspect = (svg: string): number => {
  const vb = /viewBox="([^"]+)"/.exec(svg);
  if (!vb) return RING_CARD_W / RING_CARD_H;
  const p = vb[1]!.trim().split(/[\s,]+/).map(Number);
  const w = p[2], h = p[3];
  return w && h && w > 0 && h > 0 ? w / h : RING_CARD_W / RING_CARD_H;
};

export type FlagFit = { w: number; h: number; x: number; y: number; matted: boolean };

/** Fits a flag inside a boxW×boxH card, leaving a frame. Letterboxes when the
 *  flag's ratio is too far from the card's to stretch unnoticed. */
export const fitFlag = (svg: string, boxW: number, boxH: number): FlagFit => {
  const pad = boxH * CARD_FRAME;
  const innerW = boxW - pad * 2, innerH = boxH - pad * 2;
  const ar = flagAspect(svg);
  const innerAr = innerW / innerH;
  const r = innerAr / ar;
  const fill = r <= FIT_TOLERANCE && r >= 1 / FIT_TOLERANCE;
  const w = fill ? innerW : ar > innerAr ? innerW : innerH * ar;
  const h = fill ? innerH : ar > innerAr ? innerW / ar : innerH;
  return { w, h, x: (boxW - w) / 2, y: (boxH - h) / 2, matted: !fill };
};

// How a flag is reconciled with the ring's need for cards of one size:
//   height    equal height, width follows the flag's real ratio. No distortion,
//             no frame, nothing cropped — the way flag sets are normally shown.
//   mat       one fixed card; near-ratio flags fill it, the rest sit on a frame.
//   stretch   one fixed card, every flag stretched to fill it.
//   letterbox one fixed card, flag scaled to fit inside with transparent margins
//             — the original behaviour, where neighbours differ in height.
export type FitMode = 'height' | 'mat' | 'stretch' | 'letterbox';
export const CARD_FIT_MODE: FitMode = 'height';

/** Ring slots are allocated by card width (see ringPlacement), so a wide flag takes
 *  a wider slot instead of losing height. Nothing is capped; the cap only came back
 *  as a shrink if a whole set can't fit, which no real set does. */
export const MIN_CARD_GAP = 2; // degrees of clear space between neighbouring cards

/** Bend radius of a nominal card — also the distance every card's surface sits in
 *  front of its own origin, so all surfaces end up the same distance from the axis. */
export const bendRadius = (scale = 1) =>
  (RING_CARD_W * scale / 2) / Math.tan((CARD_BEND / 2) * Math.PI / 180);

export type CardBox = {
  w: number; h: number;
  bend: number;   // wrap angle — CARD_BEND for every card, so curl looks the same
  bendR: number;  // radius that wraps this card's width through `bend` degrees
  zOffset: number;// pulls the card back so its surface lands on the shared cylinder
  bg: { w: number; h: number; x: number; y: number };
  mat: string | undefined;
  matted: boolean;
};

/** Angle a card of width w subtends at the ring axis, from where its surface sits. */
export const cardArc = (w: number, surfaceR: number) =>
  2 * Math.asin(Math.min(1, (w / 2) / surfaceR)) * 180 / Math.PI;

export type RingPlacement = { angles: number[]; gap: number; shrink: number };

/** Places cards around the ring with slots proportional to their widths, so a wide
 *  flag takes more of the circle rather than being squeezed to fit an equal slot.
 *  Gaps come out equal for every card. If a set is too wide for one turn of the
 *  ring (no real set is), every card shrinks until it fits. */
export const ringPlacement = (widths: number[], surfaceR: number, minGap = MIN_CARD_GAP): RingPlacement => {
  const n = widths.length;
  let shrink = 1;
  for (let pass = 0; pass < 6; pass++) {
    const total = widths.reduce((s, w) => s + cardArc(w * shrink, surfaceR), 0);
    if (total + n * minGap <= 360) break;
    shrink *= (360 - n * minGap) / total;
  }
  const arcs = widths.map(w => cardArc(w * shrink, surfaceR));
  const gap = (360 - arcs.reduce((s, a) => s + a, 0)) / n;
  const angles: number[] = [];
  let cursor = 0;
  for (const a of arcs) {
    angles.push(cursor + a / 2);
    cursor += a + gap;
  }
  return { angles, gap, shrink };
};

export const cardBox = (svg: string, scale = 1, mode: FitMode = CARD_FIT_MODE): CardBox => {
  const baseW = RING_CARD_W * scale, baseH = RING_CARD_H * scale;
  const nominalR = bendRadius(scale);

  // Every card wraps through the same angle, so a wide flag curves as gently as a
  // narrow one instead of curling into a tube. Its bend radius grows with its width,
  // and zOffset pulls it back so all surfaces still share one cylinder — otherwise
  // the wider card would bulge toward the camera and render bigger.
  const pose = (w: number) => {
    const bendR = (w / 2) / Math.tan((CARD_BEND / 2) * Math.PI / 180);
    return { bend: CARD_BEND, bendR, zOffset: nominalR - bendR };
  };

  if (mode === 'height') {
    const w = baseH * flagAspect(svg);
    return { w, h: baseH, ...pose(w), bg: { w, h: baseH, x: 0, y: 0 }, mat: undefined, matted: false };
  }
  if (mode === 'stretch') {
    return { w: baseW, h: baseH, ...pose(baseW), bg: { w: baseW, h: baseH, x: 0, y: 0 }, mat: undefined, matted: false };
  }
  if (mode === 'letterbox') {
    const ar = flagAspect(svg);
    const boxAr = baseW / baseH;
    const w = ar > boxAr ? baseW : baseH * ar;
    const h = ar > boxAr ? baseW / ar : baseH;
    return { w: baseW, h: baseH, ...pose(baseW), bg: { w, h, x: (baseW - w) / 2, y: (baseH - h) / 2 }, mat: undefined, matted: false };
  }
  const fit = fitFlag(svg, baseW, baseH);
  return { w: baseW, h: baseH, ...pose(baseW), bg: fit, mat: CARD_MAT, matted: fit.matted };
};

/** Data URI for a flag SVG. Sizing is controlled by the fit above, so the SVG is
 *  told not to letterbox itself — a duplicate attribute is a fatal XML parse
 *  error, so an existing one (Qatar) is replaced rather than added to. */
export const flagDataUri = (svg: string): string => {
  const norm = /preserveAspectRatio="[^"]*"/.test(svg)
    ? svg.replace(/preserveAspectRatio="[^"]*"/, 'preserveAspectRatio="none"')
    : svg.replace('<svg', '<svg preserveAspectRatio="none"');
  return `data:image/svg+xml,${encodeURIComponent(norm)}`;
};

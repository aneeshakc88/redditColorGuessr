import { describe, it, expect } from 'vitest';
import { FLAGS_DATA } from './flags-data';
import { swapRegion } from './flag-highlight';
import { enumerateElements, elementsWithColor, recolorElements } from './flag-elements';

const byName = (n: string) => FLAGS_DATA.find(f => f.name === n)!;
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe('element addressing', () => {
  it('indexes every element in document order, defs included', () => {
    const svg = '<svg viewBox="0 0 3 2"><defs><path id="a" fill="#FFFFFF"/></defs><rect fill="#FF0000"/><g fill="#FFFFFF"><use href="#a"/></g></svg>';
    expect(enumerateElements(svg).map(e => e.tag)).toEqual(['svg', 'defs', 'path', 'rect', 'g', 'use']);
    expect(elementsWithColor(svg, '#FFFFFF')).toEqual([2, 4]);
  });

  it('repaints only the listed elements', () => {
    const svg = '<svg viewBox="0 0 3 2"><rect fill="#FFFFFF"/><rect fill="#FFFFFF"/></svg>';
    expect(recolorElements(svg, [1], '#FFFFFF', '#123456'))
      .toBe('<svg viewBox="0 0 3 2"><rect fill="#123456"/><rect fill="#FFFFFF"/></svg>');
  });

  it('indices stay valid as earlier tags change length', () => {
    const svg = '<svg viewBox="0 0 3 2"><rect fill="#FFFFFF"/><rect fill="#FFFFFF"/><rect fill="#FFFFFF"/></svg>';
    const out = recolorElements(svg, [1, 3], '#FFFFFF', '#0F0F0F');
    expect(count(out, '#0F0F0F')).toBe(2);
    expect(elementsWithColor(out, '#FFFFFF')).toEqual([2]);
  });
});

describe('crest-scoped regions', () => {
  const scoped = FLAGS_DATA.flatMap(f => f.hideable.filter(h => h.idx).map(h => ({ f, h })));

  it('exist in the built data', () => {
    expect(scoped.length).toBeGreaterThan(20);
  });

  it('leave the rest of the colour untouched', () => {
    for (const { f, h } of scoped) {
      const owned = h.idx!;
      const all = elementsWithColor(f.svg, h.hex);
      expect(owned.length).toBeGreaterThan(0);
      expect(owned.length).toBeLessThan(all.length);
      const out = swapRegion(f.svg, h.hex, '#123456', owned);
      // the emblem keeps its paint, and nothing outside the region moved
      expect(out).toContain(h.hex);
      expect(elementsWithColor(out, h.hex)).toEqual(all.filter(i => !owned.includes(i)));
    }
  });

  it('Slovakia keeps its coat of arms when the white band is hidden', () => {
    const sk = byName('Slovakia');
    const white = sk.hideable.find(h => h.hex === '#FFFFFF')!;
    expect(white.idx).toBeDefined();
    const out = swapRegion(sk.svg, '#FFFFFF', '#888888', white.idx);
    expect(count(out, '#888888')).toBe(1);
    expect(count(out, '#FFFFFF')).toBe(count(sk.svg, '#FFFFFF') - 1);
  });
});

describe('built flag data', () => {
  it('drops colours that live only inside an emblem', () => {
    // Iraq's green is the Arabic script, nothing else — not a colour puzzle.
    expect(byName('Iraq').hideable.map(h => h.hex)).not.toContain('#017B3D');
    // New Zealand's white is only the Union Jack fimbriation and the star borders.
    expect(byName('New Zealand').hideable.map(h => h.hex)).not.toContain('#FFFFFF');
  });

  it('has the newly added flags and none of the three expensive crests', () => {
    const names = new Set(FLAGS_DATA.map(f => f.name));
    for (const n of ['Greece', 'Scotland', 'Texas', 'Taiwan', 'Greenland', 'European Union']) expect(names.has(n)).toBe(true);
    for (const n of ['Bhutan', 'Fiji', 'Serbia']) expect(names.has(n)).toBe(false);
  });

  it('gives every flag at least one playable region', () => {
    for (const f of FLAGS_DATA) {
      expect(f.hideable.length).toBeGreaterThan(0);
      for (const h of f.hideable) expect(f.svg).toContain(h.hex);
    }
  });
});

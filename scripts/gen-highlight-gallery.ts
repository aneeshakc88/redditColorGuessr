// Dev-only. Emits a single HTML page showing every flag with each of its hideable
// regions outlined by the SAME highlightRegion the game uses — so the marching-ants
// ring can be verified for all flags×regions at once, without playing on Reddit.
// Build+run: npx esbuild scripts/gen-highlight-gallery.ts --bundle --platform=node --format=esm --outfile=<tmp>/gen.mjs && node <tmp>/gen.mjs [out.html]
import { writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { FLAGS_DATA } from '../src/shared/flags-data';
import { regionOutline, regionOutlineRaster, applyOverlay, viewBoxRatio, type Raster } from '../src/shared/flag-highlight';

const OUT = process.argv[2] || 'highlight-gallery.html';

const rasterize = async (svg: string, width: number): Promise<Raster> => {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  return { data: img.pixels, width: img.width, height: img.height };
};

type Tile = { name: string; hex: string; coverage: number; ratio: number; svg: string; fallback: boolean };
const tiles: Tile[] = [];
const fallbackFlags = new Set<string>();
for (const f of FLAGS_DATA) {
  for (const h of f.hideable) {
    const sync = regionOutline(f.svg, h.hex, h.idx);
    const overlay = sync ?? (await regionOutlineRaster(f.svg, h.hex, rasterize, h.idx));
    const fallback = sync === null; // raster path = non-rectilinear flag
    if (fallback) fallbackFlags.add(f.name);
    tiles.push({ name: f.name, hex: h.hex, coverage: h.coverage, ratio: viewBoxRatio(f.svg), svg: applyOverlay(f.svg, overlay), fallback });
  }
}
console.log(`\nRaster-fallback flags (non-rectilinear, ${fallbackFlags.size}):\n  ` + [...fallbackFlags].sort().join(', '));

const cards = tiles.map((t, i) => `
  <figure class="card" data-name="${t.name}" data-fallback="${t.fallback}">
    <div class="flag" style="aspect-ratio:${t.ratio.toFixed(3)}">${t.svg}</div>
    <figcaption>
      <span class="idx">${i + 1}</span>
      <b>${t.name}</b>${t.fallback ? '<span class="fb">raster</span>' : ''}
      <span class="hex"><i style="background:${t.hex}"></i>${t.hex}</span>
      <span class="cov">${Math.round(t.coverage * 100)}%</span>
    </figcaption>
  </figure>`).join('');

const html = `<title>Flag highlight gallery — ${tiles.length}</title>
<style>
  :root{--bg:#0e1116;--card:#171b22;--ink:#eef1f5;--muted:#98a0ad;--line:#242a33}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line);padding:12px clamp(12px,3vw,24px);display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  h1{margin:0;font-size:16px;font-weight:800}
  input#q{font:inherit;font-size:13px;padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);min-width:200px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;padding:clamp(12px,3vw,24px)}
  .card{margin:0;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .flag{width:100%;background:repeating-conic-gradient(#2a2f38 0 25%,#20242c 0 50%) 50%/16px 16px;display:flex;align-items:center;justify-content:center}
  .flag svg{display:block;width:100%;height:100%}
  figcaption{display:flex;align-items:center;gap:8px;padding:8px 10px;font-size:12px;flex-wrap:wrap}
  figcaption b{font-size:13px}
  .idx{color:var(--muted);font-variant-numeric:tabular-nums}
  .hex{margin-left:auto;display:flex;align-items:center;gap:5px;font-family:ui-monospace,Consolas,monospace;color:var(--muted)}
  .hex i{width:12px;height:12px;border-radius:3px;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
  .cov{color:var(--muted);font-variant-numeric:tabular-nums}
  .fb{font-size:10px;font-weight:700;color:#ffb454;border:1px solid #ffb45455;border-radius:5px;padding:1px 5px}
  .hide{display:none}
</style>
<div class="top">
  <h1>Flag highlight gallery · ${tiles.length} regions</h1>
  <input id="q" placeholder="filter by country…">
  <label class="idx" style="display:flex;gap:6px;align-items:center;cursor:pointer"><input type="checkbox" id="onlyFb"> only filter-fallback</label>
  <span class="idx" id="stat"></span>
</div>
<div class="grid" id="grid">${cards}</div>
<script>
  const cards=[...document.querySelectorAll('.card')],q=document.getElementById('q'),stat=document.getElementById('stat'),onlyFb=document.getElementById('onlyFb');
  function run(){const v=q.value.trim().toLowerCase(),fb=onlyFb.checked;let n=0;cards.forEach(c=>{const m=(!v||c.dataset.name.toLowerCase().includes(v))&&(!fb||c.dataset.fallback==='true');c.classList.toggle('hide',!m);if(m)n++;});stat.textContent=n+' shown';}
  q.addEventListener('input',run);onlyFb.addEventListener('change',run);run();
</script>`;

writeFileSync(OUT, html);
console.log('wrote', OUT, '—', tiles.length, 'tiles,', (Buffer.byteLength(html) / 1024 / 1024).toFixed(1), 'MB');

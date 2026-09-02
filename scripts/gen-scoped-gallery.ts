// Dev-only. Verification page for the 49 flags whose hideable region owns only part
// of its colour. Shows, per region, the real flag / the puzzle as the player sees it
// / what the old whole-hex swap used to do.
import { writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';
import { FLAGS_DATA } from '../src/shared/flags-data';
import { getGauntletRounds } from '../src/shared/flag-core';
import { elementsWithColor, enumerateElements } from '../src/shared/flag-elements';
import {
  swapRegion, regionOutline, regionOutlineRaster, applyOverlay, viewBoxRatio, type Raster,
} from '../src/shared/flag-highlight';

const OUT = process.argv[2] || 'scoped-gallery.html';

const rasterize = async (svg: string, width: number): Promise<Raster> => {
  const img = new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render();
  return { data: img.pixels, width: img.width, height: img.height };
};

const wrongByKey = new Map<string, string>();
for (const r of getGauntletRounds()) {
  const k = `${r.flag.name}|${r.hiddenHex}`;
  if (!wrongByKey.has(k)) wrongByKey.set(k, r.wrongHex);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

type Row = {
  hex: string; wrong: string; coverage: number; scoped: boolean;
  owns: number; total: number; leak: number; elements: number;
  real: string; now: string; before: string | null; raster: boolean;
};
type Section = { name: string; ratio: number; rows: Row[]; scopedCount: number };

const sections: Section[] = [];
let scopedRegions = 0, rasterCount = 0;

for (const f of FLAGS_DATA) {
  if (!f.hideable.some(h => h.idx)) continue;
  const elements = enumerateElements(f.svg).length;
  const rows: Row[] = [];

  for (const h of f.hideable) {
    const wrong = wrongByKey.get(`${f.name}|${h.hex}`) ?? '#FF00FF';
    const sync = regionOutline(f.svg, h.hex, h.idx);
    const overlay = sync ?? (await regionOutlineRaster(f.svg, h.hex, rasterize, h.idx));
    if (sync === null) rasterCount++;

    const all = elementsWithColor(f.svg, h.hex);
    const owns = h.idx ? h.idx.length : all.length;

    rows.push({
      hex: h.hex, wrong, coverage: h.coverage, scoped: !!h.idx,
      owns, total: all.length, leak: all.length - owns, elements,
      real: f.svg,
      now: applyOverlay(swapRegion(f.svg, h.hex, wrong, h.idx), overlay),
      before: h.idx ? applyOverlay(f.svg.split(h.hex.toUpperCase()).join(wrong), overlay) : null,
      raster: sync === null,
    });
    if (h.idx) scopedRegions++;
  }

  rows.sort((a, b) => Number(b.scoped) - Number(a.scoped) || b.coverage - a.coverage);
  sections.push({ name: f.name, ratio: viewBoxRatio(f.svg), rows, scopedCount: rows.filter(r => r.scoped).length });
}

const totalRegions = sections.reduce((n, s) => n + s.rows.length, 0);
const worst = [...sections].flatMap(s => s.rows.filter(r => r.scoped).map(r => ({ n: s.name, leak: r.leak })))
  .sort((a, b) => b.leak - a.leak).slice(0, 3);

const pane = (label: string, note: string, svg: string, ratio: number, tone: string) => `
      <div class="pane ${tone}">
        <span class="pane-label">${label}</span>
        <div class="frame" style="aspect-ratio:${ratio.toFixed(3)}">${svg}</div>
        <span class="pane-note">${note}</span>
      </div>`;

const rowHtml = (s: Section, r: Row) => {
  const swatches = `<span class="chip"><i style="background:${r.hex}"></i>${r.hex}</span><span class="arr">→</span><span class="chip"><i style="background:${r.wrong}"></i>${r.wrong}</span>`;
  const meta = r.scoped
    ? `<span class="stat"><b>${r.owns}</b> of <b>${r.total}</b> shapes painted ${r.hex}</span>
       <span class="stat leak"><b>${r.leak}</b> used to repaint by mistake</span>`
    : `<span class="stat">only shape${r.total === 1 ? '' : 's'} painted ${r.hex} in this flag</span>`;

  return `
    <article class="region ${r.scoped ? 'is-scoped' : 'is-whole'}" data-scoped="${r.scoped}">
      <header class="region-head">
        <span class="tag">${r.scoped ? 'part of a shared colour' : 'whole colour'}</span>
        ${swatches}
        <span class="cov">${Math.round(r.coverage * 100)}% of flag</span>
        ${r.raster ? '<span class="tag raster">traced outline</span>' : ''}
      </header>
      <div class="panes ${r.before ? 'three' : 'two'}">
        ${pane('Real flag', 'what it should look like', r.real, s.ratio, 'neutral')}
        ${pane('In the game now', 'ants mark the region · only it recolours', r.now, s.ratio, 'good')}
        ${r.before ? pane('Old behaviour', `every ${r.hex} shape recoloured`, r.before, s.ratio, 'bad') : ''}
      </div>
      <footer class="region-meta">${meta}</footer>
    </article>`;
};

const sectionHtml = (s: Section) => `
  <section class="flag" data-name="${esc(s.name)}">
    <div class="flag-head">
      <h2>${esc(s.name)}</h2>
      <span class="flag-meta">${s.rows.length} playable region${s.rows.length === 1 ? '' : 's'} · <b>${s.scopedCount}</b> shares a colour with something else</span>
    </div>
    ${s.rows.map(r => rowHtml(s, r)).join('')}
  </section>`;

const html = `<title>Shared-Colour Flag Regions</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root{
    --ground:#F4F5F3; --panel:#FFFFFF; --sunk:#EAECE8;
    --line:#D9DCD6; --line-soft:#E7E9E4;
    --ink:#161A1D; --ink-2:#3C444A; --muted:#6D767C;
    --accent:#2F5D73; --good:#2E6B4F; --bad:#9A3B2C; --warn:#8A5A1B;
    --good-bg:#E8F1EB; --bad-bg:#F6E9E5; --warn-bg:#F5EEE1;
    --sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    --cond:"IBM Plex Sans Condensed",var(--sans);
    --mono:"IBM Plex Mono",ui-monospace,Consolas,monospace;
    --r:6px;
  }
  @media (prefers-color-scheme:dark){
    :root:not([data-theme="light"]){
      --ground:#121619; --panel:#191E22; --sunk:#0D1113;
      --line:#2A3238; --line-soft:#222A2F;
      --ink:#E9EDEF; --ink-2:#BAC3C8; --muted:#8A959C;
      --accent:#7FB3C8; --good:#7DC49E; --bad:#E0907E; --warn:#D6AB6A;
      --good-bg:#17291F; --bad-bg:#2C1A16; --warn-bg:#2A2117;
    }
  }
  :root[data-theme="dark"]{
    --ground:#121619; --panel:#191E22; --sunk:#0D1113;
    --line:#2A3238; --line-soft:#222A2F;
    --ink:#E9EDEF; --ink-2:#BAC3C8; --muted:#8A959C;
    --accent:#7FB3C8; --good:#7DC49E; --bad:#E0907E; --warn:#D6AB6A;
    --good-bg:#17291F; --bad-bg:#2C1A16; --warn-bg:#2A2117;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
  a{color:var(--accent)}

  .masthead{border-bottom:1px solid var(--line);background:var(--panel);padding:26px clamp(16px,4vw,40px) 20px}
  .masthead-in{max-width:1240px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
  h1{font-family:var(--cond);font-weight:700;font-size:clamp(22px,3vw,30px);letter-spacing:-0.01em;margin:0;text-wrap:balance}
  .lede{margin:0;max-width:66ch;color:var(--ink-2)}
  .lede b{color:var(--ink);font-weight:600}
  .figures{display:flex;flex-wrap:wrap;gap:10px 28px;padding-top:2px}
  .fig{display:flex;flex-direction:column;gap:1px}
  .fig b{font-family:var(--mono);font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}
  .fig span{font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--muted)}

  .bar{position:sticky;top:0;z-index:9;background:var(--panel);border-bottom:1px solid var(--line);padding:10px clamp(16px,4vw,40px)}
  .bar-in{max-width:1240px;margin:0 auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
  input[type=search]{font:inherit;font-size:13px;padding:7px 11px;border:1px solid var(--line);border-radius:var(--r);background:var(--sunk);color:var(--ink);min-width:200px}
  input[type=search]:focus-visible,label:focus-within{outline:2px solid var(--accent);outline-offset:2px}
  .toggle{display:flex;gap:7px;align-items:center;cursor:pointer;font-size:13px;color:var(--ink-2)}
  .count{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

  main{max-width:1240px;margin:0 auto;padding:clamp(16px,4vw,32px) clamp(16px,4vw,40px) 64px;display:flex;flex-direction:column;gap:34px}

  .flag-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding-bottom:9px;border-bottom:2px solid var(--ink);margin-bottom:14px}
  h2{font-family:var(--cond);font-weight:700;font-size:21px;margin:0;letter-spacing:-0.005em}
  .flag-meta{font-size:12px;color:var(--muted)}
  .flag-meta b{color:var(--ink-2);font-family:var(--mono);font-weight:600}
  section.flag{display:flex;flex-direction:column;gap:14px}

  .region{background:var(--panel);border:1px solid var(--line-soft);border-radius:var(--r);padding:13px 14px 11px;display:flex;flex-direction:column;gap:11px}
  .region.is-scoped{border-left:3px solid var(--warn)}
  .region-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
  .tag{font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:3px;background:var(--sunk);color:var(--muted)}
  .is-scoped .tag:first-child{background:var(--warn-bg);color:var(--warn)}
  .chip{display:inline-flex;align-items:center;gap:5px;font-family:var(--mono);font-size:12px;color:var(--ink-2)}
  .chip i{width:13px;height:13px;border-radius:3px;box-shadow:inset 0 0 0 1px rgba(128,128,128,.45)}
  .arr{color:var(--muted);font-size:12px}
  .cov{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}

  .panes{display:grid;gap:12px}
  .panes.three{grid-template-columns:repeat(3,1fr)}
  .panes.two{grid-template-columns:repeat(2,1fr);max-width:66%}
  @media (max-width:780px){.panes.three,.panes.two{grid-template-columns:1fr;max-width:none}}
  .pane{display:flex;flex-direction:column;gap:5px;min-width:0}
  .pane-label{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
  .pane.good .pane-label{color:var(--good)}
  .pane.bad .pane-label{color:var(--bad)}
  .pane-note{font-size:11.5px;color:var(--muted);line-height:1.35}
  .frame{width:100%;background:var(--sunk);border:1px solid var(--line-soft);border-radius:4px;overflow:hidden;display:flex}
  .pane.good .frame{border-color:color-mix(in srgb,var(--good) 45%,var(--line-soft))}
  .pane.bad .frame{border-color:color-mix(in srgb,var(--bad) 45%,var(--line-soft))}
  .frame svg{display:block;width:100%;height:100%}

  .region-meta{display:flex;gap:8px 18px;flex-wrap:wrap;border-top:1px solid var(--line-soft);padding-top:9px}
  .stat{font-size:12px;color:var(--muted)}
  .stat b{font-family:var(--mono);font-weight:600;color:var(--ink-2)}
  .stat.leak b{color:var(--bad)}

  .empty{padding:40px 0;color:var(--muted);text-align:center}
  .hide{display:none}
  @media (prefers-reduced-motion:reduce){*{animation-duration:0s!important}}
</style>

<div class="masthead">
  <div class="masthead-in">
    <h1>Flags where one colour is used in two places</h1>
    <p class="lede">In Flag ColorGuessr a region is outlined with marching ants and shown in the wrong colour; the player slides back to the real one. On these <b>${sections.length} flags</b> the outlined region shares its hex with something else on the flag — a crest, a star, a piece of filigree. The region now records <b>which shapes it owns</b>, so only those repaint. Third pane shows what the old whole-colour swap did.</p>
    <div class="figures">
      <div class="fig"><b>${sections.length}</b><span>flags affected</span></div>
      <div class="fig"><b>${scopedRegions}</b><span>shared-colour regions</span></div>
      <div class="fig"><b>${totalRegions}</b><span>regions shown</span></div>
      <div class="fig"><b>${FLAGS_DATA.length}</b><span>flags in the game</span></div>
    </div>
  </div>
</div>

<div class="bar">
  <div class="bar-in">
    <label class="visually-hidden" for="q" style="font-size:12px;color:var(--muted)">Filter</label>
    <input id="q" type="search" placeholder="filter by country…">
    <label class="toggle"><input type="checkbox" id="onlyScoped"> only shared-colour regions</label>
    <span class="count" id="count"></span>
  </div>
</div>

<main id="main">
  ${sections.map(sectionHtml).join('')}
  <p class="empty hide" id="empty">No flag matches that name.</p>
</main>

<script>
  var secs = [].slice.call(document.querySelectorAll('section.flag'));
  var q = document.getElementById('q');
  var only = document.getElementById('onlyScoped');
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');
  function run() {
    var v = q.value.trim().toLowerCase(), s = only.checked, flags = 0, regions = 0;
    secs.forEach(function (sec) {
      var nameOk = !v || sec.dataset.name.toLowerCase().indexOf(v) !== -1;
      var shown = 0;
      [].slice.call(sec.querySelectorAll('.region')).forEach(function (r) {
        var ok = nameOk && (!s || r.dataset.scoped === 'true');
        r.classList.toggle('hide', !ok);
        if (ok) shown++;
      });
      sec.classList.toggle('hide', shown === 0);
      if (shown) { flags++; regions += shown; }
    });
    count.textContent = flags + ' flags · ' + regions + ' regions';
    empty.classList.toggle('hide', flags > 0);
  }
  q.addEventListener('input', run);
  only.addEventListener('change', run);
  run();
</script>`;

writeFileSync(OUT, html);
console.log('wrote', OUT, '—', sections.length, 'flags,', totalRegions, 'regions,', scopedRegions, 'scoped,', rasterCount, 'raster-traced,', (Buffer.byteLength(html) / 1024 / 1024).toFixed(2), 'MB');
console.log('worst leaks:', worst.map(w => w.n + ' (' + w.leak + ')').join(', '));

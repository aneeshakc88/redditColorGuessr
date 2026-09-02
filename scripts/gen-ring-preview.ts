// Dev-only. Emits a single HTML page for checking the splash flag ring without
// playing on Reddit: live spinning rings plus a card for every flag, all built
// from the SAME src/shared/flag-card.ts the splash uses.
// Build+run: npm run ring-preview [-- Nepal Switzerland Qatar ...]
import { writeFileSync } from 'fs';
import { FLAGS_DATA } from '../src/shared/flags-data';
import {
  RING_TILT, RING_ROLL, CARD_STRIPS, RING_COPIES, RING_CARD_W, RING_CARD_H,
  CARD_FIT_MODE, FIT_TOLERANCE, MIN_CARD_GAP, ringRadius, bendRadius, ringPlacement, cardBox,
  flagDataUri, flagAspect, type FitMode,
} from '../src/shared/flag-card';

const MODES: { mode: FitMode; label: string; blurb: string }[] = [
  { mode: 'height', label: 'height', blurb: 'Equal height, width follows the real ratio. No distortion, no frame, nothing cropped.' },
  { mode: 'mat', label: 'mat', blurb: `One card size; flags within ${Math.round((FIT_TOLERANCE - 1) * 100)}% of it fill it, the rest sit undistorted on a frame.` },
  { mode: 'letterbox', label: 'letterbox', blurb: 'Original behaviour — one card, flag fits inside it, so neighbours differ in height.' },
  { mode: 'stretch', label: 'stretch', blurb: 'One card, every flag stretched to fill it. Nepal and Switzerland deform badly.' },
];

const OUT = 'ring-preview.html';
const byName = new Map(FLAGS_DATA.map(f => [f.name.toLowerCase(), f]));
const pick = (names: string[]) => names.map(n => {
  const f = byName.get(n.toLowerCase());
  if (!f) throw new Error(`no flag named "${n}" — check src/shared/flags-data.ts`);
  return f;
});

const cliFlags = process.argv.slice(2).filter(a => !a.startsWith('-'));
const widest = [...FLAGS_DATA].sort((a, b) => flagAspect(b.svg) - flagAspect(a.svg));
const rings: { label: string; flags: typeof FLAGS_DATA }[] = cliFlags.length
  ? [{ label: `From the command line: ${cliFlags.join(', ')}`, flags: pick(cliFlags) }]
  : [
    { label: 'Worst case — the ratio outliers together', flags: pick(['Nepal', 'Switzerland', 'Qatar', 'Tonga', 'Paraguay']) },
    { label: 'Screenshot set — the day you reported', flags: pick(['Paraguay', 'Saudi Arabia', 'Tonga', 'Zambia', 'Philippines']) },
    { label: 'Typical day — every flag fills its card, no mats', flags: pick(['France', 'Italy', 'Japan', 'Ukraine', 'Peru']) },
    { label: 'Widest five in the dataset', flags: widest.slice(0, 5) },
  ];

// One card = CARD_STRIPS slices on a convex arc, exactly as BentCard builds it.
// The flag URI goes on the wrapper as --f so it isn't repeated 12× per card —
// with 4 modes × 171 flags that inlining is the difference between 4 MB and 40.
const strips = (svg: string, mode: FitMode) => {
  const box = cardBox(svg, 1, mode);
  const stripW = box.w / CARD_STRIPS;
  const bendRad = box.bendR;
  const step = box.bend / CARD_STRIPS;
  return Array.from({ length: CARD_STRIPS }, (_, j) => {
    const a = -box.bend / 2 + (j + 0.5) * step;
    const r = [j === 0 ? 9 : 0, j === CARD_STRIPS - 1 ? 9 : 0];
    return `<i style="width:${stripW + 0.7}px;height:${box.h}px;margin-left:${-stripW / 2}px;`
      + `transform:rotateY(${a}deg) translateZ(${bendRad}px);`
      + `${box.mat ? `background-color:${box.mat};` : ''}`
      + `background-size:${box.bg.w}px ${box.bg.h}px;background-position:${box.bg.x - j * stripW}px ${box.bg.y}px;`
      + `border-radius:${r[0]}px ${r[1]}px ${r[1]}px ${r[0]}px"></i>`;
  }).join('');
};

const cardVar = (svg: string) => `--f:url('${flagDataUri(svg)}')`;

const ringHtml = (flags: typeof FLAGS_DATA, mode: FitMode) => {
  const ring = Array.from({ length: RING_COPIES }, () => flags).flat();
  const radius = ringRadius(RING_CARD_W, ring.length);
  const boxes = ring.map(f => cardBox(f.svg, 1, mode));
  const { angles } = ringPlacement(boxes.map(b => b.w), radius + bendRadius());
  const cards = ring.map((f, i) => {
    const box = boxes[i]!;
    return `<div class="fr-card" style="${cardVar(f.svg)};width:${box.w}px;height:${box.h}px;margin-left:${-box.w / 2}px;`
      + `margin-top:${-box.h / 2}px;transform:rotateY(${angles[i]}deg) translateZ(${radius + box.zOffset}px)">${strips(f.svg, mode)}</div>`;
  }).join('');
  return `<div class="fr-ring">${cards}</div>`;
};

const tileGrid = (mode: FitMode) => [...FLAGS_DATA]
  .map(f => ({ f, ar: flagAspect(f.svg), box: cardBox(f.svg, 1, mode) }))
  .sort((a, b) => a.ar - b.ar)
  .map(({ f, ar, box }) => {
    const stretch = Math.round((box.bg.w / box.bg.h / ar - 1) * 100);
    const tag = box.matted
      ? '<span class="tag mat">matted</span>'
      : `<span class="tag fill">${Math.abs(stretch) > 1 ? `${stretch > 0 ? '+' : ''}${stretch}% stretch` : 'true ratio'}</span>`;
    return `<figure class="tile" data-name="${f.name}" data-matted="${box.matted}">
      <div class="flat" style="${cardVar(f.svg)};width:${box.w}px;height:${box.h}px">${strips(f.svg, mode)}</div>
      <figcaption><b>${f.name}</b><span class="ar">${ar.toFixed(3)}</span>${tag}</figcaption>
    </figure>`;
  }).join('');

const mattedCount = FLAGS_DATA.filter(f => cardBox(f.svg, 1, 'mat').matted).length;

const html = `<title>Splash flag ring preview</title>
<style>
  :root{--bg:#0a0e18;--panel:#141b28;--ink:#eef1f5;--muted:#9fb0c4;--line:#232b3a}
  *{box-sizing:border-box}
  body{margin:0;background:radial-gradient(120% 90% at 50% 0%,#14203a 0%,#0a0e18 60%,#05070d 100%);color:var(--ink);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;min-height:100vh}
  header{padding:18px clamp(12px,3vw,26px);border-bottom:1px solid var(--line);background:rgba(10,14,24,.7)}
  h1{margin:0 0 6px;font-size:17px;font-weight:800}
  h2{margin:0;font-size:13px;font-weight:700;color:var(--muted)}
  p.note{margin:8px 0 0;font-size:12.5px;color:var(--muted);max-width:70ch;line-height:1.55}
  /* The ring reaches ~${Math.round(ringRadius(RING_CARD_W, RING_COPIES * 5) + bendRadius())}px from its axis, well past the 340px stage —
     on the splash the full-screen parent clips it, so each row clips it the same way. */
  .ringrow{position:relative;height:460px;overflow:hidden;border:1px solid var(--line);border-radius:14px;
    margin:10px clamp(12px,3vw,26px) 0;background:radial-gradient(120% 90% at 50% 0%,#14203a 0%,#0a0e18 60%,#05070d 100%)}
  .stage{position:absolute;left:50%;top:50%;width:340px;height:300px;margin-left:-170px;margin-top:-150px;perspective-origin:50% 50%}
  body.fit .stage{transform:scale(.3)}
  .setname{position:absolute;left:12px;top:10px;z-index:3;font-size:11.5px;font-weight:700;color:var(--muted);
    background:rgba(5,8,14,.82);border:1px solid var(--line);border-radius:7px;padding:4px 8px}
  .fr-ring{position:relative;width:100%;height:100%;transform-style:preserve-3d;animation:fr-spin 40s linear infinite}
  .fr-card{position:absolute;top:50%;left:50%;transform-style:preserve-3d}
  .fr-card i,.flat i{position:absolute;top:0;left:50%;display:block;transform-origin:50% 50%;
    background-image:var(--f);background-repeat:no-repeat;box-shadow:inset 0 -2px 4px rgba(0,0,0,.14)}
  @keyframes fr-spin{
    from{transform:rotateX(${RING_TILT}deg) rotateZ(${RING_ROLL}deg) rotateY(0deg)}
    to{transform:rotateX(${RING_TILT}deg) rotateZ(${RING_ROLL}deg) rotateY(360deg)}}
  body.paused .fr-ring{animation-play-state:paused}
  .bar{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px clamp(12px,3vw,26px);
    border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:rgba(10,14,24,.7);position:sticky;top:0;z-index:5}
  input#q{font:inherit;font-size:13px;padding:7px 11px;border:1px solid var(--line);border-radius:8px;background:#0b1120;color:var(--ink);min-width:190px}
  label{display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--muted);cursor:pointer}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(178px,1fr));gap:12px;padding:clamp(12px,3vw,26px)}
  .tile{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px;display:flex;flex-direction:column;gap:8px;align-items:center}
  .flat{position:relative;transform-style:preserve-3d}
  figcaption{display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:center;font-size:12px}
  .ar{color:var(--muted);font-family:ui-monospace,Consolas,monospace}
  .tag{font-size:10px;font-weight:700;border-radius:5px;padding:1px 5px}
  .tag.mat{color:#ffb454;border:1px solid #ffb45455}
  .tag.fill{color:#6ee7a8;border:1px solid #6ee7a855}
  .modehead{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;padding:16px clamp(12px,3vw,26px) 0}
  .modehead h2{font-size:15px;color:var(--ink);font-family:ui-monospace,Consolas,monospace}
  .blurb{font-size:12.5px;color:var(--muted)}
  select#mode{font:inherit;font-size:13px;padding:6px 9px;border:1px solid var(--line);border-radius:8px;background:#0b1120;color:var(--ink)}
  .hide{display:none}
</style>
<header>
  <h1>Splash flag ring preview</h1>
  <p class="note">Everything here is built from the real card geometry in <code>src/shared/flag-card.ts</code>, so it renders what the
  splash renders. Four ways to reconcile 24 different flag ratios with a ring that needs cards of one size — compare, then set
  <code>CARD_FIT_MODE</code> in that file. Currently <b>${CARD_FIT_MODE}</b>. In mat mode ${mattedCount} of ${FLAGS_DATA.length} flags
  get a frame; the ${Math.round((FIT_TOLERANCE - 1) * 100)}% tolerance and the ${MIN_CARD_GAP}° minimum card gap are tunable there too.
  Ring slots are sized per card, so a wide flag takes a wider slot rather than losing height.</p>
</header>
<div class="bar">
  <strong style="font-size:13px">Flags in the ring</strong>
  <select id="set">${rings.map((r, i) => `<option value="${i}">${r.label}</option>`).join('')}</select>
  <label><input type="checkbox" id="fit"> fit whole ring (30%)</label>
  <label><input type="checkbox" id="pause"> pause spin</label>
</div>
${MODES.map(m => `
<section>
  <div class="modehead"><h2>${m.mode}</h2><span class="blurb">${m.blurb}</span>${m.mode === CARD_FIT_MODE ? '<span class="tag fill">in use</span>' : ''}</div>
  <div class="ringrow">
    <span class="setname" data-mode="${m.mode}">${m.mode}</span>
    ${rings.map((r, i) => `<div class="stage" data-set="${i}" style="perspective:1500px${i ? ';display:none' : ''}">${ringHtml(r.flags, m.mode)}</div>`).join('')}
  </div>
</section>`).join('\n')}
<div class="bar">
  <strong style="font-size:13px">All ${FLAGS_DATA.length} flags as cards</strong>
  <select id="mode">${MODES.map(m => `<option value="${m.mode}"${m.mode === CARD_FIT_MODE ? ' selected' : ''}>${m.mode}</option>`).join('')}</select>
  <input id="q" placeholder="filter by country…">
  <label><input type="checkbox" id="onlyMat"> only matted</label>
  <span class="ar" id="stat"></span>
</div>
${MODES.map(m => `<div class="grid" id="grid-${m.mode}"${m.mode === CARD_FIT_MODE ? '' : ' hidden'}>${tileGrid(m.mode)}</div>`).join('\n')}
<script>
  const SETS=${JSON.stringify(rings.map(r => r.label))};
  const q=document.getElementById('q'),onlyMat=document.getElementById('onlyMat'),stat=document.getElementById('stat'),
    mode=document.getElementById('mode'),set=document.getElementById('set'),
    pause=document.getElementById('pause'),fit=document.getElementById('fit');

  function showSet(){const i=set.value;
    document.querySelectorAll('.stage').forEach(s=>{s.style.display=s.dataset.set===i?'':'none';});
    document.querySelectorAll('.setname').forEach(el=>{el.textContent=el.dataset.mode+' · '+SETS[i];});}

  function showGrid(){const v=q.value.trim().toLowerCase(),m=onlyMat.checked;let n=0;
    document.querySelectorAll('.grid').forEach(g=>{g.hidden=g.id!=='grid-'+mode.value;});
    document.querySelectorAll('#grid-'+mode.value+' .tile').forEach(t=>{
      const ok=(!v||t.dataset.name.toLowerCase().includes(v))&&(!m||t.dataset.matted==='true');
      t.classList.toggle('hide',!ok);if(ok)n++;});
    stat.textContent=n+' shown';}

  set.addEventListener('change',showSet);
  q.addEventListener('input',showGrid);onlyMat.addEventListener('change',showGrid);mode.addEventListener('change',showGrid);
  pause.addEventListener('change',()=>document.body.classList.toggle('paused',pause.checked));
  fit.addEventListener('change',()=>document.body.classList.toggle('fit',fit.checked));
  showSet();showGrid();
</script>`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT} — ${rings.length} ring(s), ${FLAGS_DATA.length} flag cards, ${mattedCount} matted`);

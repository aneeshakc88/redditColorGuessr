// Build-time only. Emits a visual review page: independent reference PNG (rendered
// from the ORIGINAL flagcdn svg) vs our shipped svg, with checkbox + comment per flag.
import { writeFileSync } from 'fs';
import { createRequire } from 'module';
import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, join } from 'path';
const require = createRequire(import.meta.url);
const { Resvg } = require('@resvg/resvg-js');

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] || join(here, '..', 'review.html');

// import our shipped data (bundle flags-data via a tiny esbuild-free dynamic import of the TS is not possible;
// instead read the emitted module through a prebuilt mjs passed as env, else re-fetch). We import the TS-compiled
// data by requiring the JSON-ish export through a bundled copy the caller provides.
const dataUrl = process.env.FLAGS_DATA_MJS;
if (!dataUrl) { console.error('set FLAGS_DATA_MJS to a bundled flags-data.mjs'); process.exit(1); }
const { FLAGS_DATA } = await import(pathToFileURL(dataUrl).href);

function pngDataUri(svg) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 150 } }).render().asPng();
  return 'data:image/png;base64,' + Buffer.from(png).toString('base64');
}

const rows = [];
let i = 0;
for (const f of FLAGS_DATA) {
  i++;
  let ref = '';
  try {
    const res = await fetch(`https://flagcdn.com/${f.code}.svg`);
    ref = pngDataUri(await res.text());
  } catch { ref = ''; }
  rows.push({ idx: i, name: f.name, code: f.code, ref, svg: f.svg });
  process.stdout.write('.');
}
process.stdout.write('\n');

const rowHtml = rows.map(r => `
  <tr data-name="${r.name}">
    <td class="idx">${r.idx}</td>
    <td class="nm">${r.name}<span class="code">${r.code}</span></td>
    <td class="fl"><img loading="lazy" src="${r.ref}" alt="ref"></td>
    <td class="fl ours">${r.svg}</td>
    <td class="ck"><input type="checkbox" class="ok" aria-label="correct"></td>
    <td class="cm"><input type="text" class="note" placeholder="what's wrong?"></td>
  </tr>`).join('');

const html = `<title>Flag Review — ${rows.length}</title>
<style>
  :root{--bg:#f6f7f9;--panel:#fff;--ink:#14181f;--muted:#69707c;--line:#e6e8ec;--accent:#d7263d;--ok:#1a7f37;--okbg:#e7f6ec}
  @media (prefers-color-scheme:dark){:root{--bg:#0e1116;--panel:#171b22;--ink:#eef1f5;--muted:#98a0ad;--line:#242a33;--accent:#ff5a6e;--ok:#4ac26b;--okbg:#12261a}}
  :root[data-theme="light"]{--bg:#f6f7f9;--panel:#fff;--ink:#14181f;--muted:#69707c;--line:#e6e8ec;--accent:#d7263d;--ok:#1a7f37;--okbg:#e7f6ec}
  :root[data-theme="dark"]{--bg:#0e1116;--panel:#171b22;--ink:#eef1f5;--muted:#98a0ad;--line:#242a33;--accent:#ff5a6e;--ok:#4ac26b;--okbg:#12261a}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  .top{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);padding:14px clamp(12px,3vw,28px);display:flex;flex-wrap:wrap;gap:14px;align-items:center;justify-content:space-between}
  h1{margin:0;font-size:18px;font-weight:800;letter-spacing:-.01em}
  .sub{color:var(--muted);font-size:12.5px;margin-top:2px}
  .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .stat{font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums}
  button{font:inherit;font-weight:700;font-size:13px;border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:8px 14px;cursor:pointer}
  button.primary{background:var(--accent);color:#fff;border-color:transparent}
  label.filter{font-size:12.5px;color:var(--muted);display:flex;gap:6px;align-items:center;cursor:pointer}
  .wrap{padding:clamp(12px,3vw,28px);max-width:980px;margin:0 auto}
  table{width:100%;border-collapse:collapse}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:middle}
  th{position:sticky;top:64px;background:var(--bg);font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);z-index:4}
  tr.done{background:var(--okbg)}
  .idx{color:var(--muted);font-variant-numeric:tabular-nums;width:34px;font-size:12px}
  .nm{font-weight:600;font-size:13.5px;min-width:120px}
  .code{display:block;font-size:10px;color:var(--muted);text-transform:uppercase}
  .fl{width:210px}
  .fl img,.fl svg{display:block;height:100px;width:auto;border-radius:4px;box-shadow:0 0 0 1px rgba(0,0,0,.14)}
  .ck{width:44px;text-align:center}
  .ck input{width:20px;height:20px;cursor:pointer;accent-color:var(--ok)}
  .cm input{width:100%;min-width:120px;font:inherit;font-size:13px;padding:7px 9px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--ink)}
  .hide{display:none}
  dialog{border:none;border-radius:12px;max-width:min(680px,92vw);width:100%;padding:0;background:var(--panel);color:var(--ink)}
  dialog::backdrop{background:rgba(0,0,0,.45)}
  .dlg{padding:18px}
  textarea{width:100%;height:300px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;border:1px solid var(--line);border-radius:8px;padding:10px;background:var(--bg);color:var(--ink)}
</style>
<div class="top">
  <div>
    <h1>Flag review · ${rows.length}</h1>
    <div class="sub">Left = reference (rendered from official source). Right = <b>our</b> flag in the game. Tick = correct. Comment what's wrong. Saves as you go.</div>
  </div>
  <div class="controls">
    <span class="stat" id="stat"></span>
    <label class="filter"><input type="checkbox" id="onlyTodo"> only unreviewed</label>
    <button id="copy" class="primary">Submit / Copy issues</button>
  </div>
</div>
<div class="wrap">
  <table>
    <thead><tr><th>#</th><th>Country</th><th>Reference</th><th>Ours</th><th>OK</th><th>Comment</th></tr></thead>
    <tbody id="tb">${rowHtml}</tbody>
  </table>
</div>
<dialog id="dlg"><div class="dlg">
  <h1 style="margin:0 0 8px">Issues to send back</h1>
  <div class="sub" style="margin-bottom:10px">Copy this and paste it back in chat. Only flags you left <b>unticked</b> or commented are included.</div>
  <textarea id="out" readonly></textarea>
  <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
    <button onclick="navigator.clipboard.writeText(document.getElementById('out').value)">Copy to clipboard</button>
    <button class="primary" onclick="document.getElementById('dlg').close()">Done</button>
  </div>
</div></dialog>
<script>
  const KEY = 'flag-review-v1';
  const state = JSON.parse(localStorage.getItem(KEY) || '{}');
  const rows = [...document.querySelectorAll('#tb tr')];
  function apply(tr){
    const n = tr.dataset.name, s = state[n] || {};
    const ok = tr.querySelector('.ok'), note = tr.querySelector('.note');
    ok.checked = !!s.ok; note.value = s.note || '';
    tr.classList.toggle('done', ok.checked);
  }
  function save(tr){
    const n = tr.dataset.name;
    const ok = tr.querySelector('.ok').checked, note = tr.querySelector('.note').value.trim();
    if (ok || note) state[n] = { ok, note }; else delete state[n];
    localStorage.setItem(KEY, JSON.stringify(state));
    tr.classList.toggle('done', ok);
    stat(); filter();
  }
  function stat(){
    const total = rows.length, ok = rows.filter(t=>t.querySelector('.ok').checked).length;
    document.getElementById('stat').textContent = ok+' / '+total+' reviewed';
  }
  function filter(){
    const only = document.getElementById('onlyTodo').checked;
    rows.forEach(t=>t.classList.toggle('hide', only && t.querySelector('.ok').checked));
  }
  rows.forEach(tr=>{ apply(tr);
    tr.querySelector('.ok').addEventListener('change',()=>save(tr));
    tr.querySelector('.note').addEventListener('input',()=>save(tr));
  });
  document.getElementById('onlyTodo').addEventListener('change',filter);
  document.getElementById('copy').addEventListener('click',()=>{
    const issues = rows.map(t=>({name:t.dataset.name, ok:t.querySelector('.ok').checked, note:t.querySelector('.note').value.trim()}))
      .filter(r=>!r.ok || r.note)
      .map(r=> r.name + (r.note? ' — '+r.note : (r.ok?'':' — (marked wrong)')));
    document.getElementById('out').value = issues.length? 'WRONG/COMMENTED FLAGS ('+issues.length+'):\\n'+issues.join('\\n') : 'All reviewed flags look correct.';
    document.getElementById('dlg').showModal();
  });
  stat(); filter();
</script>`;

writeFileSync(OUT, html);
console.log('\nwrote', OUT, '—', rows.length, 'rows,', (Buffer.byteLength(html)/1024/1024).toFixed(1), 'MB');

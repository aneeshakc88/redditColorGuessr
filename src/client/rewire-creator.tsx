import './index.css';

import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showForm, showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { WIRE_COLORS, WIRE_CONFIG } from '../shared/wire-core';
import { REWIRE_SIZES } from '../shared/rewire-core';
import { inkOn } from '../shared/ink';
import { generateVerified, maxPairsFor, repairPairs, runCheck as runBoardCheck, tapCell as tapBoardCell, verify, type Check, type Dot } from './wireBoardEditor';

const BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const ACCENT = '#38bdf8';
const GRAD = 'linear-gradient(135deg,#0ea5e9,#22d3ee)';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

const SHAPES = REWIRE_SIZES.map(n => ({ key: String(n), w: n, h: n }));

// Shares its setting with Colorwire's creator/game.
const LABELS_KEY = 'wire:labels';
const loadLabels = () => { try { return localStorage.getItem(LABELS_KEY) === '1'; } catch { return false; } };
const saveLabels = (on: boolean) => { try { localStorage.setItem(LABELS_KEY, on ? '1' : '0'); } catch { /* noop */ } };

const LabelsIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {!on && <line x1="3" y1="21" x2="21" y2="3" />}
  </svg>
);

export const RewireCreator = () => {
  const [shape, setShape] = useState<{ w: number; h: number }>({ w: REWIRE_SIZES[0], h: REWIRE_SIZES[0] });
  const { w, h } = shape;
  const [pairs, setPairs] = useState<Dot[]>([]);
  const [active, setActive] = useState(0);
  const [title, setTitle] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState('');
  const [labels, setLabels] = useState(loadLabels);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const lastTarget = useRef(0);

  const cells = w * h;
  const maxPairs = maxPairsFor(cells);

  const complete = pairs.filter(p => p.b != null);
  const ready = !!imageUrl && complete.length >= WIRE_CONFIG.minPairs && complete.length === pairs.length;

  const reset = (nextShape?: { w: number; h: number }) => {
    if (nextShape) setShape(nextShape);
    setPairs([]);
    setActive(0);
    setCheck({ state: 'idle' });
  };

  const pickPhoto = async () => {
    if (pinning) return;
    const res = await showForm({
      title: 'Choose a photo',
      fields: [{ type: 'image', name: 'photo', label: 'Photo', required: true }],
    });
    if (res.action !== 'SUBMITTED') return;
    setPinning(true);
    try {
      const { mediaUrl } = await trpc.rewire.pinImage.mutate({ url: res.values.photo });
      setImageUrl(mediaUrl);
    } catch (err) {
      console.error('[rewire-creator] pin image failed:', err);
      void showToast({ text: 'Could not use that photo — try another.', appearance: 'neutral' });
    } finally {
      setPinning(false);
    }
  };

  const tapCell = (cell: number) => {
    setCheck({ state: 'idle' });
    const { pairs: next, active: nextActive } = tapBoardCell(cell, pairs, active, maxPairs,
      () => void showToast({ text: `Max ${maxPairs} pairs on a ${w}×${h} board.`, appearance: 'neutral' }));
    setPairs(next);
    setActive(nextActive);
  };

  // Density jitters around the size's natural pair count, so two surprises in a
  // row don't just reshuffle the same board.
  const surprise = async () => {
    if (busy) return;
    setBusy('Generating…');
    const base = Math.round(cells / 7);
    let target = 0;
    for (let i = 0; i < 4; i++) {
      target = Math.max(WIRE_CONFIG.minPairs, Math.min(maxPairs, base + Math.floor(Math.random() * 5) - 2));
      if (target !== lastTarget.current) break;
    }
    lastTarget.current = target;
    await new Promise(r => setTimeout(r, 30));
    const p = await generateVerified(w, h, target);
    if (p) {
      setPairs(p.map(pair => ({ a: pair.a, b: pair.b })));
      setActive(p.length);
      setCheck({ state: 'ok' });
    } else {
      setCheck({ state: 'bad', reason: 'Could not build a board that size. Try again.' });
    }
    setBusy('');
  };

  const repair = async () => {
    if (busy) return;
    setBusy('Repairing…');
    await new Promise(r => setTimeout(r, 30));
    const board = complete.map(p => ({ a: p.a, b: p.b! }));
    if (verify(board, w, h)) {
      setCheck({ state: 'ok' });
      setBusy('');
      return;
    }
    const fixed = await repairPairs(board, w, h);
    if (fixed) {
      setPairs(fixed.map(p => ({ a: p.a, b: p.b })));
      setActive(fixed.length);
      setCheck({ state: 'ok' });
    } else {
      setCheck({ state: 'bad', reason: 'Could not repair this board. Move a dot, or try Surprise me.' });
    }
    setBusy('');
  };

  const post = async () => {
    if (!ready || posting || !imageUrl) return;
    setCheck({ state: 'checking' });
    await new Promise(r => setTimeout(r, 30));
    const { verdict, check: result } = runBoardCheck(complete.map(p => ({ a: p.a, b: p.b! })), w, h);
    setCheck(result);
    if (verdict === 'bad') return;

    setPosting(true);
    try {
      const res = await trpc.rewire.createCustomPuzzle.mutate({
        w: w as 5 | 6, h: h as 5 | 6,
        pairs: complete.map(p => ({ a: p.a, b: p.b! })),
        title: title.trim() || undefined,
        imageUrl,
      });
      navigateTo(res.postUrl);
    } catch (err) {
      console.error('[rewire-creator] post failed:', err);
      void showToast({ text: 'Could not post the board. Try again.', appearance: 'neutral' });
      setPosting(false);
    }
  };

  const cx = (i: number) => (i % w) + 0.5;
  const cy = (i: number) => Math.floor(i / w) + 0.5;
  const pending = pairs[active]?.b == null ? pairs[active]?.a : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
      <style>{`
        @keyframes wcPulse { 0%,100%{ opacity:0.35; } 50%{ opacity:0.9; } }
        .wc-head { flex-shrink:0; padding:10px 16px 4px; max-width:480px; margin:0 auto; width:100%; }
        .wc-main { flex:1; min-height:0; display:flex; flex-direction:column; gap:10px; padding:8px 16px 14px; width:100%; }
        .wc-boardwrap { flex:1; min-height:0; min-width:0; container-type:size; display:flex; align-items:center; justify-content:center; }
        .wc-rail { flex-shrink:0; max-width:420px; margin:0 auto; width:100%; display:flex; flex-direction:column; gap:8px; }
        .wc-actions { display:flex; gap:8px; }
        @media (min-width: 820px) {
          .wc-head { max-width:900px; }
          .wc-main { flex-direction:row; align-items:stretch; gap:24px; max-width:900px; margin:0 auto; }
          .wc-boardwrap { flex:1; min-width:0; }
          .wc-rail { width:260px; flex-shrink:0; margin:0; align-self:center; }
        }
      `}</style>

      <div className="wc-head">
        <p style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
          Build a <span style={{ background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Rewire</span>
        </p>
        <p style={{ fontSize: 11, color: '#71717a', margin: '2px 0 8px', fontWeight: 600 }}>
          Upload a photo, then tap two cells to drop a pair on it.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Board title… (optional)" maxLength={60}
            style={{ flex: 1, minWidth: 0, borderRadius: 10, border: `1px solid ${BORDER}`, background: CARD, padding: '8px 12px', fontSize: 13, color: '#fff', outline: 'none' }} />
          <button onClick={() => setLabels(v => { saveLabels(!v); return !v; })} aria-label="Number the pairs" aria-pressed={labels}
            style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: `1px solid ${labels ? ACCENT : BORDER}`, background: labels ? 'rgba(56,189,248,0.18)' : CARD, color: labels ? '#fff' : '#71717a' }}>
            <LabelsIcon on={labels} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={() => void pickPhoto()} disabled={pinning}
            style={{ flex: 1, height: 34, borderRadius: 8, fontSize: 12, fontWeight: 800, cursor: pinning ? 'default' : 'pointer', border: `1px solid ${imageUrl ? ACCENT : BORDER}`, background: imageUrl ? 'rgba(56,189,248,0.18)' : CARD, color: '#fff' }}>
            {pinning ? 'Uploading…' : imageUrl ? '✓ Photo picked — change it' : '📷 Upload a photo (required)'}
          </button>
          <div style={{ display: 'flex', gap: 4 }}>
            {SHAPES.map(s => (
              <button key={s.key} onClick={() => reset(s)}
                style={{ width: 34, height: 34, borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: 'pointer', border: `1px solid ${w === s.w && h === s.h ? ACCENT : BORDER}`, background: w === s.w && h === s.h ? 'rgba(56,189,248,0.18)' : CARD, color: w === s.w && h === s.h ? '#fff' : '#71717a' }}>
                {s.w}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="wc-main">
        <div className="wc-boardwrap">
        <div style={{ aspectRatio: `${w} / ${h}`, width: `min(100cqw, 560px, calc(100cqh * ${w} / ${h}))` }}>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          onPointerDown={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const c = Math.floor(((e.clientX - rect.left) / rect.width) * w);
            const r = Math.floor(((e.clientY - rect.top) / rect.height) * h);
            if (r < 0 || c < 0 || r >= h || c >= w) return;
            tapCell(r * w + c);
          }}
          style={{ width: '100%', height: '100%', touchAction: 'none', userSelect: 'none', borderRadius: 14, background: '#0d1626', border: `1px solid ${BORDER}`, boxShadow: '0 10px 34px rgba(0,0,0,0.45)' }}
        >
          {imageUrl ? (
            <>
              <image href={imageUrl} x={0} y={0} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
              <rect x={0} y={0} width={w} height={h} fill="rgba(4,10,20,0.28)" />
            </>
          ) : (
            Array.from({ length: cells }, (_, i) => (
              <rect key={i} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill="#131f33" />
            ))
          )}
          <g stroke={imageUrl ? 'rgba(255,255,255,0.72)' : '#1b2a42'} strokeWidth={imageUrl ? 0.035 : 0.03} strokeLinecap="square" style={{ pointerEvents: 'none' }}>
            {imageUrl && Array.from({ length: cells }, (_, i) => (
              <rect key={`s${i}`} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill="none" stroke="rgba(0,0,0,0.5)" strokeWidth={0.08} />
            ))}
            {Array.from({ length: w + 1 }, (_, i) => <line key={`v${i}`} x1={i} y1={0} x2={i} y2={h} />)}
            {Array.from({ length: h + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i} x2={w} y2={i} />)}
          </g>
          {pairs.map((p, i) => (
            <g key={i}>
              <circle cx={cx(p.a)} cy={cy(p.a)} r={0.31} fill={WIRE_COLORS[i]} />
              {p.b != null && <circle cx={cx(p.b)} cy={cy(p.b)} r={0.31} fill={WIRE_COLORS[i]} />}
              {labels && [p.a, p.b].map(c => c == null ? null : (
                <text key={c} x={cx(c)} y={cy(c)} textAnchor="middle" dominantBaseline="central" fontSize={0.36} fontWeight={800}
                  fill={inkOn(WIRE_COLORS[i] ?? '#ffffff')} style={{ pointerEvents: 'none' }}>{i + 1}</text>
              ))}
            </g>
          ))}
          {pending != null && (
            <circle cx={cx(pending)} cy={cy(pending)} r={0.42} fill="none" stroke={WIRE_COLORS[active]} strokeWidth={0.06} style={{ animation: 'wcPulse 1.2s ease-in-out infinite' }} />
          )}
        </svg>
        </div>
        </div>

        <div className="wc-rail">
        <p style={{ fontSize: 11, textAlign: 'center', margin: 0, fontWeight: 700, color: check.state === 'bad' ? '#f87171' : check.state === 'ok' ? '#34d399' : '#71717a' }}>
          {busy ? busy
            : !imageUrl ? 'Upload a photo to get started'
            : check.state === 'bad' ? check.reason
            : check.state === 'ok' ? '✓ Solvable — every cell can be filled'
            : check.state === 'checking' ? 'Checking…'
            : `${complete.length}/${maxPairs} pairs placed`}
        </p>
        <div className="wc-actions">
          <button onClick={() => void surprise()} disabled={!!busy || !imageUrl} style={{ flex: 1, height: 44, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${BORDER}`, cursor: busy ? 'default' : 'pointer' }}>
            Surprise me
          </button>
          {check.state === 'bad' && (
            <button onClick={() => void repair()} disabled={!!busy}
              style={{ flex: 1, height: 44, borderRadius: 999, background: 'rgba(56,189,248,0.18)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${ACCENT}`, cursor: busy ? 'default' : 'pointer' }}>
              {busy === 'Repairing…' ? 'Repairing…' : 'Repair'}
            </button>
          )}
          <button onClick={() => reset()} disabled={!!busy} style={{ flex: 1, height: 44, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${BORDER}`, cursor: busy ? 'default' : 'pointer' }}>
            Clear
          </button>
        </div>
        <button onClick={() => void post()} disabled={!ready || posting || !!busy || check.state === 'checking'}
          style={{ width: '100%', height: 50, borderRadius: 999, background: ready ? GRAD : 'rgba(255,255,255,0.08)', color: ready ? '#04212f' : '#71717a', fontWeight: 800, fontSize: 15, border: 'none', cursor: ready && !posting ? 'pointer' : 'default' }}>
          {posting ? 'Posting…' : check.state === 'checking' ? 'Checking…' : 'Validate & Post'}
        </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RewireCreator />
  </StrictMode>
);

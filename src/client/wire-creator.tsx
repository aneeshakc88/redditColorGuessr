import './index.css';

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { rateBoard, WIRE_COLORS, WIRE_CONFIG, WIRE_TIERS, WIRE_TIER_LABEL, type WireTier } from '../shared/wire-core';
import { WireBoard } from './components/WireBoard';
import { inkOn } from '../shared/ink';
import {
  generateForTierVerified, maxPairsFor, rateBuilt, repairPairs, runCheck as runBoardCheck,
  tapCell as tapBoardCell, verify, type Check, type Dot, type Rated,
} from './wireBoardEditor';

const BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const ACCENT = '#38bdf8';
const GRAD = 'linear-gradient(135deg,#0ea5e9,#22d3ee)';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

// Squares first, then wide/tall presets capped near 1.5x — thinner boards
// collapse toward a single snaking wire (see isGoodBoard's straight-line check).
const SHAPES: { key: string; w: number; h: number }[] = [
  { key: '5', w: 5, h: 5 },
  { key: '6', w: 6, h: 6 },
  { key: '7', w: 7, h: 7 },
  { key: '8', w: 8, h: 8 },
  { key: '9', w: 9, h: 9 },
  { key: '10', w: 10, h: 10 },
  { key: '7x5', w: 7, h: 5 },
  { key: '5x7', w: 5, h: 7 },
  { key: '9x6', w: 9, h: 6 },
  { key: '6x9', w: 6, h: 9 },
];

// Shares its setting with the game so the preference carries across both.
const LABELS_KEY = 'wire:labels';
const loadLabels = () => { try { return localStorage.getItem(LABELS_KEY) === '1'; } catch { return false; } };
const saveLabels = (on: boolean) => { try { localStorage.setItem(LABELS_KEY, on ? '1' : '0'); } catch { /* noop */ } };

// Hard needs one wire that runs several times longer than the gap between its
// dots. A board under 8x8 has nowhere to hide that detour, so every "hard" it
// produces is a number with no play behind it — the chip is off there instead
// of quietly lying.
const HARD_MIN_CELLS = 64;
const TIER_COLOR: Record<WireTier, string> = { easy: '#34d399', medium: '#fbbf24', hard: '#f87171' };
const TIER_HINT: Record<WireTier, string> = {
  easy: 'Lots of pairs, short wires. A board people finish on the bus.',
  medium: 'Some room to go wrong, but nothing that traps you.',
  hard: 'Fewer pairs, and one wire that has to run the long way around.',
};

// Identifies the exact board a difficulty reading belongs to.
const boardSig = (board: { a: number; b: number }[], w: number, h: number) =>
  `${w}x${h}:${board.map(p => `${p.a}-${p.b}`).join(',')}`;

const LabelsIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {!on && <line x1="3" y1="21" x2="21" y2="3" />}
  </svg>
);

export const WireCreator = () => {
  const [shape, setShape] = useState({ w: 9, h: 9 });
  const { w, h } = shape;
  const [pairs, setPairs] = useState<Dot[]>([]);
  const [active, setActive] = useState(0);
  const [title, setTitle] = useState('');
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [posting, setPosting] = useState(false);
  const [busy, setBusy] = useState('');
  const [labels, setLabels] = useState(loadLabels);
  const [goalPick, setGoalPick] = useState<WireTier>('medium');
  // What the board actually measures, with the solution it was measured from,
  // tagged with the board it belongs to so a stale reading can never be shown
  // against edited dots. 'unknown' means the meter's search ran out before it
  // found one, which is not a verdict — the post check gets a bigger budget.
  const [rated, setRated] = useState<{ sig: string; value: Rated | 'unknown' | null } | null>(null);
  // Two screens, not tabs: 'build' places dots, 'test' is the creator playing
  // their own board full-screen. Solving it is a second route to a proven
  // solution, alongside the solver and the generator's carve.
  const [mode, setMode] = useState<'build' | 'test'>('build');
  // Where the board standing right now came from. A generator carve (or a
  // repair) arrives proven, so it can go straight out. The moment a dot moves
  // it's the creator's board, proof gone — they play it once instead.
  const [origin, setOrigin] = useState<'hand' | 'made'>('hand');
  const [routes, setRoutes] = useState<number[][]>([]);
  const [dragColor, setDragColor] = useState<number | null>(null);
  // Wall-clock run split in two so the clock stops while they're back in the
  // builder: seconds banked from earlier visits, plus the leg running now.
  const [runSec, setRunSec] = useState(0);
  const [runFrom, setRunFrom] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [solvedRun, setSolvedRun] = useState<{ sig: string; seconds: number } | null>(null);

  const cells = w * h;
  const maxPairs = maxPairsFor(cells);
  // Small boards can score "hard" off a wire with nowhere to go, so the goal
  // quietly falls back rather than promising something the size cannot deliver.
  const hardAllowed = cells >= HARD_MIN_CELLS;
  const goal: WireTier = goalPick === 'hard' && !hardAllowed ? 'medium' : goalPick;

  const complete = pairs.filter(p => p.b != null);
  const ready = complete.length >= WIRE_CONFIG.minPairs && complete.length === pairs.length;
  const needsSolve = origin === 'hand';
  const board = complete.map(p => ({ a: p.a, b: p.b! }));
  const sig = boardSig(board, w, h);
  const current = rated && rated.sig === sig ? rated.value : null;
  const measured = typeof current === 'object' && current ? current.rating : null;

  // Their own solve of their own board. Cleared the moment a dot moves, so a
  // "Post" button can never be standing on a run against a different board.
  const solved = solvedRun && solvedRun.sig === sig ? solvedRun : null;
  const postable = ready && (!needsSolve || !!solved);
  // A hand-built board's one button is Test & Verify until the run proves it;
  // every other board goes straight to Validate & Post. Never both at once.
  const toTest = mode === 'build' && needsSolve && !solved;
  let connected = 0, filled = 0;
  routes.forEach((path, i) => {
    filled += path.length;
    const p = board[i];
    if (!p || path.length < 2) return;
    const a = path[0]!, b = path[path.length - 1]!;
    if ((a === p.a && b === p.b) || (a === p.b && b === p.a)) connected++;
  });
  const allJoined = board.length > 0 && connected === board.length;
  const testSolved = allJoined && filled === cells;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elapsed = useMemo(() => Math.floor(runSec + (runFrom == null ? 0 : (Date.now() - runFrom) / 1000)), [runSec, runFrom, tick]);
  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  // Forget the run: any dot edit, a new board, or a size change.
  const clearRun = () => {
    setRoutes([]);
    setDragColor(null);
    setRunSec(0);
    setRunFrom(null);
    setSolvedRun(null);
  };

  // One wire array per pair, so a board edited between visits doesn't leave
  // routes indexed against pairs that no longer exist.
  const boardLen = board.length;
  useEffect(() => {
    if (mode === 'test' && routes.length !== boardLen) setRoutes(Array.from({ length: boardLen }, () => []));
  }, [mode, routes.length, boardLen]);

  // The clock runs only while they're on the test screen and still solving.
  useEffect(() => {
    if (mode !== 'test' || runFrom == null || testSolved) return;
    const id = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(id);
  }, [mode, runFrom, testSolved]);

  // Bank the running leg whenever the clock should stop: they went back to the
  // builder, or they finished.
  useEffect(() => {
    if (runFrom == null) return;
    if (mode === 'test' && !testSolved) return;
    setRunSec(s => s + (Date.now() - runFrom) / 1000);
    setRunFrom(null);
  }, [mode, testSolved, runFrom]);

  // A finished run is a verified solution: it feeds the same channel the
  // generator's carve does, so the post path below needs no special case.
  useEffect(() => {
    if (!testSolved || (solvedRun && solvedRun.sig === sig)) return;
    const solution = routes.map(r => r.slice());
    setRated({ sig, value: { pairs: board, solution, rating: rateBoard({ w, h, pairs: board }, solution) } });
    setCheck({ state: 'ok' });
    setSolvedRun({ sig, seconds: Math.floor(runSec + (runFrom == null ? 0 : (Date.now() - runFrom) / 1000)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [testSolved, sig]);

  // Measures the board a beat after the last tap. A generated board arrives
  // already measured, so this only ever runs for hand-built ones.
  useEffect(() => {
    if (!ready || (rated && rated.sig === sig)) return;
    const t = setTimeout(() => {
      const next = pairs.filter(p => p.b != null).map(p => ({ a: p.a, b: p.b! }));
      const value = rateBuilt(next, w, h);
      setRated({ sig, value });
      // A hard 'no solution' is the one reading worth interrupting for: the
      // creator can't play their way out of it, so Repair has to show up.
      if (value === null) setCheck({ state: 'bad', reason: 'No way to fill this board. Move a dot, or hit Repair.' });
    }, 400);
    return () => clearTimeout(t);
  }, [sig, ready, rated, pairs, w, h]);

  const reset = (nextShape?: { w: number; h: number }) => {
    if (nextShape) setShape(nextShape);
    setPairs([]);
    setActive(0);
    setCheck({ state: 'idle' });
    setRated(null);
    setMode('build');
    setOrigin('hand');
    clearRun();
  };

  const adopt = (next: Rated, state: Check = { state: 'ok' }) => {
    setPairs(next.pairs.map(pair => ({ a: pair.a, b: pair.b })));
    setActive(next.pairs.length);
    setCheck(state);
    setRated({ sig: boardSig(next.pairs, w, h), value: next });
    setOrigin('made');
    clearRun();
  };

  const tapCell = (cell: number) => {
    setCheck({ state: 'idle' });
    // Their dots now, so the board has to prove itself the hard way.
    setOrigin('hand');
    // Dots moved, so any wires drawn against the old ones are meaningless.
    clearRun();
    const { pairs: next, active: nextActive } = tapBoardCell(cell, pairs, active, maxPairs,
      () => void showToast({ text: `Max ${maxPairs} pairs on a ${w}×${h} board.`, appearance: 'neutral' }));
    setPairs(next);
    setActive(nextActive);
  };

  // Generate, measure, reject, repeat until the board really is the tier the
  // chip asks for. No solver runs here: the generator hands over the carve it
  // built the board from, and that carve is the proof.
  const surprise = async () => {
    if (busy) return;
    setBusy('Generating…');
    // Yield a frame so the label paints before generation blocks.
    await new Promise(r => setTimeout(r, 30));
    const made = await generateForTierVerified(w, h, goal);
    if (made) adopt(made);
    else setCheck({ state: 'bad', reason: 'Could not build a board that size. Try again.' });
    setBusy('');
  };

  const repair = async () => {
    if (busy) return;
    setBusy('Repairing…');
    await new Promise(r => setTimeout(r, 30));
    // The board may only have failed because the check ran out of search, so
    // give the untouched one a deeper look before moving anyone's dots.
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
      setOrigin('made');
      clearRun();
    } else {
      setCheck({ state: 'bad', reason: 'Could not repair this board. Move a dot, or try Surprise me.' });
    }
    setBusy('');
  };

  const post = async () => {
    if (!ready || posting || (needsSolve && !solved)) return;
    setCheck({ state: 'checking' });
    // Yield a frame so the "Checking…" label paints before the solver blocks.
    await new Promise(r => setTimeout(r, 30));
    // A measured board already has a proven solution; only an unmeasured one
    // needs the deeper search.
    const known = typeof current === 'object' && current ? current.solution : null;
    let solution = known;
    if (!solution) {
      const { verdict, check: result, solution: found } = runBoardCheck(board, w, h);
      setCheck(result);
      if (verdict === 'bad') return;
      solution = found ?? null;
    } else {
      setCheck({ state: 'ok' });
    }

    setPosting(true);
    try {
      const res = await trpc.wire.createCustomPuzzle.mutate({
        w, h,
        pairs: board,
        title: title.trim() || undefined,
        ...(solution ? { solution } : {}),
      });
      navigateTo(res.postUrl);
    } catch (err) {
      console.error('[wire-creator] post failed:', err);
      void showToast({ text: 'Could not post the board. Try again.', appearance: 'neutral' });
      setPosting(false);
    }
  };

  const cx = (i: number) => (i % w) + 0.5;
  const cy = (i: number) => Math.floor(i / w) + 0.5;
  const pending = pairs[active]?.b == null ? pairs[active]?.a : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: BG, color: '#fff', overflow: 'hidden' }}>
      <style>{`
        @keyframes wcPulse { 0%,100%{ opacity:0.35; } 50%{ opacity:0.9; } }
        .wc-head { flex-shrink:0; padding:8px 10px 0; max-width:520px; margin:0 auto; width:100%; display:flex; flex-direction:column; gap:5px; }
        .wc-main { flex:1; min-height:0; display:flex; flex-direction:column; gap:6px; padding:6px 10px 10px; width:100%; }
        /* container-type:size makes the wrap's own box the reference for the
           board, so it can never grow past the space the row actually has. */
        .wc-boardwrap { flex:1; min-height:0; min-width:0; container-type:size; display:flex; align-items:center; justify-content:center; }
        .wc-rail { flex-shrink:0; max-width:420px; margin:0 auto; width:100%; display:flex; flex-direction:column; gap:8px; }
        .wc-actions { display:flex; gap:8px; }
        .wc-testbar { flex-shrink:0; display:flex; align-items:baseline; justify-content:space-between; gap:10px; padding:8px 10px 0; max-width:520px; margin:0 auto; width:100%; }
        .wc-sizes { display:flex; gap:3px; }
        .wc-sizes button { flex:1; min-width:0; height:26px; border-radius:7px; font-size:10px; font-weight:800; cursor:pointer; }
        @media (min-width: 820px) {
          .wc-head, .wc-testbar { max-width:900px; }
          .wc-sizes button { height:28px; font-size:11px; }
          .wc-main { flex-direction:row; align-items:stretch; gap:24px; max-width:900px; margin:0 auto; }
          .wc-boardwrap { flex:1; min-width:0; }
          .wc-rail { width:260px; flex-shrink:0; margin:0; align-self:center; }
        }
      `}</style>

      {mode === 'test' ? (
        <div className="wc-testbar">
          <p style={{ fontSize: 14, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
            {solved ? 'Board verified' : 'Testing your board'}
            <span style={{ fontSize: 11, color: '#71717a', fontWeight: 600 }}>
              {solved ? ' — post it whenever you like' : ' — drag each dot to its twin'}
            </span>
          </p>
          <span style={{ fontSize: 15, fontWeight: 800, color: solved ? '#34d399' : '#e4e4e7', fontVariantNumeric: 'tabular-nums' }}>
            {solved ? `${Math.floor(solved.seconds / 60)}:${String(solved.seconds % 60).padStart(2, '0')}` : clock}
          </span>
        </div>
      ) : (
      <div className="wc-head">
        <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title…" maxLength={60}
            style={{ flex: 1, minWidth: 48, borderRadius: 10, border: `1px solid ${BORDER}`, background: CARD, padding: '8px 10px', fontSize: 13, color: '#fff', outline: 'none' }} />
          {WIRE_TIERS.map(t => {
            const off = t === 'hard' && !hardAllowed;
            const on = goal === t && !off;
            return (
              <button key={t} onClick={() => setGoalPick(t)} disabled={off}
                title={off ? 'Hard needs an 8×8 board or bigger' : TIER_HINT[t]}
                style={{ flexShrink: 0, height: 30, padding: '0 8px', borderRadius: 8, fontSize: 11, fontWeight: 800, cursor: off ? 'default' : 'pointer', border: `1px solid ${on ? TIER_COLOR[t] : BORDER}`, background: on ? `${TIER_COLOR[t]}2e` : CARD, color: off ? '#3f3f46' : on ? '#fff' : '#71717a' }}>
                {WIRE_TIER_LABEL[t]}
              </button>
            );
          })}
          <button onClick={() => setLabels(v => { saveLabels(!v); return !v; })} aria-label="Number the pairs" aria-pressed={labels}
            style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', border: `1px solid ${labels ? ACCENT : BORDER}`, background: labels ? 'rgba(56,189,248,0.18)' : CARD, color: labels ? '#fff' : '#71717a' }}>
            <LabelsIcon on={labels} />
          </button>
        </div>
        <div className="wc-sizes">
          {SHAPES.map(s => (
            <button key={s.key} onClick={() => reset(s)}
              style={{ border: `1px solid ${w === s.w && h === s.h ? ACCENT : BORDER}`, background: w === s.w && h === s.h ? 'rgba(56,189,248,0.18)' : CARD, color: w === s.w && h === s.h ? '#fff' : '#71717a' }}>
              {s.w === s.h ? s.w : `${s.w}×${s.h}`}
            </button>
          ))}
        </div>
      </div>
      )}

      <div className="wc-main">
        <div className="wc-boardwrap">
        <div style={{ aspectRatio: `${w} / ${h}`, width: `min(100cqw, 720px, calc(100cqh * ${w} / ${h}))` }}>
        {mode === 'test' ? (
          <WireBoard
            puzzle={{ w, h, pairs: board }}
            colors={WIRE_COLORS}
            routes={routes.length === board.length ? routes : board.map(() => [])}
            dragColor={dragColor}
            onRoutes={(r, dc) => { setRoutes(r); setDragColor(dc); }}
            onDragEnd={() => setDragColor(null)}
            onFirstTouch={() => setRunFrom(v => v ?? Date.now())}
            locked={false}
            labels={labels}
            hintEmpty={allJoined && filled < cells}
          />
        ) : (
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
          {Array.from({ length: cells }, (_, i) => (
            <rect key={i} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill="#131f33" stroke="#1b2a42" strokeWidth={0.03} />
          ))}
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
        )}
        </div>
        </div>

        <div className="wc-rail">
        <p style={{ fontSize: 11, textAlign: 'center', margin: 0, fontWeight: 700, color: solved ? '#34d399' : mode === 'test' ? '#38bdf8' : check.state === 'bad' ? '#f87171' : check.state === 'ok' ? '#34d399' : '#71717a' }}>
          {busy ? busy
            : solved ? `✓ You solved it in ${Math.floor(solved.seconds / 60)}:${String(solved.seconds % 60).padStart(2, '0')}${measured ? ` · ${WIRE_TIER_LABEL[measured.tier]}` : ''}`
            : mode === 'test' ? (allJoined
              ? `All pairs joined — cover the last ${cells - filled} cell${cells - filled === 1 ? '' : 's'}`
              : `${connected}/${board.length} pairs · ${cells - filled} cells left to fill`)
            : check.state === 'bad' ? check.reason
            : needsSolve && ready ? 'Your board — play it once to prove it works'
            : check.state === 'ok' ? '✓ Solvable — every cell can be filled'
            : check.state === 'checking' ? 'Checking…'
            : pairs.length === 0 ? 'Tap two cells to drop a pair — or hit Surprise me'
            : `${complete.length}/${maxPairs} pairs placed`}
        </p>

        {mode === 'test' ? (
          <div className="wc-actions">
            <button onClick={() => { setRoutes(board.map(() => [])); setDragColor(null); }}
              style={{ flex: 1, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
              Clear wires
            </button>
            <button onClick={() => setMode('build')}
              style={{ flex: 1, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${BORDER}`, cursor: 'pointer' }}>
              Back to editing
            </button>
          </div>
        ) : (
          <>
            <div className="wc-actions">
              <button onClick={() => void surprise()} disabled={!!busy} style={{ flex: 1, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${BORDER}`, cursor: busy ? 'default' : 'pointer' }}>
                Surprise me
              </button>
              {check.state === 'bad' && (
                <button onClick={() => void repair()} disabled={!!busy}
                  style={{ flex: 1, height: 40, borderRadius: 999, background: 'rgba(56,189,248,0.18)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${ACCENT}`, cursor: busy ? 'default' : 'pointer' }}>
                  {busy === 'Repairing…' ? 'Repairing…' : 'Repair'}
                </button>
              )}
              <button onClick={() => reset()} disabled={!!busy} style={{ flex: 1, height: 40, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: `1px solid ${BORDER}`, cursor: busy ? 'default' : 'pointer' }}>
                Clear
              </button>
            </div>
          </>
        )}

        {toTest ? (
          <button onClick={() => setMode('test')} disabled={!ready || !!busy}
            title={ready ? undefined : `Place at least ${WIRE_CONFIG.minPairs} complete pairs first`}
            style={{ width: '100%', height: 46, borderRadius: 999, background: ready ? GRAD : 'rgba(255,255,255,0.08)', color: ready ? '#04212f' : '#71717a', fontWeight: 800, fontSize: 15, border: 'none', cursor: ready && !busy ? 'pointer' : 'default' }}>
            Test &amp; Verify
          </button>
        ) : (
          <button onClick={() => void post()} disabled={!postable || posting || !!busy || check.state === 'checking'}
            style={{ width: '100%', height: 46, borderRadius: 999, background: !postable ? 'rgba(255,255,255,0.08)' : solved ? 'linear-gradient(135deg,#10b981,#34d399)' : GRAD, color: postable ? '#04212f' : '#71717a', fontWeight: 800, fontSize: 15, border: 'none', cursor: postable && !posting ? 'pointer' : 'default' }}>
            {posting ? 'Posting…' : check.state === 'checking' ? 'Checking…'
              : !postable ? (needsSolve && ready ? 'Solve it to post' : 'Validate & Post')
              : solved ? (measured ? `Post as ${WIRE_TIER_LABEL[measured.tier]}` : 'Post')
              : measured ? `Validate & Post as ${WIRE_TIER_LABEL[measured.tier]}` : 'Validate & Post'}
          </button>
        )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WireCreator />
  </StrictMode>
);

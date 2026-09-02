import './index.css';

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { audioCtx } from './audio';
import { WireScoreboard } from './wire-scoreboard';
import { WireBoard } from './components/WireBoard';

type BoardData = inferRouterOutputs<AppRouter>['wire']['getBoard'];
type SubmitOk = Extract<inferRouterOutputs<AppRouter>['wire']['submit'], { solved: true }>;

const BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const ACCENT = '#38bdf8';
const GRAD = 'linear-gradient(135deg,#0ea5e9,#22d3ee)';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, delayMs * (i + 1))); }
  }
  throw new Error('unreachable');
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function tone(freq: number, dur: number, vol = 0.12, type: OscillatorType = 'sine') {
  try {
    const c = audioCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination); osc.type = type;
    const t = c.currentTime; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch { /* noop */ }
}
const sfxWin = () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.13), i * 95)); };

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted ? (<><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>) : (<><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>)}
  </svg>
);

// Numbers the dot pairs so the board is readable without relying on hue.
const LABELS_KEY = 'wire:labels';
const loadLabels = () => { try { return localStorage.getItem(LABELS_KEY) === '1'; } catch { return false; } };
const saveLabels = (on: boolean) => { try { localStorage.setItem(LABELS_KEY, on ? '1' : '0'); } catch { /* noop */ } };

const LabelsIcon = ({ on }: { on: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {!on && <line x1="3" y1="21" x2="21" y2="3" />}
  </svg>
);

const Styles = () => (
  <style>{`
    @keyframes wPop { 0%{ transform: scale(0.6); opacity:0; } 60%{ transform: scale(1.08); } 100%{ transform: scale(1); opacity:1; } }
    @keyframes wGlow { 0%,100%{ box-shadow:0 0 0 0 rgba(56,189,248,0.5);} 50%{ box-shadow:0 0 0 5px rgba(56,189,248,0.10);} }
    @keyframes wNeed { 0%,100%{ opacity:0.3; } 50%{ opacity:1; } }
    .w-scroll::-webkit-scrollbar{ width:0; height:0; }
  `}</style>
);

type Routes = number[][];

// Board lives in components/WireBoard.tsx — shared with Rewire's level 2.
// Leaderboard lives in wire-scoreboard.tsx — shared with the splash overlay.

// ── Game ──────────────────────────────────────────────────────────────────────
export const WireGame = () => {
  const [data, setData] = useState<BoardData | null>(null);
  const [routes, setRoutes] = useState<Routes>([]);
  const [dragColor, setDragColor] = useState<number | null>(null);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [labels, setLabels] = useState(loadLabels);
  const [result, setResult] = useState<SubmitOk | null>(null);
  const [showLb, setShowLb] = useState(false);
  const [error, setError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [commentText, setCommentText] = useState('');

  const startRef = useRef(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const submittedRef = useRef(false);
  // The clock only starts once the player actually touches the board — opening
  // the game and reading it costs nothing. `begin` is what the server times
  // from, so submit waits on this promise before scoring.
  const begunRef = useRef<Promise<unknown> | null>(null);

  const beginIfNeeded = () => {
    if (begunRef.current) return;
    startRef.current = Date.now();
    begunRef.current = trpc.wire.begin.mutate().catch(() => {});
  };

  useEffect(() => {
    void (async () => {
      try {
        const d = await withRetry(() => trpc.wire.getBoard.query());
        setData(d);
        setRoutes(d.puzzle.pairs.map(() => []));
      } catch {
        setError(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!data || result) return;
    const id = setInterval(() => { if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000)); }, 500);
    return () => clearInterval(id);
  }, [data, result]);

  const puzzle = data?.puzzle;
  const cells = puzzle ? puzzle.w * puzzle.h : 0;

  const { connected, filled } = useMemo(() => {
    if (!puzzle) return { connected: 0, filled: 0 };
    let conn = 0, fill = 0;
    routes.forEach((path, i) => {
      fill += path.length;
      const p = puzzle.pairs[i];
      if (!p || path.length < 2) return;
      const a = path[0]!, b = path[path.length - 1]!;
      if ((a === p.a && b === p.b) || (a === p.b && b === p.a)) conn++;
    });
    return { connected: conn, filled: fill };
  }, [routes, puzzle]);

  const allPairsJoined = !!puzzle && connected === puzzle.pairs.length;
  const solvedLocally = allPairsJoined && filled === cells;

  const submit = async (finalRoutes: Routes, moveCount: number) => {
    if (submittedRef.current || !puzzle) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await begunRef.current;
      const r = await trpc.wire.submit.mutate({
        routes: finalRoutes.map((c, color) => ({ color, cells: c })).filter(r2 => r2.cells.length > 1),
        moves: moveCount,
      });
      if (r.solved) {
        if (!mutedRef.current) sfxWin();
        setResult(r);
      } else {
        submittedRef.current = false;
        void showToast({ text: 'That board is not complete yet.', appearance: 'neutral' });
      }
    } catch {
      submittedRef.current = false;
      void showToast({ text: 'Could not submit — try again.', appearance: 'neutral' });
    } finally { setSubmitting(false); }
  };

  const onDragEnd = (drew: boolean) => {
    setDragColor(null);
    if (drew) setMoves(m => m + 1);
  };

  // Auto-submit the instant the board is complete — deliberately keyed on the
  // completion flag alone, so it fires once on the transition.
  useEffect(() => {
    if (solvedLocally && !submittedRef.current) void submit(routes, moves);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solvedLocally]);

  const postScore = async () => {
    if (!result || posting || posted) return;
    setPosting(true);
    try {
      await trpc.wire.postComment.mutate({
        text: commentText, score: result.score, timeSec: result.timeSec, moves: result.moves,
        topPct: result.topPct, userRank: result.userRank, playerCount: result.playerCount, streak: result.streak,
      });
      setPosted(true);
    } catch { void showToast({ text: 'Could not post.', appearance: 'neutral' }); }
    finally { setPosting(false); }
  };

  if (error) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: BG, color: '#f87171', padding: 16, textAlign: 'center' }}>Failed to load. Please refresh.</div>;
  if (!data || !puzzle) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: BG, color: '#a1a1aa' }}>Loading…</div>;
  if (showLb) return <WireScoreboard onClose={() => setShowLb(false)} />;

  // ── Result ──────────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
        <Styles />
        <button onClick={() => setShowLb(true)} aria-label="Leaderboard"
          style={{ position: 'absolute', top: 12, right: 14, zIndex: 3, width: 40, height: 40, borderRadius: '50%', border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.06)', cursor: 'pointer', fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🏆</button>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '18px 18px 16px', maxWidth: 420, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: '#71717a', margin: 0, animation: 'wPop 0.4s ease' }}>ALL WIRED UP IN</p>
            <p style={{ fontSize: 46, fontWeight: 900, margin: 0, lineHeight: 1.05, background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(result.timeSec)}</p>
            <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginTop: 8, padding: '5px 14px', borderRadius: 999, background: CARD, border: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 15, fontWeight: 900 }}>{result.score} pts</span>
              <span style={{ color: '#3f3f46' }}>·</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#a1a1aa' }}>{result.moves} wires</span>
              {result.topPct != null && <><span style={{ color: '#3f3f46' }}>·</span><span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>Top {result.topPct}%</span></>}
            </div>
            {result.recorded && (
              <p style={{ fontSize: 10, color: '#52525b', margin: '8px 0 0' }}>
                {[
                  result.userRank != null ? `🏅 #${result.userRank} today` : null,
                  result.streak != null && result.streak > 1 ? `🔥 ${result.streak}-day streak` : null,
                  result.lifetimeSolves != null ? `📊 ${result.lifetimeSolves} lifetime solve${result.lifetimeSolves === 1 ? '' : 's'}` : null,
                ].filter(Boolean).join('   ·   ')}
              </p>
            )}
            {!result.recorded && <p style={{ fontSize: 11, color: '#52525b', margin: '8px 0 0' }}>Replay — your first solve is the one on the board.</p>}
          </div>

          <div style={{ flex: 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 0', overflow: 'hidden' }}>
            <div style={{ height: '100%', maxHeight: '100%', maxWidth: '100%', aspectRatio: `${puzzle.w} / ${puzzle.h}` }}>
              <WireBoard puzzle={puzzle} colors={data.colors} routes={routes} dragColor={null} onRoutes={() => {}} onDragEnd={() => {}} locked labels={labels} />
            </div>
          </div>

          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!posted ? (
              <>
                <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a note… (optional)" maxLength={500}
                  style={{ width: '100%', borderRadius: 12, border: `1px solid ${BORDER}`, background: CARD, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none' }} />
                <button onClick={() => void postScore()} disabled={posting}
                  style={{ width: '100%', height: 48, borderRadius: 999, background: GRAD, color: '#04212f', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', opacity: posting ? 0.6 : 1 }}>
                  {posting ? 'Posting…' : 'Comment My Time'}
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', padding: 11 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>✓ Posted!</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Play ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
      <Styles />
      <div style={{ flexShrink: 0, padding: '12px 16px 6px', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 19, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
            Color<span style={{ background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>wire</span>
          </p>
          <p style={{ fontSize: 11, color: '#71717a', margin: '1px 0 0', fontWeight: 600 }}>
            {data.isCustom ? (data.creator ? `by u/${data.creator}` : 'Custom board') : data.date}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ padding: '4px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 900, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(elapsed)}</p>
            <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.14em', color: '#71717a', margin: 0 }}>TIME</p>
          </div>
          <div style={{ padding: '4px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 900, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{data.playerCount}</p>
            <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.14em', color: '#71717a', margin: 0 }}>SOLVERS</p>
          </div>
          <button onClick={() => setShowLb(true)} aria-label="Leaderboard" style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 17, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🏆</button>
          <button onClick={() => setLabels(v => { saveLabels(!v); return !v; })} aria-label="Number the pairs" aria-pressed={labels}
            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: labels ? ACCENT : '#71717a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LabelsIcon on={labels} /></button>
          <button onClick={() => setMuted(m => !m)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#71717a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><SoundIcon muted={muted} /></button>
        </div>
      </div>

      <p style={{ flexShrink: 0, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#a1a1aa', margin: '4px 0 8px' }}>
        {allPairsJoined && filled < cells ? (
          <span style={{ color: ACCENT }}>All pairs joined — now cover the {cells - filled} glowing cell{cells - filled === 1 ? '' : 's'}</span>
        ) : (
          <><span style={{ color: allPairsJoined ? '#34d399' : ACCENT }}>{connected}/{puzzle.pairs.length}</span> pairs · {cells - filled} cells left to fill</>
        )}
      </p>

      <div style={{ flex: 1, minHeight: 0, minWidth: 0, containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 14px' }}>
        <div style={{ width: `min(100cqw, 440px, calc(100cqh * ${puzzle.w} / ${puzzle.h}))`, aspectRatio: `${puzzle.w} / ${puzzle.h}` }}>
          <WireBoard
            puzzle={puzzle} colors={data.colors} routes={routes} dragColor={dragColor}
            onRoutes={(r, dc) => { setRoutes(r); setDragColor(dc); }}
            onDragEnd={onDragEnd}
            onFirstTouch={beginIfNeeded}
            locked={submitting}
            muted={muted}
            labels={labels}
            hintEmpty={allPairsJoined && filled < cells}
          />
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: '12px 16px 16px', maxWidth: 360, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button
          onClick={() => { setRoutes(puzzle.pairs.map(() => [])); setDragColor(null); }}
          style={{ width: '100%', height: 46, borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 14, border: `1px solid ${BORDER}`, cursor: 'pointer' }}
        >
          Clear board
        </button>
        <p style={{ fontSize: 11, color: '#52525b', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
          Drag from a dot to its twin. Wires can't cross, and every cell must be filled.
        </p>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WireGame />
  </StrictMode>
);

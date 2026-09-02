import './index.css';

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { isSolvedShuffle } from '../shared/rewire-core';
import { audioCtx } from './audio';
import { WireBoard } from './components/WireBoard';
import { RewireScoreboard } from './rewire-scoreboard';

type BoardData = inferRouterOutputs<AppRouter>['rewire']['getBoard'];
type SubmitOk = Extract<inferRouterOutputs<AppRouter>['rewire']['submit'], { solved: true }>;

const BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const ACCENT = '#38bdf8';
const GRAD = 'linear-gradient(135deg,#0ea5e9,#22d3ee)';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

// Seconds the solved photo is shown before it shatters into level 1.
const PREVIEW_SECONDS = 3;

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, delayMs * (i + 1))); }
  }
  throw new Error('unreachable');
}

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
const sfxSwap = () => tone(500, 0.05, 0.08, 'triangle');
const sfxLevelDone = () => { [660, 990].forEach((f, i) => setTimeout(() => tone(f, 0.12, 0.11), i * 90)); };
const sfxWin = () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.13), i * 95)); };

// ── Level 1: tap-to-swap tile reconstruct ───────────────────────────────────
const TileBoard = ({ w, h, imageUrl, perm, selected, onTap, locked }: {
  w: number; h: number; imageUrl: string; perm: number[]; selected: number | null;
  onTap: (pos: number) => void; locked: boolean;
}) => (
  <div style={{
    display: 'grid', gridTemplateColumns: `repeat(${w}, 1fr)`, gap: 2,
    width: '100%', height: '100%', borderRadius: 14, overflow: 'hidden',
    background: '#0d1626', border: `1px solid ${BORDER}`, boxShadow: '0 10px 34px rgba(0,0,0,0.45)',
  }}>
    {perm.map((tileIdx, pos) => {
      const origRow = Math.floor(tileIdx / w), origCol = tileIdx % w;
      return (
        <div
          key={pos}
          onPointerDown={() => !locked && onTap(pos)}
          style={{
            aspectRatio: '1', cursor: locked ? 'default' : 'pointer',
            backgroundImage: `url(${imageUrl})`,
            backgroundSize: `${w * 100}% ${h * 100}%`,
            backgroundPosition: `${(origCol / (w - 1)) * 100}% ${(origRow / (h - 1)) * 100}%`,
            outline: selected === pos ? `3px solid ${ACCENT}` : '1px solid rgba(0,0,0,0.35)',
            outlineOffset: -2,
          }}
        />
      );
    })}
  </div>
);

export const RewireGame = () => {
  const [data, setData] = useState<BoardData | null>(null);
  const [error, setError] = useState(false);
  const [phase, setPhase] = useState<'preview' | 'level1' | 'level2' | 'result'>('preview');
  const [countdown, setCountdown] = useState(PREVIEW_SECONDS);

  const [perm, setPerm] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [l1Swaps, setL1Swaps] = useState(0);
  const [l1Elapsed, setL1Elapsed] = useState(0);

  const [routes, setRoutes] = useState<number[][]>([]);
  const [dragColor, setDragColor] = useState<number | null>(null);
  const [l2Moves, setL2Moves] = useState(0);
  const [l2Elapsed, setL2Elapsed] = useState(0);

  const [muted, setMuted] = useState(false);
  const [labels] = useState(false);
  const [result, setResult] = useState<SubmitOk | null>(null);
  const [showLb, setShowLb] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [commentText, setCommentText] = useState('');

  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const l1StartRef = useRef(0);
  const l2StartRef = useRef(0);
  const submittedRef = useRef(false);
  const beganRef = useRef(false);

  useEffect(() => {
    void (async () => {
      try {
        const d = await withRetry(() => trpc.rewire.getBoard.query());
        setData(d);
        setPerm(d.shuffle);
        setRoutes(d.puzzle.pairs.map(() => []));
      } catch {
        setError(true);
      }
    })();
  }, []);

  // Preview countdown, then hand off to level 1.
  useEffect(() => {
    if (phase !== 'preview' || !data) return;
    if (countdown <= 0) {
      if (!beganRef.current) { beganRef.current = true; void trpc.rewire.begin.mutate().catch(() => {}); }
      l1StartRef.current = Date.now();
      setPhase('level1');
      return;
    }
    const id = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(id);
  }, [phase, countdown, data]);

  useEffect(() => {
    if (phase === 'level1') {
      const id = setInterval(() => setL1Elapsed(Math.floor((Date.now() - l1StartRef.current) / 1000)), 500);
      return () => clearInterval(id);
    }
    if (phase === 'level2') {
      const id = setInterval(() => setL2Elapsed(Math.floor((Date.now() - l2StartRef.current) / 1000)), 500);
      return () => clearInterval(id);
    }
  }, [phase]);

  const tapTile = (pos: number) => {
    if (selected == null) { setSelected(pos); return; }
    if (selected === pos) { setSelected(null); return; }
    const next = [...perm];
    [next[selected], next[pos]] = [next[pos]!, next[selected]!];
    setPerm(next);
    setSelected(null);
    setL1Swaps(n => n + 1);
    if (!muted) sfxSwap();

    if (isSolvedShuffle(next)) {
      if (!muted) sfxLevelDone();
      void trpc.rewire.finishLevel1.mutate().catch(() => {});
      l2StartRef.current = Date.now();
      setPhase('level2');
    }
  };

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
  const solvedLocally = phase === 'level2' && allPairsJoined && filled === cells;

  const submit = async (finalRoutes: number[][], moveCount: number) => {
    if (submittedRef.current || !puzzle) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      const r = await trpc.rewire.submit.mutate({
        l1Swaps,
        routes: finalRoutes.map((c, color) => ({ color, cells: c })).filter(r2 => r2.cells.length > 1),
        l2Moves: moveCount,
      });
      if (r.solved) {
        if (!mutedRef.current) sfxWin();
        setResult(r);
        setPhase('result');
      } else {
        submittedRef.current = false;
        void showToast({ text: 'That board is not complete yet.', appearance: 'neutral' });
      }
    } catch {
      submittedRef.current = false;
      void showToast({ text: 'Could not submit — try again.', appearance: 'neutral' });
    } finally { setSubmitting(false); }
  };

  useEffect(() => {
    if (solvedLocally && !submittedRef.current) void submit(routes, l2Moves);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solvedLocally]);

  const postScore = async () => {
    if (!result || posting || posted) return;
    setPosting(true);
    try {
      await trpc.rewire.postComment.mutate({
        text: commentText, score: result.score,
        l1TimeSec: result.l1TimeSec, l1Swaps: result.l1Swaps,
        l2TimeSec: result.l2TimeSec, l2Moves: result.l2Moves,
        userRank: result.userRank, playerCount: result.playerCount,
      });
      setPosted(true);
    } catch { void showToast({ text: 'Could not post.', appearance: 'neutral' }); }
    finally { setPosting(false); }
  };

  if (error) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: BG, color: '#f87171', padding: 16, textAlign: 'center' }}>Failed to load. Please refresh.</div>;
  if (!data || !puzzle) return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: BG, color: '#a1a1aa' }}>Loading…</div>;
  if (showLb) return <RewireScoreboard onClose={() => setShowLb(false)} />;

  const { w, h } = puzzle;

  // ── Preview ────────────────────────────────────────────────────────────────
  if (phase === 'preview') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 20 }}>
        <p style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.14em', color: '#71717a', margin: 0, textTransform: 'uppercase' }}>Memorize it</p>
        <div style={{ width: 'min(80vw, 340px)', aspectRatio: `${w} / ${h}`, borderRadius: 14, overflow: 'hidden', border: `1px solid ${BORDER}`, boxShadow: '0 10px 34px rgba(0,0,0,0.45)' }}>
          <img src={data.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
        <p style={{ fontSize: 40, fontWeight: 900, margin: 0, color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>{countdown}</p>
      </div>
    );
  }

  // ── Result ──────────────────────────────────────────────────────────────────
  if (phase === 'result' && result) {
    return (
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
        <button onClick={() => setShowLb(true)} aria-label="Leaderboard"
          style={{ position: 'absolute', top: 12, right: 14, zIndex: 3, width: 40, height: 40, borderRadius: '50%', border: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.06)', cursor: 'pointer', fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🏆</button>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '18px 18px 16px', maxWidth: 420, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: '#71717a', margin: 0 }}>REWIRED IN</p>
            <p style={{ fontSize: 46, fontWeight: 900, margin: 0, lineHeight: 1.05, background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(result.l1TimeSec + result.l2TimeSec)}</p>
            <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginTop: 8, padding: '5px 14px', borderRadius: 999, background: CARD, border: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 15, fontWeight: 900 }}>{result.score} pts</span>
              {result.topPct != null && <><span style={{ color: '#3f3f46' }}>·</span><span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>Top {result.topPct}%</span></>}
            </div>
            <p style={{ fontSize: 11, color: '#71717a', margin: '10px 0 0' }}>
              🧩 Level 1: {fmtTime(result.l1TimeSec)} · {result.l1Swaps} swaps &nbsp;·&nbsp; 🔌 Level 2: {fmtTime(result.l2TimeSec)} · {result.l2Moves} wires
            </p>
            {result.userRank != null && <p style={{ fontSize: 10, color: '#52525b', margin: '6px 0 0' }}>🏅 #{result.userRank} of {result.playerCount} solvers</p>}
          </div>

          <div style={{ flex: 1, minHeight: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '14px 0', overflow: 'hidden' }}>
            <div style={{ height: '100%', maxHeight: '100%', maxWidth: '100%', aspectRatio: `${w} / ${h}` }}>
              <WireBoard puzzle={puzzle} colors={data.colors} routes={routes} dragColor={null} onRoutes={() => {}} onDragEnd={() => {}} locked labels={labels} backgroundImage={data.imageUrl} />
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

  // ── Level 1 ────────────────────────────────────────────────────────────────
  if (phase === 'level1') {
    const solvedCount = perm.filter((v, i) => v === i).length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
        <div style={{ flexShrink: 0, padding: '12px 16px 6px', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 19, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
              Level 1 <span style={{ color: '#71717a', fontWeight: 700, fontSize: 13 }}>· Rebuild the photo</span>
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: '4px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
              <p style={{ fontSize: 15, fontWeight: 900, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(l1Elapsed)}</p>
              <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.14em', color: '#71717a', margin: 0 }}>TIME</p>
            </div>
            <button onClick={() => setMuted(m => !m)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#71717a', fontSize: 15 }}>{muted ? '🔇' : '🔊'}</button>
          </div>
        </div>

        <p style={{ flexShrink: 0, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#a1a1aa', margin: '4px 0 8px' }}>
          <span style={{ color: ACCENT }}>{solvedCount}/{cells}</span> tiles in place · {l1Swaps} swaps · Tap two tiles to swap them
        </p>

        <div style={{ flex: 1, minHeight: 0, minWidth: 0, containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 14px' }}>
          <div style={{ width: `min(100cqw, 440px, calc(100cqh * ${w} / ${h}))`, aspectRatio: `${w} / ${h}` }}>
            <TileBoard w={w} h={h} imageUrl={data.imageUrl} perm={perm} selected={selected} onTap={tapTile} locked={false} />
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: '12px 16px 16px', maxWidth: 360, margin: '0 auto', width: '100%' }}>
          <p style={{ fontSize: 11, color: '#52525b', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
            Rebuild the photo, then connect the dots that appear on it.
          </p>
        </div>
      </div>
    );
  }

  // ── Level 2 ────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: '12px 16px 6px', maxWidth: 480, margin: '0 auto', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ fontSize: 19, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>
            Level 2 <span style={{ color: '#71717a', fontWeight: 700, fontSize: 13 }}>· Connect the dots</span>
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ padding: '4px 12px', borderRadius: 10, background: CARD, border: `1px solid ${BORDER}`, textAlign: 'center' }}>
            <p style={{ fontSize: 15, fontWeight: 900, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(l2Elapsed)}</p>
            <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.14em', color: '#71717a', margin: 0 }}>TIME</p>
          </div>
          <button onClick={() => setShowLb(true)} aria-label="Leaderboard" style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 17 }}>🏆</button>
          <button onClick={() => setMuted(m => !m)} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#71717a', fontSize: 15 }}>{muted ? '🔇' : '🔊'}</button>
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
        <div style={{ width: `min(100cqw, 440px, calc(100cqh * ${w} / ${h}))`, aspectRatio: `${w} / ${h}` }}>
          <WireBoard
            puzzle={puzzle} colors={data.colors} routes={routes} dragColor={dragColor}
            onRoutes={(r, dc) => { setRoutes(r); setDragColor(dc); }}
            onDragEnd={drew => { setDragColor(null); if (drew) setL2Moves(n => n + 1); }}
            locked={submitting}
            muted={muted}
            labels={labels}
            hintEmpty={allPairsJoined && filled < cells}
            backgroundImage={data.imageUrl}
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
    <RewireGame />
  </StrictMode>
);

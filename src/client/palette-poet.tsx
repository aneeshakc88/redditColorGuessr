import './index.css';

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { WheelPicker } from './components/WheelPicker';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { ppRoundMax, ppScoreFrac } from '../shared/palette-poet-core';

type GameData = inferRouterOutputs<AppRouter>['palettePoet']['getGame'];
type LbData = inferRouterOutputs<AppRouter>['palettePoet']['getLeaderboard'];
type GameState = 'loading' | 'playing' | 'submitted' | 'completed' | 'leaderboard' | 'error';

type RoundResult = {
  roundIndex: number;
  colorName: string;
  colorDescription: string;
  actualHex: string;
  guessHex: string;
  score: number;
  max: number;
};

// ── Shared helpers (same as game.tsx) ────────────────────────────────────────

function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const lin = (c: number) => c > 0.04045 ? Math.pow((c+0.055)/1.055, 2.4) : c/12.92;
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const x = (rl*0.4124+gl*0.3576+bl*0.1805)/0.95047, y = (rl*0.2126+gl*0.7152+bl*0.0722)/1.00000, z = (rl*0.0193+gl*0.1192+bl*0.9505)/1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787*t+16/116;
  return [116*f(y)-16, 500*(f(x)-f(y)), 200*(f(y)-f(z))];
}

function calcScore(actualHex: string, guessHex: string, maxScore: number): number {
  const [l1,a1,b1] = hexToLab(actualHex), [l2,a2,b2] = hexToLab(guessHex);
  const de = Math.sqrt((l1-l2)**2+(a1-a2)**2+(b1-b2)**2);
  return Math.min(maxScore, Math.max(0, Math.round((1-Math.min(de,100)/100)*maxScore)));
}

function scoreToHex(score: number, max: number): string {
  const frac = ppScoreFrac(score, max);
  if (frac >= 0.85) return '#538d4e';
  if (frac >= 0.65) return '#b59f3b';
  if (frac >= 0.45) return '#e67e22';
  return '#c0392b';
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1200): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { if (i === retries-1) throw e; await new Promise(r => setTimeout(r, delayMs*(i+1))); }
  }
  throw new Error('unreachable');
}

// ── Audio (same as game.tsx) ──────────────────────────────────────────────────

let gameCtx: AudioContext | null = null;
function getGameCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!gameCtx) gameCtx = new AC();
    if (gameCtx.state === 'suspended') void gameCtx.resume();
    return gameCtx;
  } catch { return null; }
}
function playClick() {
  try {
    const ctx = getGameCtx(); if (!ctx) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(820, t); osc.frequency.exponentialRampToValueAtTime(220, t+0.09);
    gain.gain.setValueAtTime(0.18, t); gain.gain.exponentialRampToValueAtTime(0.0001, t+0.1);
    osc.start(t); osc.stop(t+0.11);
  } catch { /* noop */ }
}
function playCountTick(progress: number) {
  try {
    const ctx = getGameCtx(); if (!ctx) return;
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination); osc.type = 'sine';
    osc.frequency.value = 1000-progress*380;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.05, t); gain.gain.exponentialRampToValueAtTime(0.0001, t+0.018);
    osc.start(t); osc.stop(t+0.02);
  } catch { /* noop */ }
}

// ── Icons ────────────────────────────────────────────────────────────────────

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted ? (<><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>) : (<><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>)}
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

// ── Split tile (reused from game.tsx) ─────────────────────────────────────────

const TILE_GAP = 8;
const TILE_LABEL = 14;
const TILE_CAP = 150;
const TILE_MIN = 24;

function useBoxSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const roRef = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    const ro = new ResizeObserver(es => {
      const cr = es[0]!.contentRect;
      setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  return [ref, size] as const;
}

const SplitTile = ({ result, size }: { result: RoundResult; size: number }) => (
  <div className="flex shrink-0 flex-col items-center gap-1" style={{ width: size }}>
    <div className="relative w-full shrink-0 overflow-hidden rounded-xl" style={{ height: size }}>
      <div className="absolute inset-0" style={{ backgroundColor: result.actualHex }} />
      <div className="absolute inset-0" style={{ backgroundColor: result.guessHex, clipPath: 'polygon(100% 0, 100% 100%, 0 0)' }} />
      <span className="absolute bottom-1 left-1.5 text-xs font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{result.score}</span>
      <span className="absolute right-1 top-1 text-[8px] font-bold text-white/70" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>you</span>
    </div>
    <p className="w-full shrink-0 truncate text-center text-[9px] font-medium leading-none text-gray-400">{result.colorName}</p>
  </div>
);

// ── Avatar helpers (copied from splash.tsx) ────────────────────────────────────

const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#a855f7'];
const InitialAvatar = ({ name, size = 28 }: { name: string; size?: number }) => {
  const bg = AVATAR_COLORS[name.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % AVATAR_COLORS.length]!;
  return <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size*0.4, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{name[0]?.toUpperCase()}</div>;
};
const UserAvatar = ({ name, url, size = 28 }: { name: string; url?: string | undefined; size?: number }) =>
  url ? <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none';}} />
      : <InitialAvatar name={name} size={size} />;

// ── Leaderboard ───────────────────────────────────────────────────────────────

const Leaderboard = ({ onClose }: { onClose: () => void }) => {
  const [data, setData] = useState<LbData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.palettePoet.getLeaderboard.query()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const entries = data?.entries ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const podium = [entries[1], entries[0], entries[2]] as (typeof entries[number] | undefined)[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid #f3f4f6' }}>
        <h2 style={{ fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em', color: '#111', margin: 0 }}>Leaderboard</h2>
        <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #e5e7eb', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#6b7280' }}>✕</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#9ca3af' }}>No scores yet. Be the first to play!</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
          {/* Podium */}
          <div style={{ margin: '14px 16px 6px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {podium.map((entry, podiumIdx) => {
              const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              return entry ? (
                <div key={entry.member} style={{ flex: isFirst ? 1.4 : 1, background: isFirst ? '#fff7ed' : '#f9fafb', border: isFirst ? '1.5px solid #fed7aa' : '1.5px solid #e5e7eb', borderRadius: 16, padding: '12px 8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, outline: isMe ? '2px solid #ea580c' : undefined }}>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34} />
                  <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? '#ea580c' : '#6b7280', margin: 0 }}>{rank}</p>
                  {entry.isFounder && <span style={{ fontSize: 10 }}>⭐</span>}
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#374151', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <span style={{ background: isFirst ? '#ea580c' : '#e5e7eb', color: isFirst ? '#fff' : '#6b7280', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px' }}>{entry.score}</span>
                </div>
              ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
            })}
          </div>

          {/* Your rank */}
          {username && data?.userRank != null && (
            <div style={{ margin: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, background: '#fff7ed', borderRadius: 12, padding: '9px 14px', border: '1px solid #fed7aa' }}>
              <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#9ca3af', margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
              <UserAvatar name={username} url={snoovatars[username]} size={26} />
              <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: '#111', margin: 0 }}>#{data.userRank}</p>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#ea580c', margin: 0 }}>{data.userScore}/100</p>
            </div>
          )}

          {/* Rest of list */}
          <div style={{ paddingBottom: 16 }}>
            {entries.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              return (
                <div key={entry.member} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: isMe ? '#fff7ed' : 'transparent', borderLeft: isMe ? '3px solid #ea580c' : '3px solid transparent' }}>
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#9ca3af', margin: 0 }}>{rank}</p>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  {entry.isFounder && <span style={{ fontSize: 10 }}>⭐</span>}
                  <p style={{ flex: 1, fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#111' : '#374151', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? '#ea580c' : '#6b7280', margin: 0 }}>{entry.score}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

// Mirrors the wheel's own viewport-driven sizing: shrink fixed-size text/spacing
// first as the viewport gets short, with scroll as the fallback for the rest.
const useViewport = () => {
  const [vp, setVp] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);
  return vp;
};

// ── Main App ──────────────────────────────────────────────────────────────────

export const PalettePoetGame = () => {
  const { h: vpH } = useViewport();
  const shortVp = vpH < 620;
  const xshortVp = vpH < 480;
  const [gameState, setGameState] = useState<GameState>('loading');
  const [puzzleData, setPuzzleData] = useState<GameData | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedColor, setSelectedColor] = useState('#228B22');
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [displayScore, setDisplayScore] = useState(0);
  const [roundMessage, setRoundMessage] = useState('');
  const [muted, setMuted] = useState(false);
  const [commentPosted, setCommentPosted] = useState(false);
  const [commentPosting, setCommentPosting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [tileBoxRef, tileBox] = useBoxSize<HTMLDivElement>();
  const [replayMode, setReplayMode] = useState(false);
  const animFrameRef = useRef<number>(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  useEffect(() => {
    withRetry(() => trpc.palettePoet.getGame.query())
      .then(data => {
        setPuzzleData(data);
        if (data.completed) {
          setReplayMode(true);
          setCurrentRound(0);
          setGameState('playing');
        } else if (data.completedRounds > 0) {
          setCurrentRound(data.completedRounds);
          setGameState('playing');
        } else {
          setGameState('playing');
        }
      })
      .catch(() => setGameState('error'));
  }, []);

  const animateScore = (target: number) => {
    cancelAnimationFrame(animFrameRef.current);
    setDisplayScore(0);
    const t0 = performance.now();
    const duration = 1100;
    let lastTick = 0;
    const tick = (now: number) => {
      const p = Math.min((now-t0)/duration, 1);
      setDisplayScore((1-Math.pow(1-p,3))*target);
      if (!mutedRef.current && p < 0.98 && now-lastTick > 55) { lastTick = now; playCountTick(p); }
      if (p < 1) animFrameRef.current = requestAnimationFrame(tick);
      else setDisplayScore(target);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const handleSubmit = () => {
    if (!mutedRef.current) playClick();
    if (!puzzleData) return;
    const colorData = puzzleData.colors[currentRound];
    if (!colorData) return;

    const max = ppRoundMax(puzzleData.colors.length, currentRound);
    const score = calcScore(colorData.hex, selectedColor, max);
    const newResult: RoundResult = { roundIndex: currentRound, colorName: colorData.name, colorDescription: colorData.description, actualHex: colorData.hex, guessHex: selectedColor, score, max };
    setRoundResult(newResult);
    setRoundResults(prev => [...prev, newResult]);
    setDisplayScore(0);
    const frac = ppScoreFrac(score, max);
    setRoundMessage(frac >= 0.85 ? 'Uncanny — your eyes are sharp.' : frac >= 0.65 ? 'Really close! Nice color sense.' : frac >= 0.45 ? 'Decent match. The shade had other plans.' : frac >= 0.25 ? 'Not quite. The color politely disagrees.' : 'Wildly off. Respect for trying.');
    setGameState('submitted');
    setTimeout(() => animateScore(score), 110);

    if (!replayMode) {
      trpc.palettePoet.submitGuess.mutate({ roundIndex: currentRound, guessHex: selectedColor })
        .catch(() => void showToast({ text: 'Failed to save progress.', appearance: 'neutral' }));
    }
  };

  const handleContinue = () => {
    if (!mutedRef.current) playClick();
    if (!puzzleData || !roundResult) return;
    cancelAnimationFrame(animFrameRef.current);
    if (roundResult.roundIndex + 1 >= puzzleData.colors.length) {
      setGameState('completed');
      if (!replayMode) {
        const total = [...roundResults, roundResult].reduce((s, r) => s + r.score, 0);
        trpc.palettePoet.saveScore.mutate({ totalScore: total }).catch(() => {});
        trpc.palettePoet.syncScore.mutate().catch(() => {});
      }
    } else {
      setCurrentRound(prev => prev + 1);
      setSelectedColor('#228B22');
      setRoundResult(null);
      setGameState('playing');
    }
  };

  const handleCloseResults = () => {
    setReplayMode(true);
    setGameState('playing');
    setCurrentRound(0);
    setRoundResults([]);
    setRoundResult(null);
    setSelectedColor('#228B22');
    setCommentPosted(false);
  };

  const handlePostComment = async () => {
    if (commentPosted || commentPosting || !puzzleData) return;
    if (!mutedRef.current) playClick();
    setCommentPosting(true);
    const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
    try {
      await trpc.palettePoet.postComment.mutate({
        total,
        rounds: roundResults.map(r => ({ name: r.colorName, score: r.score })),
        text: commentText,
      });
      setCommentPosted(true);
    } catch {
      void showToast({ text: 'Failed to post comment.', appearance: 'neutral' });
    } finally {
      setCommentPosting(false);
    }
  };

  // ── Shared header ──────────────────────────────────────────────────────────

  const Header = ({ label, showClose = false }: { label: string; showClose?: boolean }) => (
    <div className="shrink-0 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-sm items-center justify-between px-4 py-1.5 sm:max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={() => setMuted(m=>!m)} style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <SoundIcon muted={muted} />
          </button>
          <button onClick={() => setGameState('leaderboard')} title="Leaderboard" style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 16 }}>
            🏆
          </button>
          {showClose && (
            <button onClick={handleCloseResults} style={{ width: 28, height: 28, borderRadius: '50%', border: '1.5px solid #e5e7eb', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (gameState === 'loading') return <div className="flex h-screen items-center justify-center bg-white"><p className="text-gray-400">Loading…</p></div>;
  if (gameState === 'error') return <div className="flex h-screen items-center justify-center bg-white p-4"><p className="text-red-600">Failed to load. Please refresh.</p></div>;
  if (gameState === 'leaderboard') return <Leaderboard onClose={() => setGameState(puzzleData?.completed ? 'completed' : 'playing')} />;

  // ── Completed ──────────────────────────────────────────────────────────────
  if (gameState === 'completed' && puzzleData) {
    if (roundResults.length === 0) {
      return (
        <div className="flex h-screen flex-col overflow-hidden bg-white">
          <Header label="Palette Poet" showClose />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '0 24px', textAlign: 'center' }}>
            <p style={{ fontSize: 26, fontWeight: 900, color: '#111' }}>Already played!</p>
            <p style={{ fontSize: 40, fontWeight: 900, color: '#ea580c' }}>{puzzleData.totalScore}<span style={{ fontSize: 18, fontWeight: 600, color: '#9ca3af' }}>/100</span></p>
            {puzzleData.userRank && <p style={{ fontSize: 13, color: '#6b7280' }}>Rank #{puzzleData.userRank} of {puzzleData.totalPlayers}</p>}
            <p style={{ fontSize: 12, color: '#9ca3af' }}>Puzzle by u/{puzzleData.creator}</p>
          </div>
        </div>
      );
    }

    const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
    const { userRank, totalPlayers } = puzzleData;
    const n = roundResults.length;
    const byW = tileBox.w > 0 ? Math.floor((tileBox.w - TILE_GAP * (n - 1)) / n) : TILE_CAP;
    const byH = tileBox.h > 0 ? tileBox.h - TILE_LABEL : TILE_CAP;
    const tileSize = Math.max(TILE_MIN, Math.min(TILE_CAP, byW, byH));

    return (
      <div className="flex flex-col overflow-hidden bg-white" style={{ height: '100dvh' }}>
        <Header label="Palette Poet" />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-3 overflow-hidden px-4 pt-3 pb-3 sm:max-w-lg">

          {/* Score row */}
          <div className="shrink-0" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 40, fontWeight: 900, color: '#ea580c', margin: 0 }}>
                {total}<span style={{ fontSize: 18, fontWeight: 600, color: '#9ca3af' }}>/100</span>
              </p>
              {userRank ? (
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Rank #{userRank} of {totalPlayers} · {puzzleData.creator}'s palette</p>
              ) : (
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Puzzle by u/{puzzleData.creator}</p>
              )}
            </div>
            <button onClick={handleCloseResults} style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid #e5e7eb', background: '#f9fafb', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>
              <CloseIcon />
            </button>
          </div>

          {/* Split tiles — sized to the leftover box so the page never scrolls */}
          <div ref={tileBoxRef} className="flex min-h-0 flex-1 items-center justify-center gap-2 overflow-hidden">
            {roundResults.map(r => <SplitTile key={r.roundIndex} result={r} size={tileSize} />)}
          </div>

          {/* Comment section */}
          <div className="flex shrink-0 flex-col justify-end gap-2.5">
            {!commentPosted ? (
              <>
                <div style={{ borderRadius: 16, background: '#111', padding: '10px 14px' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af', margin: 0 }}>
                    {puzzleData.title ? `"${puzzleData.title}"` : `Palette by u/${puzzleData.creator}`}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    <p style={{ fontSize: 17, fontWeight: 900, color: '#fff', margin: 0 }}>{total}/100</p>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {roundResults.map(r => <div key={r.roundIndex} style={{ width: 20, height: 20, borderRadius: 4, backgroundColor: scoreToHex(r.score, r.max) }} />)}
                    </div>
                  </div>
                </div>
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Add a note… (optional)"
                  maxLength={500}
                  rows={2}
                  className="w-full shrink-0 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-orange-400 focus:outline-none"
                />
                <button
                  onClick={handlePostComment}
                  disabled={commentPosting}
                  className="w-full shrink-0 rounded-full bg-orange-600 px-6 py-3 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-60"
                >
                  {commentPosting ? 'Posting…' : 'Post Score'}
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 16, border: '1px solid #bbf7d0', background: '#f0fdf4', padding: '10px 14px' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#16a34a' }}>✓ Comment posted!</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Submitted ──────────────────────────────────────────────────────────────
  if (gameState === 'submitted' && roundResult && puzzleData) {
    const isLast = roundResult.roundIndex + 1 >= puzzleData.colors.length;
    const s = displayScore;
    const frac = ppScoreFrac(roundResult.score, roundResult.max);
    const fc = frac >= 0.85 ? 'text-green-500' : frac >= 0.6 ? 'text-orange-500' : 'text-red-500';

    return (
      <div className="flex h-screen flex-col overflow-hidden bg-white">
        <Header label={`Round ${roundResult.roundIndex + 1} of ${puzzleData.colors.length}`} />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col overflow-y-auto px-4 sm:max-w-lg">
          <div className="flex flex-[2] flex-col items-center justify-center">
            <p className={`tabular-nums font-black leading-none ${xshortVp ? 'text-3xl' : shortVp ? 'text-4xl' : 'text-5xl'} ${fc}`}>
              {s.toFixed(1)}<span className="text-xl font-semibold text-gray-400">/{roundResult.max}</span>
            </p>
            <p className="mt-2 px-6 text-center text-xs leading-snug text-gray-500">{roundMessage}</p>
          </div>
          <div className="flex flex-[5] flex-col justify-center gap-3 min-h-0">
            <div className="flex shrink-0 overflow-hidden rounded-2xl shadow-md" style={{ height: xshortVp ? 'clamp(80px, 24vh, 200px)' : 'clamp(120px, 28vh, 200px)' }}>
              <div className="flex flex-1 flex-col items-center justify-end pb-2.5" style={{ backgroundColor: roundResult.actualHex }}>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">Actual</span>
              </div>
              <div className="w-px bg-white/30" />
              <div className="flex flex-1 flex-col items-center justify-end pb-2.5" style={{ backgroundColor: roundResult.guessHex }}>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">You</span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '0 4px' }}>
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af', margin: 0 }}>{roundResult.actualHex}</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#111', margin: 0 }}>{roundResult.colorName}</p>
              </div>
              <p style={{ fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}>{roundResult.guessHex}</p>
            </div>
          </div>
          <div className="flex flex-[2] flex-col items-center justify-center">
            <button onClick={handleContinue} className="w-full rounded-full bg-orange-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95">
              {isLast ? 'See Final Score' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Playing ────────────────────────────────────────────────────────────────
  if (!puzzleData) return <div />;
  const colorData = puzzleData.colors[currentRound];

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white">
      <Header label={`Round ${currentRound + 1} / ${puzzleData.colors.length}`} />
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col overflow-y-auto px-4 sm:max-w-lg">

        {/* Zone 1 — Color name + description */}
        <div className="flex flex-[2] flex-col items-center justify-start" style={{ paddingTop: xshortVp ? 4 : 12 }}>
          <p className="mb-1 text-[11px] uppercase tracking-[0.2em] text-gray-400">Guess the color</p>
          <h2
            className="text-center font-black leading-tight"
            style={{
              fontSize: (colorData && colorData.name.length >= 19 ? 32 : 40) - (xshortVp ? 10 : shortVp ? 6 : 0),
              color: selectedColor,
            }}
          >
            {colorData?.name}
          </h2>
          {colorData?.description && !xshortVp && (
            <p style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4, maxWidth: 280 }}>
              {colorData.description}
            </p>
          )}
        </div>

        {/* Zone 2 — Wheel */}
        <div className="relative flex flex-[5] flex-col items-center justify-center gap-3 min-h-0">
          <WheelPicker
            onColorSelected={setSelectedColor}
            selectedColor={selectedColor}
            muted={muted}
          />
          <p className="font-mono text-sm font-semibold tracking-widest text-gray-500">
            {selectedColor.toUpperCase()}
          </p>
        </div>

        {/* Zone 3 — Submit */}
        <div className="flex flex-[2] flex-col items-center justify-center">
          <button
            onClick={handleSubmit}
            className="w-full rounded-full bg-orange-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95"
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PalettePoetGame />
  </StrictMode>
);

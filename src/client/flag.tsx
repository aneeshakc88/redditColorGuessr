import './index.css';

import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { HSBSliders } from './components/HSBSliders';
import { audioCtx } from './audio';
import { swapRegion, regionOutline, regionOutlineRaster, applyOverlay, viewBoxRatio, type Raster } from '../shared/flag-highlight';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
type RouterOutputs = inferRouterOutputs<AppRouter>;
type PuzzleData = RouterOutputs['flag']['getPuzzle'];
type GameState = 'loading' | 'playing' | 'submitted' | 'completed' | 'error';

type RoundResult = {
  roundIndex: number;
  flagName: string;
  actualHex: string;
  guessHex: string;
  score: number;
};

// Rasterize an SVG string offscreen; the raster outline tracer reads the pixels.
async function rasterizeSvg(svg: string, width: number): Promise<Raster> {
  const height = Math.max(2, Math.round(width / viewBoxRatio(svg)));
  const sized = svg.replace(/^<svg/, `<svg width="${width}" height="${height}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('svg rasterize failed'));
      img.src = url;
    });
    const cv = document.createElement('canvas');
    cv.width = width;
    cv.height = height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);
    return { data: ctx.getImageData(0, 0, width, height).data, width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Marching-ants overlay for the hidden region. Computed from the original svg +
// hidden hex (not the guess-swapped svg) so it never shifts when the guess colour
// matches another region. Rectilinear flags resolve sync; the rest rasterize async.
function useRegionOutline(svg: string | undefined, hex: string, idx?: number[]): string | null {
  const key = idx ? idx.join(',') : '';
  const sync = useMemo(() => (svg ? regionOutline(svg, hex, idx) : null), [svg, hex, idx]);
  const [rastered, setRastered] = useState<{ key: string; overlay: string } | null>(null);
  useEffect(() => {
    if (!svg || sync !== null) return;
    let live = true;
    regionOutlineRaster(svg, hex, rasterizeSvg, idx)
      .then((o) => { if (live) setRastered({ key: svg + hex + key, overlay: o }); })
      .catch(() => {});
    return () => { live = false; };
  }, [svg, hex, idx, key, sync]);
  return sync ?? (svg && rastered?.key === svg + hex + key ? rastered.overlay : null);
}

function FlagImg({ svg, hiddenHex, hiddenIdx, swapHex, height, editable }: { svg: string; hiddenHex: string; hiddenIdx?: number[] | undefined; swapHex?: string; height: number; editable?: boolean }) {
  const overlay = useRegionOutline(editable ? svg : undefined, hiddenHex, hiddenIdx);
  let out = swapHex ? swapRegion(svg, hiddenHex, swapHex, hiddenIdx) : svg;
  if (editable) out = applyOverlay(out, overlay);
  const ratio = viewBoxRatio(svg);
  return (
    <div
      className="shrink-0 overflow-hidden rounded-lg [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
      style={{
        height,
        width: Math.round(height * ratio),
        aspectRatio: String(ratio),
        maxWidth: '100%',
        boxShadow: '0 0 0 1px rgba(0,0,0,0.14), 0 8px 22px rgba(0,0,0,0.28)',
      }}
      dangerouslySetInnerHTML={{ __html: out }}
    />
  );
}

// ── Scoring (Lab ΔE, same as sibling games) ────────────────────────────────────

function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)];
  const x = (rl * 0.4124 + gl * 0.3576 + bl * 0.1805) / 0.95047;
  const y = (rl * 0.2126 + gl * 0.7152 + bl * 0.0722) / 1.00000;
  const z = (rl * 0.0193 + gl * 0.1192 + bl * 0.9505) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function calcScore(actualHex: string, guessHex: string): number {
  const [l1, a1, b1] = hexToLab(actualHex), [l2, a2, b2] = hexToLab(guessHex);
  const de = Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
  return Math.min(20, Math.max(0, Math.round((1 - Math.min(de, 100) / 100) * 20)));
}

// ── Messages ────────────────────────────────────────────────────────────────

const ROUND_MSGS: Record<string, string[]> = {
  perfect: ['Flag expert. Scary accurate.', 'Perfect. Vexillologist detected.', 'Dead on. You know that flag cold.', 'Uncanny colour memory.'],
  great: ['Solid flag knowledge.', 'Sharp eye for the shade.', 'You know your flags.', 'Nearly nailed it.'],
  decent: ['Close enough.', 'You had the right idea.', 'Not bad — a fair guess.', 'The flag forgives you.'],
  bad: ['Colour memory needs work.', 'Bold choice. Wrong, but bold.', 'The flag committee frowns.', 'Were you guessing blind?'],
  terrible: ['Never seen this flag before?', 'Impressively off.', 'That flag is embarrassed.', 'Way off the mark.'],
};

function getRoundMsg(score: number): string {
  const key = score >= 20 ? 'perfect' : score >= 14 ? 'great' : score >= 9 ? 'decent' : score >= 4 ? 'bad' : 'terrible';
  const pool = ROUND_MSGS[key]!;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

const TOTAL_MSGS: Record<string, string[]> = {
  masterful: ['Flag encyclopedia. Remarkable.', 'You know every stripe and shade.', 'A cartographer’s eye for colour.'],
  great: ['Solid flag knowledge.', 'You’ve seen enough flags.', 'Above-average colour recall.'],
  decent: ['Some flags stumped you. Fair.', 'A mid-table performance.', 'Room to improve tomorrow.'],
  bad: ['The flags got the better of you.', 'More globe-spinner than geographer.', 'Tomorrow is another map.'],
  terrible: ['Back to the atlas.', 'The colours escaped you today.', 'The flagpole weeps.'],
};

function getTotalMsg(score: number): string {
  const key = score >= 85 ? 'masterful' : score >= 60 ? 'great' : score >= 40 ? 'decent' : score >= 20 ? 'bad' : 'terrible';
  const pool = TOTAL_MSGS[key]!;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// ── Audio ──────────────────────────────────────────────────────────────────

function playClick() {
  try {
    const ctx = audioCtx(); if (!ctx) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(820, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.start(t); osc.stop(t + 0.11);
  } catch { /* ignore */ }
}

function playCountTick(progress: number) {
  try {
    const ctx = audioCtx(); if (!ctx) return;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 1000 - progress * 380;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    osc.start(t); osc.stop(t + 0.02);
  } catch { /* ignore */ }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1200): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

function scoreToHex(score: number): string {
  if (score >= 17) return '#538d4e';
  if (score >= 13) return '#b59f3b';
  if (score >= 9) return '#e67e22';
  return '#c0392b';
}


const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted
      ? (<><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>)
      : (<><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>)
    }
  </svg>
);

const SplitTile = ({ result }: { result: RoundResult }) => (
  <div className="flex flex-1 flex-col items-center gap-1.5 min-w-0">
    <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: '1' }}>
      <div className="absolute inset-0" style={{ backgroundColor: result.actualHex }} />
      <div className="absolute inset-0" style={{ backgroundColor: result.guessHex, clipPath: 'polygon(100% 0, 100% 100%, 0 0)' }} />
      <span className="absolute bottom-1 left-1.5 text-xs font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>{result.score}</span>
      <span className="absolute right-1 top-1 text-[8px] font-bold text-white/70" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>you</span>
    </div>
    <p className="w-full truncate text-center text-[9px] font-medium text-gray-400">{result.flagName}</p>
  </div>
);

// ── App ──────────────────────────────────────────────────────────────────────

export const App = () => {
  const [gameState, setGameState] = useState<GameState>('loading');
  const [puzzleData, setPuzzleData] = useState<PuzzleData | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedColor, setSelectedColor] = useState('#808080');
  const [roundResult, setRoundResult] = useState<RoundResult | null>(null);
  const [roundResults, setRoundResults] = useState<RoundResult[]>([]);
  const [muted, setMuted] = useState(false);
  const [displayScore, setDisplayScore] = useState(0);
  const [roundMessage, setRoundMessage] = useState('');
  const [gameMessage, setGameMessage] = useState('');
  const [commentPosted, setCommentPosted] = useState(false);
  const [commentPosting, setCommentPosting] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replayMode, setReplayMode] = useState(false);
  const animFrameRef = useRef<number>(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  const pickerBoxRef = useRef<HTMLDivElement>(null);
  const flagColRef = useRef<HTMLDivElement>(null);
  const flagBoxRef = useRef<HTMLDivElement>(null);
  const [flagColW, setFlagColW] = useState(0);
  const [flagBoxH, setFlagBoxH] = useState(0);
  const [viewportH, setViewportH] = useState(() => window.innerHeight);
  const [viewportW, setViewportW] = useState(() => window.innerWidth);
  const compact = viewportH < 560;
  const tiny = viewportH < 470;
  const isDesktop = viewportW >= 768;

  useEffect(() => {
    const onResize = () => { setViewportH(window.innerHeight); setViewportW(window.innerWidth); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    const col = flagColRef.current, box = flagBoxRef.current;
    if (!col) return;
    const update = () => {
      setFlagColW(col.clientWidth);
      if (box) setFlagBoxH(box.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(col);
    if (box) ro.observe(box);
    return () => ro.disconnect();
  }, [gameState]);

  useEffect(() => {
    withRetry(() => trpc.flag.getPuzzle.query())
      .then(data => {
        setPuzzleData(data);
        if (data.gauntlet) {
          // Dev post: page through every flag, nothing written back to the server.
          setReplayMode(true);
          setCurrentRound(0);
          setSelectedColor(data.rounds[0]!.wrongHex);
          setGameState('playing');
        } else if (data.completed) {
          setReplayMode(true);
          setCurrentRound(0);
          setSelectedColor(data.rounds[0]!.wrongHex);
          setGameState('playing');
        } else {
          const start = data.completedRounds;
          setCurrentRound(start);
          setSelectedColor(data.rounds[Math.min(start, data.rounds.length - 1)]!.wrongHex);
          setGameState('playing');
        }
      })
      .catch(() => setGameState('error'));
  }, []);

  const animateScore = (target: number) => {
    cancelAnimationFrame(animFrameRef.current);
    setDisplayScore(0);
    const t0 = performance.now(), duration = 1100;
    let lastTick = 0;
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      setDisplayScore((1 - Math.pow(1 - p, 3)) * target);
      if (!mutedRef.current && p < 0.98 && now - lastTick > 55) { lastTick = now; playCountTick(p); }
      if (p < 1) animFrameRef.current = requestAnimationFrame(tick);
      else setDisplayScore(target);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const handleSubmit = () => {
    if (!mutedRef.current) playClick();
    if (!puzzleData) return;
    const round = puzzleData.rounds[currentRound];
    if (!round) return;

    const score = calcScore(round.hiddenHex, selectedColor);
    const newResult: RoundResult = {
      roundIndex: currentRound,
      flagName: round.flagName,
      actualHex: round.hiddenHex,
      guessHex: selectedColor,
      score,
    };
    setRoundResult(newResult);
    setRoundResults(prev => [...prev, newResult]);
    setRoundMessage(getRoundMsg(score));
    setDisplayScore(0);
    setGameState('submitted');
    setTimeout(() => animateScore(score), 110);

    if (!replayMode) {
      trpc.flag.submitGuess.mutate({ roundIndex: currentRound, guessHex: selectedColor })
        .catch(() => void showToast({ text: 'Failed to save progress.', appearance: 'neutral' }));
    }
  };

  const handleContinue = () => {
    if (!mutedRef.current) playClick();
    if (!puzzleData || !roundResult) return;
    cancelAnimationFrame(animFrameRef.current);
    if (roundResult.roundIndex + 1 >= puzzleData.rounds.length) {
      const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
      setGameMessage(getTotalMsg(total));
      setGameState('completed');
    } else {
      const next = currentRound + 1;
      setCurrentRound(next);
      setSelectedColor(puzzleData.rounds[next]!.wrongHex);
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
    if (puzzleData) setSelectedColor(puzzleData.rounds[0]!.wrongHex);
    setCommentPosted(false);
  };

  const handlePostComment = async () => {
    if (commentPosted || commentPosting || !puzzleData) return;
    if (!mutedRef.current) playClick();
    setCommentPosting(true);
    const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
    try {
      await trpc.flag.postComment.mutate({
        text: commentText,
        total,
        rounds: roundResults.map(r => ({ flagName: r.flagName, score: r.score })),
      });
      setCommentPosted(true);
    } catch {
      void showToast({ text: 'Failed to post comment.', appearance: 'neutral' });
    } finally {
      setCommentPosting(false);
    }
  };

  const stepGauntlet = (delta: number) => {
    if (!puzzleData) return;
    const next = Math.min(puzzleData.rounds.length - 1, Math.max(0, currentRound + delta));
    setCurrentRound(next);
    setSelectedColor(puzzleData.rounds[next]!.wrongHex);
    setRoundResult(null);
    setGameState('playing');
  };

  const Header = ({ label, showClose = false, nav = false }: { label: string; showClose?: boolean; nav?: boolean }) => (
    <div className="shrink-0 border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
      <div className="mx-auto flex max-w-sm items-center justify-between px-4 py-1.5 sm:max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
        <div className="flex items-center gap-1.5">
          {nav && (
            <>
              <button onClick={() => stepGauntlet(-1)} className="h-7 rounded-full px-2 text-lg leading-none text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Previous flag">‹</button>
              <button onClick={() => stepGauntlet(1)} className="h-7 rounded-full px-2 text-lg leading-none text-gray-400 hover:text-gray-700 dark:hover:text-gray-200" aria-label="Next flag">›</button>
            </>
          )}
          <button
            onClick={() => setMuted(m => !m)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            <SoundIcon muted={muted} />
          </button>
          {showClose && (
            <button onClick={handleCloseResults} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close">
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  if (gameState === 'loading') return (
    <div className="flex h-dvh items-center justify-center bg-white dark:bg-gray-900">
      <p className="text-gray-500 dark:text-gray-400">Loading puzzle…</p>
    </div>
  );

  if (gameState === 'error') return (
    <div className="flex h-dvh items-center justify-center bg-white dark:bg-gray-900 p-4">
      <p className="text-red-600">Failed to load game. Please refresh.</p>
    </div>
  );

  // ── Completed ──────────────────────────────────────────────────────────────
  if (gameState === 'completed' && puzzleData) {
    if (roundResults.length === 0) {
      return (
        <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-gray-900">
          <Header label="Flag ColorGuessr" showClose />
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white">Already Done!</h1>
            <p className="text-4xl font-black text-blue-600 tabular-nums">
              {puzzleData.totalScore}<span className="text-xl font-semibold text-gray-400">/100</span>
            </p>
            <p className="text-xs text-gray-400">Come back tomorrow for new flags!</p>
          </div>
        </div>
      );
    }

    const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-gray-900">
        <Header label="Final Score" />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 px-4 pt-4 pb-4 sm:max-w-lg">
          <div className="flex shrink-0 items-start justify-between">
            <div>
              <p className="text-4xl font-black text-blue-600 tabular-nums">
                {total}<span className="text-xl font-semibold text-gray-400">/100</span>
              </p>
              <p className="mt-1.5 text-sm leading-snug text-gray-600 dark:text-gray-400">{gameMessage}</p>
            </div>
            <button
              onClick={handleCloseResults}
              className="ml-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-gray-500 transition-all hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 active:scale-95 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="flex shrink-0 gap-2">
            {roundResults.map(r => <SplitTile key={r.roundIndex} result={r} />)}
          </div>

          <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5">
            {!commentPosted ? (
              <>
                <div className="shrink-0 rounded-2xl bg-gray-900 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <p className="text-base font-black tabular-nums text-white">{total}/100</p>
                    <div className="flex gap-1.5">
                      {roundResults.map(r => (
                        <div key={r.roundIndex} className="h-5 w-5 rounded-[4px]" style={{ backgroundColor: scoreToHex(r.score) }} />
                      ))}
                    </div>
                  </div>
                </div>
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Add a note… (optional)"
                  maxLength={500}
                  rows={2}
                  className="w-full shrink-0 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-blue-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                />
                <button
                  onClick={handlePostComment}
                  disabled={commentPosting}
                  className="w-full shrink-0 rounded-full bg-blue-600 px-6 py-3 text-base font-bold text-white transition-all hover:bg-blue-700 active:scale-95 disabled:opacity-60"
                >
                  {commentPosting ? 'Posting…' : 'Comment My Score'}
                </button>
              </>
            ) : (
              <div className="flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800/40 dark:bg-green-900/20">
                <span className="text-sm font-semibold text-green-600 dark:text-green-400">✓ Comment posted!</span>
              </div>
            )}
            <p className="shrink-0 text-center text-xs text-gray-400">Come back tomorrow for new flags!</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Submitted (reveal) ──────────────────────────────────────────────────────
  if (gameState === 'submitted' && roundResult && puzzleData) {
    const isLast = roundResult.roundIndex + 1 >= puzzleData.rounds.length;
    const finalScore = roundResult.score;
    const scoreColor = finalScore >= 18 ? 'text-green-500' : finalScore >= 12 ? 'text-orange-500' : 'text-red-500';
    const round = puzzleData.rounds[roundResult.roundIndex]!;
    const flagHeight = compact ? 84 : 104;

    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-gray-900">
        <Header label={`Round ${roundResult.roundIndex + 1} of ${puzzleData.rounds.length}`} nav={puzzleData.gauntlet} />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col overflow-hidden px-4 sm:max-w-lg">

          <div className="flex flex-[2] flex-col items-center justify-center">
            <p className={`tabular-nums text-5xl font-black leading-none ${scoreColor}`}>
              {displayScore.toFixed(1)}<span className="text-xl font-semibold text-gray-400">/20</span>
            </p>
            <p className="mt-2 px-6 text-center text-xs leading-snug text-gray-500 dark:text-gray-400">{roundMessage}</p>
          </div>

          <div className="flex flex-[5] flex-col items-center justify-center gap-3 min-h-0">
            <FlagImg svg={round.svg} hiddenHex={round.hiddenHex} hiddenIdx={round.hiddenIdx} height={flagHeight} />

            <div className="flex w-full shrink-0 overflow-hidden rounded-2xl shadow-md" style={{ height: 'clamp(52px, 10vh, 84px)' }}>
              <div className="flex flex-1 flex-col items-center justify-end pb-2" style={{ backgroundColor: roundResult.actualHex }}>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">Actual</span>
              </div>
              <div className="w-px bg-white/30" />
              <div className="flex flex-1 flex-col items-center justify-end pb-2" style={{ backgroundColor: roundResult.guessHex }}>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">You</span>
              </div>
            </div>

            <div className="flex w-full items-center justify-between px-1">
              <p className="font-mono text-xs text-gray-400">{roundResult.actualHex}</p>
              <p className="text-sm font-bold text-gray-900 dark:text-white">{round.flagName}</p>
              <p className="font-mono text-xs text-gray-400">{roundResult.guessHex}</p>
            </div>
          </div>

          <div className="sticky bottom-0 shrink-0 bg-white dark:bg-gray-900 pt-2 pb-3">
            <button
              onClick={handleContinue}
              className="w-full rounded-full bg-blue-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-blue-700 active:scale-95 sm:text-lg"
            >
              {isLast ? 'See Final Score' : 'Continue'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Playing ────────────────────────────────────────────────────────────────
  if (!puzzleData) return <div />;
  const round = puzzleData.rounds[currentRound];
  if (!round) return <div />;

  const flagRatio = viewBoxRatio(round.svg);
  // Mobile: flag is the elastic element — it takes whatever height is left after the
  // prompt, sliders, hex and Submit have claimed theirs, so the controls never clip.
  const flagHeight = isDesktop
    ? Math.min(240, flagColW > 0 ? (flagColW * 0.92) / flagRatio : 240)
    : Math.max(32, Math.min(
        200,
        flagBoxH > 0 ? flagBoxH : compact ? 76 : 96,
        flagColW > 0 ? flagColW / flagRatio : Infinity,
      ));

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-white dark:bg-gray-900">
      <Header
        label={puzzleData.gauntlet
          ? `${currentRound + 1}/${puzzleData.rounds.length} · ${flagRatio.toFixed(2)}:1`
          : `Round ${currentRound + 1} / ${puzzleData.rounds.length}`}
        nav={puzzleData.gauntlet}
      />

      <div className="relative mx-auto flex w-full max-w-sm flex-1 flex-col px-4 sm:max-w-lg md:max-w-4xl md:flex-row md:items-center md:gap-12 md:px-10">

        {/* LEFT — prompt + flag */}
        <div ref={flagColRef} className="flex min-h-0 flex-1 flex-col items-center md:min-w-0 md:justify-center">
          <div className={`flex shrink-0 flex-col items-center text-center ${tiny ? 'pt-0.5' : compact ? 'pt-1' : 'pt-3'} md:pt-0`}>
            <p className={`font-semibold leading-tight text-gray-500 dark:text-gray-400 ${tiny ? 'text-xs' : compact ? 'text-sm' : 'text-base'} md:mb-6 md:text-2xl`}>
              One colour is wrong in the{' '}
              <span className="font-black text-gray-900 dark:text-white">{round.flagName}</span>
              {' '}flag — fix it
            </p>
          </div>

          <div
            ref={flagBoxRef}
            className={`flex min-h-0 flex-1 items-center justify-center ${tiny ? 'my-1' : compact ? 'my-1.5' : 'my-3'} md:my-0 md:flex-none`}
          >
            <FlagImg svg={round.svg} hiddenHex={round.hiddenHex} hiddenIdx={round.hiddenIdx} swapHex={selectedColor} height={flagHeight} editable />
          </div>
        </div>

        {/* RIGHT — sliders + hex + submit */}
        <div className="flex shrink-0 flex-col md:min-h-0 md:flex-1 md:justify-center">
          <div ref={pickerBoxRef} className="relative flex shrink-0 flex-col items-center justify-center pt-1 md:min-h-0 md:flex-1">
            <HSBSliders
              onColorSelected={setSelectedColor}
              selectedColor={selectedColor}
              muted={muted}
              compact={tiny}
            />
          </div>

          <p className={`shrink-0 text-center font-mono text-sm font-semibold tracking-widest text-gray-500 dark:text-gray-400 ${compact ? 'py-0' : 'py-1'}`}>
            {selectedColor.toUpperCase()}
          </p>

          <div className={`sticky bottom-0 shrink-0 bg-white dark:bg-gray-900 ${compact ? 'pt-1 pb-1.5' : 'pt-2 pb-3'} md:static`}>
            <button
              onClick={handleSubmit}
              className={`w-full rounded-full bg-blue-600 px-6 font-bold text-white transition-all hover:bg-blue-700 active:scale-95 ${tiny ? 'py-2.5 text-sm' : 'py-3.5 text-base sm:text-lg'}`}
            >
              Submit
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

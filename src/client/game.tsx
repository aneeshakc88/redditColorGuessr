import './index.css';

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { ColorWheel } from './components/ColorWheel';
import { WheelPicker } from './components/WheelPicker';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type GameState = 'loading' | 'playing' | 'submitted' | 'completed' | 'error';

type RoundResult = {
  roundIndex: number;
  colorName: string;
  actualHex: string;
  guessHex: string;
  score: number;
};

function hexToLab(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const lin = (c: number) => c > 0.04045 ? Math.pow((c+0.055)/1.055, 2.4) : c/12.92;
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const x = (rl*0.4124 + gl*0.3576 + bl*0.1805)/0.95047;
  const y = (rl*0.2126 + gl*0.7152 + bl*0.0722)/1.00000;
  const z = (rl*0.0193 + gl*0.1192 + bl*0.9505)/1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787*t + 16/116;
  return [116*f(y)-16, 500*(f(x)-f(y)), 200*(f(y)-f(z))];
}

function calcScore(actualHex: string, guessHex: string): number {
  const [l1,a1,b1] = hexToLab(actualHex), [l2,a2,b2] = hexToLab(guessHex);
  const de = Math.sqrt((l1-l2)**2 + (a1-a2)**2 + (b1-b2)**2);
  return Math.min(20, Math.max(0, Math.round((1 - Math.min(de,100)/100) * 20)));
}

// ── Witty messages by score range ────────────────────────────────────────────

const ROUND_MSGS = {
  perfect: [
    "Exactly right. Are you secretly a Pantone employee?",
    "Your eyes must be factory-calibrated.",
    "Dead on. We're genuinely suspicious of you.",
    "Perfect match. Have you done this before?",
    "A 20/20. That's basically cheating.",
    "Flawless. Your eyes don't make mistakes.",
    "Are you even human? That's uncanny.",
  ],
  nearPerfect: [
    "Nearly pixel-perfect. Your eyes are sharp.",
    "So close to perfect it physically hurts.",
    "One shade off. Still frighteningly good.",
    "Your eyes are suspiciously well-calibrated.",
    "Almost exact. Were you a painter in a past life?",
    "That close and you still missed? Tragically impressive.",
    "Your retinas are working overtime. Impressive.",
  ],
  great: [
    "Solid color sense. You've clearly looked at things before.",
    "Your eye knows what it's doing.",
    "A respectable match. The color is impressed.",
    "Not bad. Not bad at all.",
    "You've got a good eye for this.",
    "Above average. The colors respect you.",
    "Color theory approves of this guess.",
  ],
  decent: [
    "Somewhere in the ballpark.",
    "The vibe was right. The shade, not so much.",
    "Your eyes voted. The color had other plans.",
    "Close-ish. With feeling.",
    "You had the right idea, just the wrong shade.",
    "Points for confidence, if not accuracy.",
    "Your heart was in it. Your eyes, debatable.",
  ],
  meh: [
    "Did you pick that with your eyes closed?",
    "A noble attempt. The color disagrees.",
    "Your eyes and this color are in a dispute.",
    "Somewhere between brave and wrong.",
    "A guess. A bold, colorful guess.",
    "The color tried to meet you halfway. You weren't there.",
    "Not terrible. Also not good.",
    "A valiant effort from the wrong direction.",
  ],
  bad: [
    "That's... a choice.",
    "The color and your guess have agreed to disagree.",
    "In some universe, that might be considered close.",
    "Your eyes lied to you today. Aggressively.",
    "Were you looking at the screen?",
    "A creative interpretation of the color.",
    "The color winced. But it stayed professional.",
  ],
  veryBad: [
    "Did you try to pick the wrong color on purpose?",
    "A bold strategy. Zero points, but bold.",
    "You and the actual color have never met.",
    "Honestly? Impressive how far off that is.",
    "If this were horseshoes, you'd still lose.",
    "The actual color was startled by your guess.",
    "That guess walked in the wrong direction and kept going.",
  ],
  terrible: [
    "Incredible. Perfectly wrong.",
    "You may want to see an ophthalmologist. Soon.",
    "Zero points. Full marks for audacity.",
    "That's almost impressive in reverse.",
    "Scientists want to study your eyes.",
    "The color doesn't even recognize your guess.",
    "Historically bad. Frame this.",
    "Did you guess with your elbow?",
  ],
};

function getRoundMessage(score: number): string {
  let pool: string[];
  if (score === 20) pool = ROUND_MSGS.perfect;
  else if (score >= 17) pool = ROUND_MSGS.nearPerfect;
  else if (score >= 14) pool = ROUND_MSGS.great;
  else if (score >= 11) pool = ROUND_MSGS.decent;
  else if (score >= 8) pool = ROUND_MSGS.meh;
  else if (score >= 5) pool = ROUND_MSGS.bad;
  else if (score >= 2) pool = ROUND_MSGS.veryBad;
  else pool = ROUND_MSGS.terrible;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

const TOTAL_MSGS = {
  masterful: [
    "Chromatic perfection. You were built for this.",
    "Your eyes are a gift to the world of color.",
    "Genuinely flawless. We're in awe.",
    "You've probably argued with designers and won.",
    "A rare talent. The palette bows to you.",
    "This score should be framed and hung in a gallery.",
    "You would win every color argument. Every single one.",
  ],
  excellent: [
    "Your color eye is razor sharp. Seriously impressive.",
    "Near-perfect. Your eyes don't lie.",
    "You clearly know your way around a color wheel.",
    "The colors were trying, but you were better.",
    "Excellent. Most people can't even come close.",
    "A decorator, a designer, or just blessed with great eyes.",
  ],
  good: [
    "Solid work! Your color sense is well above average.",
    "You've got a good eye. A few shades off, but solid.",
    "Respectable. The colors didn't totally beat you.",
    "Above average. That puts you ahead of most.",
    "Your eyes showed up today. Well done.",
    "A reliable performance. Colors, respected.",
  ],
  decent: [
    "Halfway there. The colors gave you a fight.",
    "Decent eye. A few rounds slipped through.",
    "Some rounds were close. Others were... not.",
    "You tried. The colors noted the effort.",
    "Not bad, not great. The Switzerland of color scores.",
    "A solid middle ground. Safe, but unremarkable.",
  ],
  poor: [
    "The colors got the better of you today.",
    "Some of these guesses were brave. All were wrong.",
    "Your eyes need a little calibration.",
    "The colors were harder than expected, and it showed.",
    "Tomorrow's a new puzzle. Just saying.",
    "The colors won this round. There's always tomorrow.",
  ],
  bad: [
    "Your eyes may need professional attention.",
    "The colors were merciless. You, unprepared.",
    "Rough day for the retinas.",
    "The gap between you and the actual colors was notable.",
    "We believe in you. The scores, less so.",
    "You finished. That's something. It really is.",
  ],
  terrible: [
    "You are living proof that eyes are wasted on some people.",
    "The colors are fine. It's the guessing that failed.",
    "Historically bad. And yet, you finished. Respect.",
    "Perhaps a career in color theory isn't in the cards.",
    "These scores should be anonymized for your protection.",
    "Incredible consistency in being confidently wrong.",
    "The colors tried. Your eyes were elsewhere.",
  ],
};

function getTotalMessage(score: number): string {
  let pool: string[];
  if (score >= 90) pool = TOTAL_MSGS.masterful;
  else if (score >= 75) pool = TOTAL_MSGS.excellent;
  else if (score >= 60) pool = TOTAL_MSGS.good;
  else if (score >= 45) pool = TOTAL_MSGS.decent;
  else if (score >= 30) pool = TOTAL_MSGS.poor;
  else if (score >= 15) pool = TOTAL_MSGS.bad;
  else pool = TOTAL_MSGS.terrible;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

// ── Audio ────────────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1200): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error('unreachable');
}

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
    const ctx = getGameCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(820, t);
    osc.frequency.exponentialRampToValueAtTime(220, t + 0.09);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    osc.start(t); osc.stop(t + 0.11);
  } catch { /* AudioContext unavailable */ }
}

function playCountTick(progress: number) {
  try {
    const ctx = getGameCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 1000 - progress * 380;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.05, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);
    osc.start(t); osc.stop(t + 0.02);
  } catch { /* AudioContext unavailable */ }
}

// ── Icons & shared UI ────────────────────────────────────────────────────────

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted ? (
      <><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>
    ) : (
      <><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>
    )}
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const HelpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1,3),16)/255, g = parseInt(hex.slice(3,5),16)/255, b = parseInt(hex.slice(5,7),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
  if (d === 0) return 0;
  let h = 0;
  switch (max) {
    case r: h = (g-b)/d + (g<b?6:0); break;
    case g: h = (b-r)/d + 2; break;
    case b: h = (r-g)/d + 4; break;
  }
  return h * 60;
}

function hueToHex(h: number): string {
  h = ((h % 360) + 360) % 360;
  const i = Math.floor(h/60) % 6, f = h/60 - Math.floor(h/60);
  const vals = [[1,f,0],[1-f,1,0],[0,1,f],[0,1-f,1],[f,0,1],[1,0,1-f]][i]!;
  return '#' + vals.map(x => Math.round(x*255).toString(16).padStart(2,'0')).join('').toUpperCase();
}

function scoreToHex(score: number): string {
  if (score >= 17) return '#538d4e';
  if (score >= 13) return '#b59f3b';
  if (score >= 9) return '#e67e22';
  return '#c0392b';
}

// Diagonal split tile: actual = lower-left (base), user = upper-right (overlay)
const SplitTile = ({ result }: { result: RoundResult }) => (
  <div className="flex flex-1 flex-col items-center gap-1.5 min-w-0">
    <div className="relative w-full overflow-hidden rounded-xl" style={{ aspectRatio: '1' }}>
      {/* actual color fills base — visible in lower-left triangle */}
      <div className="absolute inset-0" style={{ backgroundColor: result.actualHex }} />
      {/* user/guess color clipped to upper-right triangle */}
      <div className="absolute inset-0" style={{ backgroundColor: result.guessHex, clipPath: 'polygon(100% 0, 100% 100%, 0 0)' }} />
      {/* Score bottom-left — on actual color zone */}
      <span className="absolute bottom-1 left-1.5 text-xs font-black text-white" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.7)' }}>
        {result.score}
      </span>
      {/* User indicator top-right — on guess color zone */}
      <span className="absolute right-1 top-1 text-[8px] font-bold text-white/70" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>you</span>
    </div>
    <p className="w-full truncate text-center text-[9px] font-medium text-gray-400">{result.colorName}</p>
  </div>
);

// ── App ──────────────────────────────────────────────────────────────────────

export const App = () => {
  const [gameState, setGameState] = useState<GameState>('loading');
  const [puzzleData, setPuzzleData] = useState<RouterOutputs['game']['getPuzzle'] | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedColor, setSelectedColor] = useState('#228B22');
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
  const [hintUsed, setHintUsed] = useState<boolean[]>([false, false, false, false, false]);
  const [hintFlashing, setHintFlashing] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number>(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  useEffect(() => {
    withRetry(() => trpc.game.getPuzzle.query())
      .then((data) => {
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
      const p = Math.min((now - t0) / duration, 1);
      setDisplayScore((1 - Math.pow(1 - p, 3)) * target);
      if (!mutedRef.current && p < 0.98 && now - lastTick > 55) { lastTick = now; playCountTick(p); }
      if (p < 1) animFrameRef.current = requestAnimationFrame(tick);
      else setDisplayScore(target);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const handleSubmit = () => {
    if (!mutedRef.current) playClick(); // sound first — no guards before it
    if (!puzzleData) return;
    const roundIndex = currentRound;
    const guessHex = selectedColor;
    const colorData = puzzleData.colors[roundIndex];
    if (!colorData) return;

    const rawScore = calcScore(colorData.hex, guessHex);
    const score = hintUsed[roundIndex] ? rawScore * 0.6 : rawScore; // scale to /12 when hint used
    const newResult: RoundResult = { roundIndex, colorName: colorData.name, actualHex: colorData.hex, guessHex, score };
    setRoundResult(newResult);
    setRoundResults((prev) => [...prev, newResult]);
    setPuzzleData((prev) => prev ? { ...prev, totalScore: prev.totalScore + score } : prev);
    setRoundMessage(getRoundMessage(score));
    setDisplayScore(0);
    setGameState('submitted');

    // Small gap so click sound finishes before count-up ticks begin
    setTimeout(() => animateScore(score), 110);

    if (!replayMode) {
      trpc.game.submitGuess.mutate({ roundIndex, guessHex })
        .catch(() => void showToast({ text: 'Failed to save progress.', appearance: 'neutral' }));
    }
  };

  const handleContinue = () => {
    if (!mutedRef.current) playClick(); // sound first — no guards before it
    if (!puzzleData || !roundResult) return;
    cancelAnimationFrame(animFrameRef.current);
    if (roundResult.roundIndex + 1 >= puzzleData.totalRounds) {
      const total = Math.round([...roundResults].reduce((s, r) => s + r.score, 0));
      setGameMessage(getTotalMessage(total));
      setGameState('completed');
      if (replayMode) {
        trpc.game.recordReplayStats.mutate({
          totalScore: total,
          postType: puzzleData.postType,
        }).catch(() => {});
      }
    } else {
      setCurrentRound((prev) => prev + 1);
      setSelectedColor('#228B22');
      setRoundResult(null);
      setHintFlashing(false);
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
    setHintUsed([false, false, false, false, false]);
    setHintFlashing(false);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
  };

  const handlePostComment = async () => {
    if (commentPosted || commentPosting || !puzzleData) return;
    if (!mutedRef.current) playClick();
    setCommentPosting(true);
    const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
    try {
      await trpc.game.postComment.mutate({
        text: commentText,
        total,
        date: puzzleData.date,
        rounds: roundResults.map((r) => ({ name: r.colorName, score: r.score })),
        customTitle: puzzleData.postType === 'custom' ? (puzzleData.customTitle ?? undefined) : undefined,
      });
      setCommentPosted(true);
    } catch {
      void showToast({ text: 'Failed to post comment.', appearance: 'neutral' });
    } finally {
      setCommentPosting(false);
    }
  };

  // ── Shared components ──────────────────────────────────────────────────────

  const MuteBtn = () => (
    <button
      onClick={() => setMuted((m) => !m)}
      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
      aria-label={muted ? 'Unmute' : 'Mute'}
    >
      <SoundIcon muted={muted} />
    </button>
  );

  const HelpBtn = () => (
    <button
      onClick={() => setHelpOpen(true)}
      className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200"
      aria-label="How to play"
    >
      <HelpIcon />
    </button>
  );

  const HelpModal = () => (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-gray-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-base font-black text-gray-900 dark:text-white">How to Play</p>
          <button onClick={() => setHelpOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <CloseIcon />
          </button>
        </div>
        <div className="flex flex-col gap-3.5">
          {[
            { label: 'Guess the color', text: 'Each round shows a color name — drag the 3 sliders (Hue · Saturation · Brightness) to match it exactly.' },
            { label: 'Scoring', text: 'Each round scores 0–20 based on color accuracy. 5 rounds, max 100 pts total.' },
            { label: 'Hints', text: '2 hints per game. Reveals the hue for ~1s but caps that round\'s score at 12/20.' },
            { label: 'Custom puzzles', text: 'Create your own 5-color challenge with optional per-round hints from the subreddit.' },
            { label: 'Leaderboard', text: 'Scores are tracked globally. Post your result as a comment to appear on the board.' },
          ].map(({ label, text }) => (
            <div key={label}>
              <p className="text-xs font-bold uppercase tracking-widest text-orange-500">{label}</p>
              <p className="mt-0.5 text-sm leading-snug text-gray-600 dark:text-gray-400">{text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const Header = ({ label, showClose = false }: { label: string; showClose?: boolean }) => (
    <div className="shrink-0 border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
      <div className="mx-auto flex max-w-sm items-center justify-between px-4 py-1.5 sm:max-w-lg">
        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">{label}</p>
        <div className="flex items-center gap-1">
          <HelpBtn />
          <MuteBtn />
          {showClose && (
            <button onClick={handleCloseResults} className="flex h-7 w-7 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700 dark:hover:text-gray-200" aria-label="Close">
              <CloseIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  // ── Loading ────────────────────────────────────────────────────────────────
  if (gameState === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900">
        <p className="text-gray-500 dark:text-gray-400">Loading puzzle…</p>
      </div>
    );
  }

  if (gameState === 'error') {
    return (
      <div className="flex h-screen items-center justify-center bg-white dark:bg-gray-900 p-4">
        <p className="text-red-600">Failed to load game. Please refresh.</p>
      </div>
    );
  }

  const hintsRemaining = 2 - hintUsed.filter(Boolean).length;

  // ── Completed ──────────────────────────────────────────────────────────────
  if (gameState === 'completed' && puzzleData) {
    if (roundResults.length === 0) {
      return (
        <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-gray-900">
          {helpOpen && <HelpModal />}
          <Header label="Total Mastery" showClose />
          <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-3xl font-black text-gray-900 dark:text-white">Already Done!</h1>
            <p className="text-4xl font-black text-orange-600 dark:text-orange-400 tabular-nums">
              {puzzleData.totalScore}<span className="text-xl font-semibold text-gray-400">/100</span>
            </p>
            <p className="text-sm font-medium leading-snug text-gray-500 dark:text-gray-400">{gameMessage}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {puzzleData.postType === 'custom' ? `Puzzle by u/${puzzleData.creatorUsername}` : 'Come back tomorrow for a new puzzle!'}
            </p>
          </div>
        </div>
      );
    }

    const total = Math.round(roundResults.reduce((s, r) => s + r.score, 0));
    const [fy, fm, fd] = (puzzleData.date ?? '').split('-').map(Number);
    const dateLabel = new Date(fy!, fm! - 1, fd!).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    return (
      <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-gray-900">
        {helpOpen && <HelpModal />}
        <Header label="Total Mastery" />

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col gap-4 overflow-hidden px-4 pt-4 pb-4 sm:max-w-lg">

          {/* Score row + X button on the right */}
          <div className="flex shrink-0 items-start justify-between">
            <div>
              <p className="text-4xl font-black text-orange-600 dark:text-orange-400 tabular-nums">
                {total}<span className="text-xl font-semibold text-gray-400">/100</span>
              </p>
              <p className="mt-1.5 text-sm leading-snug text-gray-600 dark:text-gray-400">{gameMessage}</p>
            </div>
            <button
              onClick={handleCloseResults}
              className="ml-3 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-gray-500 transition-all hover:border-orange-400 hover:bg-orange-50 hover:text-orange-600 active:scale-95 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-400"
              aria-label="Play again"
            >
              <CloseIcon />
            </button>
          </div>

          {/* 5 diagonal split tiles */}
          <div className="flex shrink-0 gap-2">
            {roundResults.map((r) => <SplitTile key={r.roundIndex} result={r} />)}
          </div>

          {/* Comment section — fills remaining space */}
          <div className="flex min-h-0 flex-1 flex-col justify-end gap-2.5">
            {!commentPosted ? (
              <>
                {/* Preview card */}
                <div className="shrink-0 rounded-2xl bg-gray-900 px-4 py-3">
                  <p className="text-[11px] font-mono text-gray-400">
                    {puzzleData.userStats
                      ? `Best: ${puzzleData.userStats.bestScore} | Avg: ${Math.round(puzzleData.userStats.totalScore / puzzleData.userStats.games)} | Games: ${puzzleData.userStats.games}`
                      : 'Best: — | Avg: — | Games: —'}
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <p className="text-base font-black tabular-nums text-white">{total}/100</p>
                    <div className="flex gap-1.5">
                      {roundResults.map((r) => (
                        <div key={r.roundIndex} className="h-5 w-5 rounded-[4px]" style={{ backgroundColor: scoreToHex(r.score) }} />
                      ))}
                    </div>
                  </div>
                </div>

                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Add a note to your comment… (optional)"
                  maxLength={500}
                  rows={2}
                  className="w-full shrink-0 resize-none rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-orange-400 focus:outline-none dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                />

                <button
                  onClick={handlePostComment}
                  disabled={commentPosting}
                  className="w-full shrink-0 rounded-full bg-orange-600 px-6 py-3 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-60"
                >
                  {commentPosting ? 'Posting…' : 'Comment My Score'}
                </button>
              </>
            ) : (
              <div className="flex shrink-0 items-center justify-center gap-2 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 dark:border-green-800/40 dark:bg-green-900/20">
                <span className="text-sm font-semibold text-green-600 dark:text-green-400">✓ Comment posted!</span>
              </div>
            )}
            <p className="shrink-0 text-center text-xs text-gray-400">
              {puzzleData.postType === 'custom' ? `Puzzle by u/${puzzleData.creatorUsername}` : 'Come back tomorrow for a new puzzle!'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Submitted ──────────────────────────────────────────────────────────────
  if (gameState === 'submitted' && roundResult && puzzleData) {
    const isLast = roundResult.roundIndex + 1 >= puzzleData.totalRounds;
    const s = displayScore;
    const finalScore = roundResult.score;
    const scoreColor = finalScore >= 18 ? 'text-green-500' : finalScore >= 12 ? 'text-orange-500' : 'text-red-500';

    return (
      <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-gray-900">
        {helpOpen && <HelpModal />}
        <Header label={`Round ${roundResult.roundIndex + 1} of ${puzzleData.totalRounds}`} />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col overflow-hidden px-4 sm:max-w-lg">

          {/* Zone 1 — Score + message */}
          <div className="flex flex-[2] flex-col items-center justify-center">
            <p className={`tabular-nums text-5xl font-black leading-none ${scoreColor}`}>
              {s.toFixed(1)}<span className="text-xl font-semibold text-gray-400">/{hintUsed[roundResult.roundIndex] ? '12' : '20'}</span>
            </p>
            <p className="mt-2 px-6 text-center text-xs leading-snug text-gray-500 dark:text-gray-400">{roundMessage}</p>
          </div>

          {/* Zone 2 — Swatch + hex/name */}
          <div className="flex flex-[5] flex-col justify-center gap-3 min-h-0">
            <div className="flex shrink-0 overflow-hidden rounded-2xl shadow-md" style={{ height: 'clamp(120px, 28vh, 200px)' }}>
              <div className="flex flex-1 flex-col items-center justify-end pb-2.5" style={{ backgroundColor: roundResult.actualHex }}>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">Actual</span>
              </div>
              <div className="w-px bg-white/30" />
              <div className="flex flex-1 flex-col items-center justify-end pb-2.5" style={{ backgroundColor: roundResult.guessHex }}>
                <span className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white/90">You</span>
              </div>
            </div>
            <div className="flex items-start justify-between px-1">
              <div>
                <p className="font-mono text-xs text-gray-400">{roundResult.actualHex}</p>
                <p className="text-sm font-bold text-gray-900 dark:text-white">{roundResult.colorName}</p>
              </div>
              <p className="font-mono text-xs text-gray-400">{roundResult.guessHex}</p>
            </div>
          </div>

          {/* Zone 3 — Continue button, mirrors Submit button position exactly */}
          <div className="flex flex-[2] flex-col items-center justify-center">
            <button
              onClick={handleContinue}
              className="w-full rounded-full bg-orange-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95 sm:text-lg"
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
  const colorData = puzzleData.colors[currentRound];
  const colorName = colorData?.name;
  const currentHint = (puzzleData.hints ?? [])[currentRound] ?? '';
  const isWheel = (puzzleData.inputMode ?? 'slider') === 'wheel';

  // Hint button shared state — used in two render locations depending on mode
  const hintUsedRound = hintUsed[currentRound];
  const hintExhausted = !hintUsedRound && hintsRemaining === 0;
  const hintBtnDisabled = hintUsedRound || hintExhausted || hintFlashing || !colorData;
  const hintFlashColor = colorData ? hueToHex(hexToHue(colorData.hex)) : '#888';
  const hintBtnLabel = hintUsedRound ? 'Used' : hintExhausted ? 'No hints left' : '💡 Hint';
  const hintBtnSublabel = (hintUsedRound || hintExhausted) ? null : `${hintsRemaining} left · max 12/20`;
  const handleHintClick = () => {
    if (hintBtnDisabled) return;
    setHintUsed(prev => { const n = [...prev]; n[currentRound] = true; return n; });
    setHintFlashing(true);
    hintTimerRef.current = setTimeout(() => setHintFlashing(false), 1300);
  };
  const hintBtnSharedStyle = {
    padding: '6px 14px',
    minWidth: 72,
    borderRadius: 20,
    background: hintFlashing ? hintFlashColor : (hintUsedRound || hintExhausted ? '#f3f4f6' : '#ffffff'),
    border: hintFlashing ? `2px solid ${hintFlashColor}` : '1.5px solid #e5e7eb',
    color: hintFlashing ? 'transparent' : (hintUsedRound || hintExhausted ? '#9ca3af' : '#374151'),
    fontSize: 12,
    fontWeight: 700,
    cursor: hintBtnDisabled ? 'default' : 'pointer',
    opacity: (hintUsedRound || hintExhausted) && !hintFlashing ? 0.6 : 1,
    boxShadow: hintFlashing ? `0 0 20px 4px ${hintFlashColor}60` : '0 2px 8px rgba(0,0,0,0.10)',
    filter: hintFlashing ? 'blur(2.5px)' : 'none',
    transition: 'background 0.12s, color 0.12s, box-shadow 0.12s, opacity 0.2s, filter 0.12s',
    whiteSpace: 'nowrap' as const,
    letterSpacing: '0.04em',
    userSelect: 'none' as const,
  };
  const hintBtnInner = (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.2 }}>
      <span>{hintBtnLabel}</span>
      {hintBtnSublabel && <span style={{ fontSize: 9, fontWeight: 500, color: hintFlashing ? 'transparent' : '#9ca3af' }}>{hintBtnSublabel}</span>}
    </span>
  );

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-gray-900">
      {helpOpen && <HelpModal />}
      <Header label={`Round ${currentRound + 1} / ${puzzleData.totalRounds}`} />

      {/* Proportional 3-zone layout: title 20% · picker 58% · button 22% */}
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col overflow-hidden px-4 sm:max-w-lg">

        {/* Zone 1 — Color name */}
        <div className="flex flex-[2] flex-col items-center justify-start pt-3 sm:pt-2">
          <p className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-gray-400">Guess the color</p>
          <h2 className={`text-center font-black leading-none ${colorName && colorName.length >= 19 ? 'text-4xl sm:text-4xl' : 'text-5xl'}`} style={{ color: selectedColor }}>
            {colorName}
          </h2>
        </div>

        {/* Hint chip — shrink-0 so it never overlaps picker */}
        {currentHint.length > 0 && (
          <div className="mx-auto mb-2 flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 dark:border-amber-800 dark:bg-amber-950/30">
            <span className="shrink-0 text-xs">💡</span>
            <p className="text-xs leading-snug text-amber-800 dark:text-amber-300">{currentHint}</p>
          </div>
        )}

        {/* Zone 2 — Picker + hex; no overflow-hidden so wheel top never clips */}
        <div className="relative flex flex-[5] flex-col items-center justify-center gap-3 min-h-0">
          {(() => {
            const isMobile = window.innerWidth < 480;
            return isWheel
              ? (
                <WheelPicker
                  onColorSelected={setSelectedColor}
                  selectedColor={selectedColor}
                  muted={muted}
                  // Desktop: hint floats right of bar. Mobile: rendered below Zone 2 instead.
                  hintSlot={!isMobile ? (
                    <button
                      onClick={handleHintClick}
                      disabled={hintBtnDisabled}
                      aria-label={hintFlashing ? 'Showing hue hint' : hintBtnLabel}
                      style={hintBtnSharedStyle}
                    >
                      {hintBtnInner}
                    </button>
                  ) : undefined}
                />
              )
              : <ColorWheel onColorSelected={setSelectedColor} selectedColor={selectedColor} muted={muted} />;
          })()}
          <p className="font-mono text-sm font-semibold tracking-widest text-gray-500 dark:text-gray-400">
            {selectedColor.toUpperCase()}
          </p>
          {/* Hint button: slider mode only — floats in right whitespace beside the sliders */}
          {!isWheel && (
            <button
              onClick={handleHintClick}
              disabled={hintBtnDisabled}
              aria-label={hintFlashing ? 'Showing hue hint' : hintBtnLabel}
              style={{ position: 'absolute', right: 0, bottom: 20, ...hintBtnSharedStyle }}
            >
              {hintBtnInner}
            </button>
          )}
        </div>

        {/* Hint button: wheel + mobile only — just above Submit */}
        {isWheel && window.innerWidth < 480 && (
          <div className="shrink-0 flex justify-end pb-1">
            <button
              onClick={handleHintClick}
              disabled={hintBtnDisabled}
              aria-label={hintFlashing ? 'Showing hue hint' : hintBtnLabel}
              style={hintBtnSharedStyle}
            >
              {hintBtnInner}
            </button>
          </div>
        )}

        {/* Zone 3 — Submit, centered in bottom zone */}
        <div className="flex flex-[2] flex-col items-center justify-center">
          <button
            onClick={handleSubmit}
            className="w-full rounded-full bg-orange-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95 sm:text-lg"
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
    <App />
  </StrictMode>
);

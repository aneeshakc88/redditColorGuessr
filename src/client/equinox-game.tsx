import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { showToast } from '@devvit/web/client';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { trpc } from './trpc';
import {
  EMPTY, EQUINOX_COLORS, NAVY, ORANGE, decodePuzzle, violations,
  type EquinoxPuzzle, type Violation,
} from '../shared/equinox-core';
import { audioCtx } from './audio';

type BoardData = inferRouterOutputs<AppRouter>['equinox']['getBoard'];
type SubmitOk = Extract<inferRouterOutputs<AppRouter>['equinox']['submit'], { solved: true }>;

// Flat tiles on a true black ground. Sun and sky carry the board; alarm red is
// reserved so a broken line always has a colour of its own to shout in.
const BG = '#08080a';
const SURF = '#131318';
const HAIR = 'rgba(255,255,255,0.11)';
const ASH = '#f4f4f6';
const MUTED = '#9a9aa6';
const FAINT = '#63636f';
const ALARM = '#ff5964';
const TILE = '22%';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 800): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, delayMs * (i + 1))); }
  }
  throw new Error('unreachable');
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function tone(freq: number, dur: number, vol = 0.1, type: OscillatorType = 'sine') {
  try {
    const c = audioCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination); osc.type = type;
    const t = c.currentTime; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch { /* noop */ }
}
const sfxOrange = () => tone(520, 0.035, 0.06, 'triangle');
const sfxNavy = () => tone(390, 0.035, 0.06, 'triangle');
const sfxClear = () => tone(260, 0.04, 0.05, 'sine');
const sfxWrong = () => { tone(200, 0.11, 0.09, 'sawtooth'); setTimeout(() => tone(160, 0.14, 0.08, 'sawtooth'), 110); };
const sfxWin = () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.16, 0.12), i * 95)); };

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted ? (<><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>) : (<><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>)}
  </svg>
);

const ResetIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 2v6h6" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L3 8" />
  </svg>
);

const FireIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#ff7a1a" style={{ display: 'block', flexShrink: 0 }}>
    <path d="M12.5 1.5c1 3-1.5 4.5-3 6.5C8 10 7 12 7 14a5 5 0 0 0 10 0c0-2-1-3.2-1-3.2s.5 2-1 3c.3-2-.7-3.3-1.8-4.6-1.4-1.6-2.2-3.3-.7-7.7Z" />
  </svg>
);

// Emoji, not SVG, was what overlapped the digits: some Android fonts render ⏱
// far wider than its em box and it bled into the clock text beside it.
const ClockIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </svg>
);

const Styles = () => (
  <style>{`
    @keyframes eqPop { 0% { transform: scale(0.78); } 60% { transform: scale(1.06); } 100% { transform: scale(1); } }
    @keyframes eqRise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    @keyframes eqSettle { from { opacity: 0; transform: scale(0.4); } to { opacity: 1; transform: none; } }
    @keyframes eqBurst { 0% { transform: scale(0.5); opacity: 0; } 55% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }
    @keyframes eqFall {
      0%   { transform: translate3d(0,-12vh,0) rotate(0deg); opacity: 0; }
      8%   { opacity: 1; }
      100% { transform: translate3d(var(--dx), 112vh, 0) rotate(var(--rot)); opacity: 0; }
    }
    .eq-cell { transition: background-color 130ms ease, transform 130ms cubic-bezier(.2,.8,.3,1.2); touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
    .eq-cell:not(:disabled):hover { transform: scale(1.05); }
    .eq-cell:not(:disabled):active { transform: scale(0.93); }
    .eq-set { animation: eqPop 190ms ease; }
    .eq-confetti { position: absolute; top: 0; will-change: transform; animation: eqFall var(--dur) cubic-bezier(.25,.6,.5,1) var(--delay) forwards; }
    .eq-burst { animation: eqBurst 520ms cubic-bezier(.2,.8,.3,1.3) backwards; }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
  `}</style>
);

// One colourful drop per solve. Sizes and drift are chosen once (not per render)
// so a re-render never restarts the fall mid-flight.
const CONFETTI_COLORS = [EQUINOX_COLORS.orange, EQUINOX_COLORS.navy, '#ffd166', '#f2842b', '#4cc9f0', '#f45d78', '#34d399'];

const Confetti = () => {
  const bits = useMemo(() => Array.from({ length: 46 }, (_, i) => ({
    left: (i * 37) % 100,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length]!,
    w: 5 + ((i * 7) % 6),
    h: 8 + ((i * 5) % 8),
    dx: `${((i * 23) % 60) - 30}px`,
    rot: `${((i * 97) % 8 - 4) * 180}deg`,
    dur: `${2.2 + ((i * 13) % 16) / 10}s`,
    delay: `${((i * 29) % 14) / 10}s`,
    round: i % 3 === 0,
  })), []);

  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 2 }}>
      {bits.map((b, i) => (
        <span key={i} className="eq-confetti" style={{
          left: `${b.left}%`, width: b.w, height: b.h, background: b.color,
          borderRadius: b.round ? '50%' : 2,
          ['--dx' as string]: b.dx, ['--rot' as string]: b.rot,
          ['--dur' as string]: b.dur, ['--delay' as string]: b.delay,
        }} />
      ))}
    </div>
  );
};

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block', flexShrink: 0 }}>
    <circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" />
  </svg>
);

// ── Board ─────────────────────────────────────────────────────────
type Marks = { rows: Set<number>; cols: Set<number>; cells: Set<number>; notes: string[] };
const noMarks = (): Marks => ({ rows: new Set(), cols: new Set(), cells: new Set(), notes: [] });
const markCount = (m: Marks) => m.rows.size + m.cols.size + m.cells.size;

const rowIdx = (n: number, r: number) => Array.from({ length: n }, (_, k) => r * n + k);
const colIdx = (n: number, c: number) => Array.from({ length: n }, (_, k) => k * n + c);
const tally = (cells: number[], idxs: number[]) => {
  let o = 0, b = 0;
  for (const i of idxs) { if (cells[i] === ORANGE) o++; else if (cells[i] === NAVY) b++; }
  return { o, b };
};

const Board = ({ puzzle, cells, marks, lastSet, locked, onTap }: {
  puzzle: EquinoxPuzzle;
  cells: number[];
  marks: Marks;
  lastSet: number | null;
  locked: boolean;
  onTap: (i: number) => void;
}) => {
  const { n } = puzzle;

  return (
    <div style={{
      width: '100%',
      display: 'grid',
      gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`,
      gridTemplateRows: `repeat(${n}, minmax(0, 1fr))`,
      gap: '2%',
      aspectRatio: '1',
      position: 'relative',
    }}>
      {cells.map((v, i) => {
        const r = Math.floor(i / n), c = i % n;
        const given = puzzle.clues[i] !== EMPTY;
        const num = puzzle.numbers[i]!;
        const bg = v === ORANGE ? EQUINOX_COLORS.orange : v === NAVY ? EQUINOX_COLORS.navy : EQUINOX_COLORS.empty;
        const badNum = marks.cells.has(i);
        return (
          <button
            key={i}
            className={`eq-cell${lastSet === i ? ' eq-set' : ''}`}
            onClick={() => onTap(i)}
            disabled={given || locked}
            aria-label={`row ${r + 1} column ${c + 1}${num >= 0 ? `, clue ${num}` : ''}`}
            style={{
              gridRow: r + 1, gridColumn: c + 1,
              width: '100%', height: '100%', minWidth: 0, minHeight: 0, padding: 0,
              cursor: given || locked ? 'default' : 'pointer',
              borderRadius: TILE, background: bg, border: 'none', outline: 'none',
              // A clue keeps an inner frame: several clue cells carry no
              // numeral and would otherwise look tappable.
              boxShadow: badNum ? `inset 0 0 0 3px ${ALARM}`
                : given ? 'inset 0 0 0 4px rgba(8,8,10,0.5)' : 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 'clamp(11px, 6.5cqw, 30px)', letterSpacing: '-0.02em',
              color: v === ORANGE ? EQUINOX_COLORS.inkOnOrange : EQUINOX_COLORS.inkOnNavy,
            }}
          >
            {num >= 0 ? num : ''}
          </button>
        );
      })}

      {/* One band per broken line — never a ring on every cell. */}
      {[...marks.rows].map(r => (
        <div key={`br${r}`} style={{
          gridRow: r + 1, gridColumn: '1 / -1', margin: -1, zIndex: 1, pointerEvents: 'none',
          border: `2.5px solid ${ALARM}`, borderRadius: 9,
        }} />
      ))}
      {[...marks.cols].map(c => (
        <div key={`bc${c}`} style={{
          gridColumn: c + 1, gridRow: '1 / -1', margin: -1, zIndex: 1, pointerEvents: 'none',
          border: `2.5px solid ${ALARM}`, borderRadius: 9,
        }} />
      ))}
    </div>
  );
};

// ── Rules sheet ───────────────────────────────────────────────────────────────
// Tiles are sized in absolute px, never `1fr` + `aspect-ratio`: an aspect-ratio
// box in an `fr` track has no definite min-content width, and the art blew past
// its column and sat on top of the text.
const ART_TILE = 9;
const ART_GAP = 3;
const ART_COLS = 4;
const ART_W = ART_COLS * ART_TILE + (ART_COLS - 1) * ART_GAP;

const RuleArt = ({ rows }: { rows: string[] }) => (
  <div style={{ flexShrink: 0, width: ART_W, display: 'flex', flexDirection: 'column', gap: ART_GAP }}>
    {rows.map((row, r) => (
      <div key={r} style={{ display: 'flex', gap: ART_GAP }}>
        {[...row].map((ch, c) => (
          <div key={c} style={{
            width: ART_TILE, height: ART_TILE, flexShrink: 0, borderRadius: TILE,
            background: ch === 'o' ? EQUINOX_COLORS.orange : ch === 'n' ? EQUINOX_COLORS.navy : EQUINOX_COLORS.empty,
          }} />
        ))}
      </div>
    ))}
  </div>
);

const Rules = ({ n, onClose, onReplay }: { n: number; onClose: () => void; onReplay?: (() => void) | undefined }) => (
  <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(0,0,0,0.74)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', overflow: 'hidden' }}>
    <div onClick={e => e.stopPropagation()} style={{
      maxWidth: 460, width: '100%', maxHeight: '100%', minHeight: 0,
      display: 'flex', flexDirection: 'column',
      background: SURF, borderTop: `1px solid ${HAIR}`,
      borderRadius: '22px 22px 0 0', animation: 'eqRise 220ms ease',
    }}>
      <p style={{ flexShrink: 0, fontSize: 18, fontWeight: 900, margin: 0, padding: '16px 18px 8px', letterSpacing: '-0.02em' }}>How to play</p>

      {/* Only the rule list scrolls, so "Got it" stays reachable on short screens. */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 18px' }}>
        {([
          [['onon', 'nono'], 'Balance every line', `Each row and column holds ${n / 2} sun and ${n / 2} sky — never more.`],
          [['oo..', 'on..'], 'Obey the numbers', 'A numbered tile counts how many of the 8 tiles touching it match its own colour.'],
          [['onon', 'onon'], 'No twin lines', 'Two neighbouring rows can never be identical. Same for two neighbouring columns.'],
        ] as [string[], string, string][]).map(([art, title, body]) => (
          <div key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '9px 0', borderBottom: `1px solid ${HAIR}` }}>
            <RuleArt rows={art} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 800, margin: 0 }}>{title}</p>
              <p style={{ fontSize: 12, color: MUTED, margin: '2px 0 0', lineHeight: 1.45, overflowWrap: 'break-word' }}>{body}</p>
            </div>
          </div>
        ))}
        <p style={{ fontSize: 11, color: FAINT, margin: '10px 0 0', lineHeight: 1.45 }}>
          Every board has exactly one answer and can be solved by pure logic — you never need to guess.
        </p>
      </div>

      <div style={{ flexShrink: 0, padding: '12px 18px calc(18px + env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {onReplay && (
          <button onClick={onReplay} style={{ width: '100%', height: 42, borderRadius: 14, background: 'rgba(255,255,255,0.05)', color: ASH, fontWeight: 700, fontSize: 13.5, border: `1px solid ${HAIR}`, cursor: 'pointer' }}>Replay the 4×4 walkthrough</button>
        )}
        <button onClick={onClose} style={{ width: '100%', height: 44, borderRadius: 14, background: EQUINOX_COLORS.orange, color: EQUINOX_COLORS.inkOnOrange, fontWeight: 800, fontSize: 14.5, border: 'none', cursor: 'pointer' }}>Got it</button>
      </div>
    </div>
  </div>
);

// ── First-run walkthrough ─────────────────────────────────────────────────────
// Three 4×4 lessons, one rule each, one or two cells each. Every lesson is cut
// from the same solved board, and each open cell is *forced* by the rule being
// taught — a first-timer can neither get stuck nor learn the wrong thing.
type Lesson = {
  /** 16 cells: o | n | . */
  clues: string;
  numbers?: Record<number, number>;
  /** The eight neighbours a number counts, outlined once so the rule is visible. */
  ring?: number[];
  answer: Record<number, number>;
  status: string;
  title: string;
  body: string;
};

const LESSONS: Lesson[] = [
  {
    clues: 'onononnonoo.nono',
    answer: { 11: NAVY },
    status: 'Each line: 2 sun · 2 sky',
    title: 'Balance every line',
    body: 'Tap the ringed cell. This row already has its two suns, so the last one has to be sky.',
  },
  {
    clues: 'o.ononno.oonnono',
    numbers: { 5: 3 },
    ring: [0, 2, 4, 6, 9, 10],
    answer: { 1: NAVY, 8: NAVY },
    status: 'A number counts its own colour',
    title: 'Obey the numbers',
    body: 'The 3 counts the skies in the outlined ring. Only two are still open — so both are sky.',
  },
  {
    clues: 'ononon..noonnono',
    answer: { 6: NAVY, 7: ORANGE },
    status: 'Neighbouring rows never match',
    title: 'No twin lines',
    body: 'One sun and one sky left — but copying the row above is not allowed.',
  },
];

const parseLesson = (clues: string): number[] =>
  [...clues].map(ch => (ch === 'o' ? ORANGE : ch === 'n' ? NAVY : EMPTY));

const Tutorial = ({ compact, num, onDone }: { compact: boolean; num: number | null; onDone: () => void }) => {
  const [step, setStep] = useState(0);
  const [cells, setCells] = useState<number[]>(() => parseLesson(LESSONS[0]!.clues));
  const [lastSet, setLastSet] = useState<number | null>(null);
  const [bad, setBad] = useState(false);
  const [done, setDone] = useState(false);
  const [finished, setFinished] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const lesson = LESSONS[step]!;
  const last = step === LESSONS.length - 1;
  const targets = useMemo(() => Object.keys(lesson.answer).map(Number), [lesson]);

  const D = compact
    ? { pad: 8, statusH: 17, statusFs: 11, headPad: '7px 8px 0', wordFs: 14, max: 300, cardFs: 11.5, titleFs: 12.5, footPad: 14 }
    : { pad: 14, statusH: 22, statusFs: 12.5, headPad: '12px 14px 0', wordFs: 20, max: 340, cardFs: 13, titleFs: 14, footPad: 18 };

  const advance = () => {
    const next = step + 1;
    setStep(next);
    setCells(parseLesson(LESSONS[next]!.clues));
    setLastSet(null);
    setDone(false);
    setBad(false);
  };

  const tap = (i: number) => {
    if (done || !(i in lesson.answer)) return;
    const prev = cells[i]!;
    const next = prev === EMPTY ? ORANGE : prev === ORANGE ? NAVY : EMPTY;
    (next === ORANGE ? sfxOrange : next === NAVY ? sfxNavy : sfxClear)();

    const after = cells.map((v, k) => (k === i ? next : v));
    setCells(after);
    setLastSet(i);
    setBad(false);

    if (targets.every(k => after[k] === lesson.answer[k])) {
      sfxWin();
      setDone(true);
      timer.current = setTimeout(last ? () => setFinished(true) : advance, 780);
    } else if (targets.every(k => after[k] !== EMPTY)) {
      sfxWrong();
      setBad(true);
    }
  };

  if (finished) {
    return (
      <Shell compact={compact}>
        <Styles />
        <div style={{
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: compact ? 10 : 14,
          padding: `18px ${D.pad + 8}px calc(${D.footPad}px + env(safe-area-inset-bottom))`,
          maxWidth: 420, margin: '0 auto', width: '100%', textAlign: 'center', overflow: 'hidden',
        }}>
          <div className="eq-burst" style={{ flexShrink: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 13px', borderRadius: 999,
              background: 'rgba(52,211,153,0.13)', border: '1px solid rgba(52,211,153,0.35)',
              fontSize: 11.5, fontWeight: 800, color: '#34d399',
            }}>
              <CheckIcon />Walkthrough complete
            </span>
            <p style={{ fontSize: compact ? 22 : 27, fontWeight: 900, letterSpacing: '-0.03em', margin: '12px 0 0' }}>
              You’ve got it
            </p>
          </div>

          <p style={{ flexShrink: 0, margin: 0, fontSize: compact ? 12.5 : 13.5, lineHeight: 1.5, color: MUTED }}>
            Balance · Numbers · No twins. Every board has exactly one answer — you never need to guess.
          </p>

          <button onClick={onDone} style={{
            flexShrink: 0, width: '100%', height: compact ? 50 : 56, marginTop: compact ? 2 : 6,
            borderRadius: 14, border: 'none', cursor: 'pointer',
            background: EQUINOX_COLORS.orange, color: EQUINOX_COLORS.inkOnOrange,
            fontSize: compact ? 15 : 16.5, fontWeight: 900, letterSpacing: '-0.02em',
          }}>
            Play Daily Now
          </button>
          <p style={{ flexShrink: 0, margin: 0, fontSize: compact ? 10.5 : 11.5, color: FAINT }}>
            {num == null ? 'Today’s Equinox' : `Today’s Equinox · #${num}`}
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell compact={compact}>
      <Styles />

      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        padding: D.headPad, maxWidth: 620, margin: '0 auto', width: '100%',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: D.wordFs, fontWeight: 900, letterSpacing: '-0.03em', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            How to <span style={{ color: EQUINOX_COLORS.orange }}>Play</span>
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onDone} aria-label="Skip the walkthrough" style={{
            flexShrink: 0, height: 26, padding: '0 11px', borderRadius: 999,
            background: 'rgba(255,255,255,0.05)', border: `1px solid ${HAIR}`, color: MUTED,
            fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
          }}>Skip</button>
        </div>
      </div>

      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: compact ? '7px 0 1px' : '10px 0 2px' }}>
        {LESSONS.map((_, i) => (
          <span key={i} style={{
            display: 'block', height: 5, width: i === step ? 16 : 5, borderRadius: 3,
            background: i === step ? EQUINOX_COLORS.orange : FAINT, transition: 'width 180ms ease',
          }} />
        ))}
      </div>

      <p style={{
        flexShrink: 0, height: D.statusH, lineHeight: `${D.statusH}px`, margin: compact ? '4px 0 3px' : '6px 0 6px',
        padding: `0 ${D.pad}px`, textAlign: 'center', fontSize: D.statusFs, fontWeight: 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        color: bad ? ALARM : done ? '#34d399' : MUTED,
      }}>
        {bad ? 'Not quite — read the rule again.' : done ? 'Exactly.' : lesson.status}
      </p>

      <div style={{ flexShrink: 0, padding: `0 ${D.pad}px`, maxWidth: 420, margin: '0 auto', width: '100%' }}>
        <div style={{
          background: SURF, border: `1px solid ${done ? 'rgba(52,211,153,0.4)' : HAIR}`, borderRadius: 14,
          padding: '9px 12px', transition: 'border-color 180ms ease',
        }}>
          <p style={{ margin: 0, fontSize: D.titleFs, fontWeight: 800, letterSpacing: '-0.01em', color: done ? '#34d399' : ASH }}>
            {lesson.title}
          </p>
          <p style={{ margin: '3px 0 0', fontSize: D.cardFs, lineHeight: 1.42, color: MUTED }}>{lesson.body}</p>
        </div>
      </div>

      <div
        style={{ flex: 1, minHeight: 0, minWidth: 0, containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `${compact ? 8 : 12}px ${D.pad}px calc(${D.footPad}px + env(safe-area-inset-bottom))` }}>
        <div style={{ width: `min(100cqw, 100cqh, ${D.max}px)` }}>
          <div style={{
            width: '100%', display: 'grid', gap: '2%', aspectRatio: '1',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
          }}>
            {cells.map((v, i) => {
              const open = i in lesson.answer;
              const num = lesson.numbers?.[i];
              const bg = v === ORANGE ? EQUINOX_COLORS.orange : v === NAVY ? EQUINOX_COLORS.navy : EQUINOX_COLORS.empty;
              const ringed = lesson.ring?.includes(i);
              return (
                <button
                  key={i}
                  className={`eq-cell${lastSet === i ? ' eq-set' : ''}`}
                  onClick={() => tap(i)}
                  disabled={!open || done}
                  aria-label={`row ${Math.floor(i / 4) + 1} column ${(i % 4) + 1}${num != null ? `, clue ${num}` : ''}`}
                  style={{
                    width: '100%', height: '100%', minWidth: 0, minHeight: 0, padding: 0,
                    cursor: open && !done ? 'pointer' : 'default',
                    borderRadius: TILE, background: bg, border: 'none', outline: 'none',
                    boxShadow: open && v === EMPTY && !done ? `0 0 0 3px ${EQUINOX_COLORS.orange}`
                      : ringed ? 'inset 0 0 0 3px rgba(255,255,255,0.55)'
                        : open ? 'none' : 'inset 0 0 0 4px rgba(8,8,10,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: 'clamp(11px, 9cqw, 34px)', letterSpacing: '-0.02em',
                    color: v === ORANGE ? EQUINOX_COLORS.inkOnOrange : EQUINOX_COLORS.inkOnNavy,
                  }}
                >
                  {num ?? ''}
                </button>
              );
            })}
          </div>
        </div>
      </div>

    </Shell>
  );
};

// ── Game ──────────────────────────────────────────────────────────────────────
export type EquinoxGameProps = {
  /** Feed-card layout: one header row, board takes every remaining pixel, never scrolls. */
  compact?: boolean;
  /** Renders a trophy in the header when supplied. */
  onLeaderboard?: (() => void) | undefined;
  /** Board handed down by the splash, which already fetched it. Skips a round trip. */
  initial?: BoardData | null | undefined;
};

export const EquinoxGame = ({ compact = false, onLeaderboard, initial = null }: EquinoxGameProps) => {
  const [data, setData] = useState<BoardData | null>(initial);
  const [error, setError] = useState(false);
  const [cells, setCells] = useState<number[]>(() => (initial ? decodePuzzle(initial.puzzle).clues : []));
  const [lastSet, setLastSet] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showTutorial, setShowTutorial] = useState(() => !!initial?.isNewPlayer);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitOk | null>(null);
  const [anonSolved, setAnonSolved] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);

  const startRef = useRef(0);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const submittedRef = useRef(false);
  // The clock the score comes from is the server's, started by `begin`. Submit
  // waits on this promise so the two can never race.
  const begunRef = useRef<Promise<unknown> | null>(null);

  const puzzle = useMemo(() => (data ? decodePuzzle(data.puzzle) : null), [data]);

  const play = useCallback((fn: () => void) => { if (!mutedRef.current) fn(); }, []);

  // Density. Compact trades every non-essential pixel for cell size: the reset
  // button folds into the header row, which is ~64px the board keeps instead.
  const D = compact
    ? { pad: 8, icon: 26, iconGap: 4, statusH: 17, statusFs: 11, headPad: '7px 8px 0', headGap: 6, wordFs: 14, chipFs: 11.5, chipPad: '5px 9px', max: 560 }
    : { pad: 14, icon: 32, iconGap: 6, statusH: 22, statusFs: 12.5, headPad: '12px 14px 0', headGap: 10, wordFs: 20, chipFs: 13, chipPad: '7px 16px', max: 520 };

  useEffect(() => {
    if (initial) return;
    void (async () => {
      try {
        const d = await withRetry(() => trpc.equinox.getBoard.query());
        setData(d);
        setCells(decodePuzzle(d.puzzle).clues);
        if (d.isNewPlayer) setShowTutorial(true);
      } catch {
        setError(true);
      }
    })();
    // `initial` is a mount-time seed; a later identity change must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!data || result) return;
    const id = setInterval(() => {
      if (startRef.current) setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, [data, result]);

  // Finishing and skipping are the same event: the walkthrough is offered once.
  const finishTutorial = () => {
    setShowTutorial(false);
    void trpc.equinox.markOnboarded.mutate().catch(() => {});
  };

  const beginIfNeeded = () => {
    if (begunRef.current) return;
    startRef.current = Date.now();
    begunRef.current = trpc.equinox.begin.mutate().catch(() => {});
  };

  const remaining = cells.filter(c => c === EMPTY).length;

  // Broken lines surface while you play; a clue that doesn't add up only counts
  // once the board is full, so half-finished work is never nagged at.
  const live = useMemo(() => {
    if (!puzzle || cells.length === 0) return noMarks();
    const full = cells.every(c => c !== EMPTY);
    const found = violations(puzzle.n, cells, puzzle.numbers).filter(v => full || v.kind !== 'number');
    return collect(found, puzzle.n, cells);
  }, [puzzle, cells]);

  const tap = (i: number) => {
    if (!puzzle || result || submitting || puzzle.clues[i] !== EMPTY) return;
    beginIfNeeded();

    const prev = cells[i]!;
    const next = prev === EMPTY ? ORANGE : prev === ORANGE ? NAVY : EMPTY;
    play(next === ORANGE ? sfxOrange : next === NAVY ? sfxNavy : sfxClear);

    setLastSet(i);
    setCells(c => c.map((v, k) => (k === i ? next : v)));
  };

  const reset = () => {
    if (!puzzle || result) return;
    setCells(puzzle.clues.slice());
    setLastSet(null);
  };

  // The board judges itself the moment the last cell is filled — no check
  // button. A wrong board never reaches the server; a right one is re-judged
  // there, and the score comes back from the server's own clock.
  useEffect(() => {
    if (!data || !puzzle || result || submittedRef.current || cells.length === 0 || cells.some(c => c === EMPTY)) return;

    const found = violations(puzzle.n, cells, puzzle.numbers);
    if (found.length > 0) {
      play(sfxWrong);
      return;
    }

    submittedRef.current = true;

    // Logged-out viewers get the feed card too. `submit` would reject them with
    // "Not authenticated" and the generic retry toast would strand them on a
    // finished board, so celebrate locally and tell them why it isn't recorded.
    if (!data.username) {
      play(sfxWin);
      setAnonSolved(true);
      return;
    }

    setSubmitting(true);
    void (async () => {
      try {
        await begunRef.current;
        const r = await trpc.equinox.submit.mutate({ cells });
        if (r.solved) {
          play(sfxWin);
          setResult(r);
        } else {
          submittedRef.current = false;
          void showToast({ text: 'That board was not accepted — try again.', appearance: 'neutral' });
        }
      } catch {
        submittedRef.current = false;
        void showToast({ text: 'Could not submit — try again.', appearance: 'neutral' });
      } finally { setSubmitting(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells]);

  const postScore = async () => {
    if (!result || posting || posted) return;
    setPosting(true);
    try {
      await trpc.equinox.postComment.mutate({
        text: commentText, score: result.score, timeSec: result.timeSec,
        topPct: result.topPct, userRank: result.userRank, playerCount: result.playerCount, streak: result.streak,
      });
      setPosted(true);
    } catch { void showToast({ text: 'Could not post.', appearance: 'neutral' }); }
    finally { setPosting(false); }
  };

  const iconStyle = {
    width: D.icon, height: D.icon, flexShrink: 0, borderRadius: '50%', border: `1px solid ${HAIR}`,
    background: 'rgba(255,255,255,0.05)', cursor: 'pointer', color: MUTED, fontSize: 13, fontWeight: 800,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
  } as const;

  if (error) return <Center compact={compact} tone={ALARM}>Failed to load. Please refresh.</Center>;
  if (!data || !puzzle) return <Center compact={compact} tone={MUTED}>Loading…</Center>;

  if (showTutorial) return <Tutorial compact={compact} num={data.num} onDone={finishTutorial} />;

  if (anonSolved) {
    return (
      <Shell compact={compact}>
        <Styles />
        <Confetti />
        <div style={{
          position: 'relative', zIndex: 3, flex: 1, minHeight: 0,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12,
          padding: compact ? '10px 14px calc(14px + env(safe-area-inset-bottom))' : '18px 16px calc(18px + env(safe-area-inset-bottom))',
          maxWidth: 420, margin: '0 auto', width: '100%', textAlign: 'center', overflow: 'hidden',
        }}>
          <div className="eq-burst" style={{ flexShrink: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 13px', borderRadius: 999,
              background: 'rgba(52,211,153,0.13)', border: '1px solid rgba(52,211,153,0.35)',
              fontSize: 11.5, fontWeight: 800, color: '#34d399',
            }}>
              <CheckIcon />Equinox complete
            </span>
            <p style={{ fontSize: compact ? 20 : 25, fontWeight: 900, letterSpacing: '-0.02em', margin: '10px 0 0' }}>Puzzle solved</p>
            <p style={{ fontSize: compact ? 'clamp(34px, 11vh, 58px)' : 'clamp(48px, 15vw, 70px)', fontWeight: 900, letterSpacing: '-0.045em', margin: '2px 0 0', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: EQUINOX_COLORS.orange }}>
              {fmtTime(elapsed)}
            </p>
          </div>
          <p style={{ flexShrink: 0, fontSize: 12.5, color: MUTED, margin: 0, lineHeight: 1.5 }}>
            Log in to Reddit to record your time, keep a streak and post your score.
          </p>
        </div>
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell compact={compact}>
        <Styles />
        <Confetti />
        <div style={{
          position: 'relative', zIndex: 3,
          flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center',
          gap: compact ? 10 : 16, padding: compact ? '10px 14px calc(14px + env(safe-area-inset-bottom))' : '18px 16px calc(18px + env(safe-area-inset-bottom))',
          maxWidth: 420, margin: '0 auto', width: '100%', textAlign: 'center', overflow: 'hidden',
        }}>
          <div className="eq-burst" style={{ flexShrink: 0 }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 13px', borderRadius: 999,
              background: 'rgba(52,211,153,0.13)', border: '1px solid rgba(52,211,153,0.35)',
              fontSize: 11.5, fontWeight: 800, color: '#34d399',
            }}>
              <CheckIcon />Equinox complete
            </span>

            <p style={{ fontSize: compact ? 20 : 25, fontWeight: 900, letterSpacing: '-0.02em', margin: '10px 0 0' }}>Puzzle solved</p>

            <p style={{ fontSize: compact ? 'clamp(34px, 11vh, 58px)' : 'clamp(48px, 15vw, 70px)', fontWeight: 900, letterSpacing: '-0.045em', margin: '2px 0 0', lineHeight: 1, fontVariantNumeric: 'tabular-nums', color: EQUINOX_COLORS.orange }}>
              {fmtTime(result.timeSec)}
            </p>
          </div>

          {result.streak != null && result.streak > 0 && (
            <div style={{
              flexShrink: 0, alignSelf: 'center', display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 22px', borderRadius: 16, background: SURF, border: `1px solid ${HAIR}`,
            }}>
              <FireIcon />
              <span style={{ fontSize: 19, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{result.streak}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: MUTED }}>day streak</span>
            </div>
          )}

          {!result.recorded && (
            <p style={{ flexShrink: 0, fontSize: 11.5, color: FAINT, margin: 0 }}>Replay — your first solve is the one that ranks.</p>
          )}

          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!posted ? (
              <>
                <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a note (optional)" maxLength={500}
                  style={{ width: '100%', borderRadius: 12, border: `1px solid ${HAIR}`, background: 'rgba(255,255,255,0.05)', padding: '11px 14px', fontSize: 14, color: ASH, outline: 'none', boxSizing: 'border-box' }} />
                <button onClick={() => void postScore()} disabled={posting}
                  style={{ width: '100%', height: compact ? 44 : 50, borderRadius: 14, background: EQUINOX_COLORS.orange, color: EQUINOX_COLORS.inkOnOrange, fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', opacity: posting ? 0.6 : 1 }}>
                  {posting ? 'Posting…' : 'Comment score'}
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', padding: 11 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>Posted to the score thread</span>
              </div>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  const suns = cells.filter(c => c === ORANGE).length;
  const skies = cells.filter(c => c === NAVY).length;

  return (
    <Shell compact={compact}>
      <Styles />

      {/* One row: identity, clock, crowd, controls. */}
      <div style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: D.headGap,
        padding: D.headPad, maxWidth: 620, margin: '0 auto', width: '100%',
      }}>
        {/* Equal flex basis on the outer zones is what actually centres the
            chips — `margin: auto` alone would only centre them in the gap. */}
        <div style={{ flex: '1 1 0', minWidth: 0 }}>
          <p style={{ fontSize: D.wordFs, fontWeight: 900, letterSpacing: '-0.03em', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Equi<span style={{ color: EQUINOX_COLORS.orange }}>nox</span>
          </p>
          {!compact && (
            <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em', color: FAINT, margin: '3px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.date.toUpperCase()}</p>
          )}
        </div>

        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: D.headGap }}>
          {!!data.streak && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
              padding: D.chipPad, borderRadius: 999, background: SURF,
              border: `1px solid ${HAIR}`, fontSize: D.chipFs, fontWeight: 700,
            }}>
              {/* The word is what pushed the row past a narrow card and shoved
                  the reset button under the clock — the flame already says it. */}
              <FireIcon /><span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.streak}{compact ? '' : ` ${data.streak === 1 ? 'Day' : 'Days'}`}</span>
            </div>
          )}

          <div style={{
            display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
            padding: D.chipPad, borderRadius: 999, background: SURF,
            border: `1px solid ${HAIR}`, fontSize: D.chipFs, fontWeight: 700, color: ASH,
          }}>
            <ClockIcon /><span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtTime(elapsed)}</span>
          </div>
        </div>

        {/* No `minWidth: 0` here on purpose: the automatic min-content floor is
            what stops the buttons being squeezed under the clock chip. The title
            zone carries `minWidth: 0`, so it absorbs every pixel of shrink. */}
        <div style={{ flex: '1 1 0', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: D.iconGap }}>
          {compact && (
            <button onClick={reset} aria-label="Reset board" style={iconStyle}><ResetIcon /></button>
          )}
          <button onClick={() => setShowRules(true)} aria-label="How to play" style={iconStyle}>?</button>
          <button onClick={() => setMuted(m => !m)} aria-label="Sound" style={iconStyle}><SoundIcon muted={muted} /></button>
          {onLeaderboard && (
            <button onClick={onLeaderboard} aria-label="Leaderboard" style={iconStyle}>🏆</button>
          )}
        </div>
      </div>

      {/* Always one line: the board must not jump when the message changes. */}
      <p style={{
        flexShrink: 0, height: D.statusH, lineHeight: `${D.statusH}px`, margin: compact ? '5px 0 3px' : '8px 0 6px',
        padding: `0 ${D.pad}px`, textAlign: 'center', fontSize: D.statusFs, fontWeight: 600,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        color: markCount(live) > 0 ? ALARM : MUTED,
      }}>
        {markCount(live) > 0
          ? describe(live)
          : submitting ? 'Checking…'
          // A returning player is told their locked-in time — otherwise the
          // board looks untouched and a replay seems to overwrite the real one.
          : data.alreadyPlayed && data.best ? `Solved today in ${fmtTime(data.best.timeSec)} · replays don't count`
          : compact ? '' : `${remaining} left · ${suns} sun / ${skies} sky`}
      </p>

      <div
        style={{ flex: 1, minHeight: 0, minWidth: 0, containerType: 'size', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: `0 ${D.pad}px` }}>
        <div style={{ width: `min(100cqw, 100cqh, ${D.max}px)` }}>
          <Board puzzle={puzzle} cells={cells} marks={live} lastSet={lastSet} locked={submitting} onTap={tap} />
        </div>
      </div>

      {compact ? (
        /* Reddit's feed card floats its own controls over the bottom edge, so
           the hint needs real clearance below it, not just the safe area. */
        <p style={{ flexShrink: 0, height: 15, lineHeight: '15px', margin: 0, padding: '5px 0 calc(16px + env(safe-area-inset-bottom))', fontSize: 10.5, fontWeight: 600, color: MUTED, textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden' }}>
          Tap: sun → sky → clear
        </p>
      ) : (
        <div style={{ flexShrink: 0, padding: '12px 14px calc(14px + env(safe-area-inset-bottom))', maxWidth: 380, margin: '0 auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
          <button onClick={reset}
            style={{ width: '100%', height: 46, borderRadius: 14, background: 'rgba(255,255,255,0.05)', color: ASH, fontWeight: 700, fontSize: 14, border: `1px solid ${HAIR}`, cursor: 'pointer' }}>
            Reset
          </button>
          <p style={{ fontSize: 11, color: FAINT, textAlign: 'center', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Tap: sun → sky → clear. Reset is free.
          </p>
        </div>
      )}

      {showRules && (
        <Rules
          n={puzzle.n}
          onClose={() => setShowRules(false)}
          onReplay={() => { setShowRules(false); setShowTutorial(true); }}
        />
      )}
    </Shell>
  );
};

// Compact fills the card its host already sized; standalone owns the viewport.
const Shell = ({ compact, children }: { compact: boolean; children: ReactNode }) => (
  <div style={{
    position: 'relative',
    display: 'flex', flexDirection: 'column',
    height: compact ? '100%' : '100dvh', maxHeight: '100%',
    background: BG, color: ASH, overflow: 'hidden',
  }}>{children}</div>
);

const Center = ({ compact, tone, children }: { compact: boolean; tone: string; children: ReactNode }) => (
  <div style={{ display: 'flex', height: compact ? '100%' : '100dvh', alignItems: 'center', justifyContent: 'center', background: BG, color: tone, padding: 16, textAlign: 'center', overflow: 'hidden' }}>{children}</div>
);

function collect(found: Violation[], n: number, cells: number[]): Marks {
  const m = noMarks();
  const half = n / 2;
  // Short enough to hold one line on a 320px phone.
  const lineNote = (name: string, index: number, idxs: number[]) => {
    const t = tally(cells, idxs);
    const over = t.o > half ? { count: t.o, colour: 'sun' } : { count: t.b, colour: 'sky' };
    return `${name} ${index + 1}: ${over.count} ${over.colour}, max ${half}`;
  };

  for (const v of found) {
    if (v.kind === 'row') { m.rows.add(v.index); m.notes.push(lineNote('Row', v.index, rowIdx(n, v.index))); }
    else if (v.kind === 'col') { m.cols.add(v.index); m.notes.push(lineNote('Column', v.index, colIdx(n, v.index))); }
    else if (v.kind === 'number') { m.cells.add(v.cell); }
    else if (v.kind === 'twin-rows') { m.rows.add(v.a); m.rows.add(v.b); m.notes.push(`Rows ${v.a + 1} + ${v.b + 1} are identical`); }
    else { m.cols.add(v.a); m.cols.add(v.b); m.notes.push(`Columns ${v.a + 1} + ${v.b + 1} are identical`); }
  }
  if (m.cells.size) {
    m.notes.push(`${m.cells.size} clue${m.cells.size === 1 ? " doesn't" : "s don't"} fit`);
  }
  return m;
}

/** One fault named on screen; the red bands carry the rest. */
function describe(m: Marks): string {
  const first = m.notes[0] ?? 'Something is off';
  return m.notes.length > 1 ? `${first} · +${m.notes.length - 1} more` : first;
}

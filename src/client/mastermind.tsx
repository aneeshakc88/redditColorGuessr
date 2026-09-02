import './index.css';

import { StrictMode, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { mmConfig } from '../shared/mastermind-core';
import { Mark, MARK_EXACT, MARK_COLOR } from './components/FeedbackMark';

type RouterOutputs = inferRouterOutputs<AppRouter>;
type PuzzleData = RouterOutputs['mastermind']['getPuzzle'];
type DistData = RouterOutputs['mastermind']['getDistribution'];
type MColor = { name: string; hex: string };
type MGuess = { colors: string[]; greens: number; yellows: number };

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// ── helpers ──────────────────────────────────────────────────────────────────

function poolIndex(hex: string, pool: MColor[]): number {
  return pool.findIndex(c => c.hex === hex) + 1; // 1-based, 0 if not found
}

function needsDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 160;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const [, m, d] = dateStr.split('-');
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${months[parseInt(m ?? '1') - 1]} ${parseInt(d ?? '1')}`;
}

// ── sub-components ────────────────────────────────────────────────────────────

const Logo = () => (
  <div style={{
    width: 30, height: 30, borderRadius: 8, flexShrink: 0,
    background: 'linear-gradient(135deg,#243040,#33414f)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 16,
  }}>🔒</div>
);

const ProgressDots = ({ count, total }: { count: number; total: number }) => (
  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
    {Array.from({ length: total }, (_, i) => (
      <div key={i} style={{
        width: 6, height: 6, borderRadius: '50%',
        backgroundColor: i < count ? '#ff6b35' : '#2a3846',
        transition: 'background-color 0.3s',
      }} />
    ))}
  </div>
);

const ColorCircle = ({
  hex, num, size, empty, isActive,
}: {
  hex?: string; num?: number; size: number; empty?: boolean; isActive?: boolean;
}) => {
  const dark = hex ? needsDarkText(hex) : false;
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      backgroundColor: hex ?? 'transparent',
      border: empty
        ? `2px dashed ${isActive ? 'rgba(255,107,53,0.6)' : '#2a3846'}`
        : '2px solid rgba(150,175,200,0.18)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: hex ? '0 2px 6px rgba(0,0,0,0.35)' : 'none',
    }}>
      {num != null && (
        <span style={{
          fontSize: Math.max(9, size * 0.42), fontWeight: 900, lineHeight: 1,
          color: dark ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)',
          textShadow: dark ? 'none' : '0 1px 3px rgba(0,0,0,0.5)',
          userSelect: 'none',
        }}>
          {num}
        </span>
      )}
    </div>
  );
};

const CountChips = ({ greens, yellows, secretLen }: { greens: number; yellows: number; secretLen: number }) => {
  if (greens === 0 && yellows === 0) {
    return (
      <span style={{ fontSize: 9, fontWeight: 700, color: MARK_COLOR, opacity: 0.55, letterSpacing: '0.06em' }}>
        nothing
      </span>
    );
  }
  const won = greens === secretLen;
  const chip = { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, fontVariantNumeric: 'tabular-nums' } as const;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
      {greens > 0 && (
        <span style={{ ...chip, fontWeight: 800, color: won ? '#ff6b35' : MARK_EXACT }}>
          {greens}<Mark size={11} kind="exact" {...(won ? { color: '#ff6b35', glow: true } : {})} />
        </span>
      )}
      {yellows > 0 && (
        <span style={{ ...chip, fontWeight: 700, color: MARK_COLOR }}>
          {yellows}<Mark size={11} kind="color" />
        </span>
      )}
    </div>
  );
};

const BoardRow = ({
  rowNum, guess, isActive, currentColors, pool, circleSize, circleGap = 5, fillCount, paddingY = 4, secretLen,
}: {
  rowNum: number;
  guess?: MGuess;
  isActive: boolean;
  currentColors?: string[];
  pool: MColor[];
  circleSize: number;
  circleGap?: number;
  fillCount?: number;
  paddingY?: number;
  secretLen: number;
}) => {
  const colors = guess ? guess.colors : (currentColors ?? []);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: `${paddingY}px 12px`,
      background: isActive ? 'rgba(255,107,53,0.08)' : 'transparent',
      borderLeft: isActive ? '2px solid rgba(255,107,53,0.4)' : '2px solid transparent',
    }}>
      <span style={{ width: 22, fontSize: 10, fontWeight: 700, color: '#2f6b45', textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
        {String(rowNum).padStart(2, '0')}
      </span>
      <div style={{ display: 'flex', gap: circleGap }}>
        {Array.from({ length: secretLen }, (_, j) => {
          const hex = colors[j];
          const num = hex ? poolIndex(hex, pool) : undefined;
          return (
            <ColorCircle key={j} {...(hex ? { hex } : {})} {...(num != null ? { num } : {})} size={circleSize} empty={!hex} isActive={isActive} />
          );
        })}
      </div>
      <div style={{ width: 58, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, marginLeft: 12 }}>
        {guess ? (
          <CountChips greens={guess.greens} yellows={guess.yellows} secretLen={secretLen} />
        ) : isActive && fillCount != null ? (
          <span style={{ fontSize: 10, fontWeight: 700, color: '#ff6b35', fontVariantNumeric: 'tabular-nums' }}>
            {fillCount}/{secretLen}
            <span className="mm-cursor" style={{ display: 'inline-block', width: 5, height: 10, marginLeft: 2, background: '#ff6b35', verticalAlign: '-1px' }} />
          </span>
        ) : null}
      </div>
    </div>
  );
};

// Viewport-driven sizing: the end screen must fit whatever box Reddit gives the
// webview — short-and-wide on desktop, tall-and-narrow on phones — without scroll.
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

type ChartMetrics = { barW: number; labelFont: number; axisFont: number; titleFont: number; titleGap: number };

// Bars are absolutely positioned inside a flexible plot area, so the chart grows
// into whatever height is left over instead of forcing the card to scroll.
const BarColumn = ({ pct, label, count, highlight, accent, m }: {
  pct: number; label: string; count: number; highlight: boolean; accent: string; m: ChartMetrics;
}) => (
  <div style={{ width: m.barW, height: '100%', position: 'relative' }}>
    {count > 0 && (
      <span style={{
        position: 'absolute', left: -4, right: -4, bottom: `calc(${pct}% + 3px)`, textAlign: 'center',
        fontSize: m.labelFont, fontWeight: 700, lineHeight: 1, color: highlight ? accent : '#d6c3a5',
      }}>
        {count}
      </span>
    )}
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, height: `${pct}%`,
      backgroundColor: highlight ? accent : '#2a3846',
      borderRadius: '3px 3px 0 0',
      boxShadow: highlight ? `0 0 10px ${accent}80` : 'none',
      transition: 'height 0.5s ease',
    }} />
    <span style={{ display: 'none' }}>{label}</span>
  </div>
);

const ChartFrame = ({ title, m, children, axis }: {
  title: string; m: ChartMetrics; children: ReactNode; axis: { key: string; text: string; highlight: boolean }[];
}) => (
  <div style={{ width: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
    <p style={{ fontSize: m.titleFont, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b9bad', marginBottom: m.titleGap, textAlign: 'center', flexShrink: 0 }}>
      {title}
    </p>
    <div style={{ flex: '1 1 auto', minHeight: 24, display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: 3 }}>
      {children}
    </div>
    <div style={{ display: 'flex', justifyContent: 'center', gap: 3, marginTop: 3, flexShrink: 0 }}>
      {axis.map(a => (
        <span key={a.key} style={{ width: m.barW, textAlign: 'center', fontSize: m.axisFont, fontWeight: a.highlight ? 800 : 600, color: a.highlight ? '#e8dcc4' : '#8b9bad', lineHeight: 1 }}>
          {a.text}
        </span>
      ))}
    </div>
  </div>
);

const DistChart = ({ data, userMoves, won, maxGuesses, accent, m }: { data: DistData; userMoves: number; won: boolean; maxGuesses: number; accent: string; m: ChartMetrics }) => {
  const { dist, total } = data;
  const keys = [...Array.from({ length: maxGuesses }, (_, i) => String(i + 1)), 'failed'];
  const maxVal = Math.max(1, ...keys.map(k => dist[k] ?? 0));
  const isUser = (key: string) => (won ? String(userMoves) === key : key === 'failed');
  // Tallest bar stops at 92% so its count label has somewhere to sit.
  const pctOf = (count: number) => (count > 0 ? Math.max(3, (count / maxVal) * 92) : 0);
  return (
    <ChartFrame
      title={`How others solved it · ${total} players`}
      m={m}
      axis={keys.map(k => ({ key: k, text: isUser(k) ? 'You' : k === 'failed' ? 'X' : k, highlight: isUser(k) }))}
    >
      {keys.map(key => (
        <BarColumn key={key} pct={pctOf(dist[key] ?? 0)} count={dist[key] ?? 0} label={key} highlight={isUser(key)} accent={accent} m={m} />
      ))}
    </ChartFrame>
  );
};

const DistChartSkeleton = ({ maxGuesses, m }: { maxGuesses: number; m: ChartMetrics }) => {
  const keys = [...Array.from({ length: maxGuesses }, (_, i) => String(i + 1)), 'failed'];
  return (
    <ChartFrame title="How others solved it" m={m} axis={keys.map(k => ({ key: k, text: k === 'failed' ? 'X' : k, highlight: false }))}>
      {keys.map((key, i) => (
        <div key={key} style={{ width: m.barW, height: '100%', position: 'relative' }}>
          <div className="mm-skel" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${25 + (i % 3) * 20}%`, backgroundColor: '#1c2734', borderRadius: '3px 3px 0 0' }} />
        </div>
      ))}
    </ChartFrame>
  );
};

const EndScreen = ({
  won, guessCount, secret, pool, distData, streak, personalBest, isDaily, maxGuesses,
  commentText, onCommentChange, onPostComment, commentPosted, commentPosting,
}: {
  won: boolean; guessCount: number; secret: string[]; pool: MColor[]; distData: DistData | null;
  streak?: number | undefined; personalBest?: number | undefined; isDaily: boolean; maxGuesses: number;
  commentText: string; onCommentChange: (t: string) => void; onPostComment: () => void;
  commentPosted: boolean; commentPosting: boolean;
}) => {
  const { w, h } = useViewport();
  const tight = h < 680;
  const xtight = h < 570;
  const xxtight = h < 440; // landscape phones
  const xxxtight = h < 380; // smallest landscape phones

  const globalBest = distData
    ? (() => { for (let i = 1; i <= maxGuesses; i++) { if ((distData.dist[String(i)] ?? 0) > 0) return i; } return null; })()
    : null;

  const percentile = (won && distData && distData.total > 0)
    ? (() => {
        let better = distData.dist['failed'] ?? 0;
        for (let i = guessCount + 1; i <= maxGuesses; i++) better += distData.dist[String(i)] ?? 0;
        return Math.round((better / distData.total) * 100);
      })()
    : null;

  const accent = won ? '#39d97a' : '#e8543f';
  const gap = xxxtight ? 4 : xxtight ? 5 : xtight ? 7 : tight ? 10 : 16;
  const panel = {
    background: 'rgba(14,20,29,0.82)', border: '1px solid rgba(150,175,200,0.14)', borderRadius: 14,
    padding: xxxtight ? '4px 8px' : xxtight ? '5px 8px' : xtight ? '7px 8px' : tight ? '9px 9px' : '12px 10px',
  };
  const circle = xxxtight ? 20 : xxtight ? 22 : xtight ? 26 : tight ? 33 : 42;
  // Tablets get a wider column so the card doesn't sit as a thin strip.
  const colMax = w >= 560 ? 420 : 360;
  const colW = Math.min(w - 48, colMax);
  const chartM: ChartMetrics = {
    barW: Math.max(12, Math.min(22, Math.floor((colW - 24 - 3 * maxGuesses) / (maxGuesses + 1)))),
    labelFont: xxtight ? 8 : 9,
    axisFont: xxtight ? 8 : 9,
    titleFont: xxtight ? 8 : 9,
    titleGap: xxtight ? 4 : tight ? 8 : 10,
  };
  // The chart takes the slack, capped so it never dwarfs the rest on a tall screen.
  const chartMax = xxxtight ? 92 : xxtight ? 120 : xtight ? 170 : tight ? 230 : Math.min(330, Math.round(h * 0.38));
  const chartMin = xxxtight ? 58 : xxtight ? 70 : 90;
  const noteRows = xxxtight ? 1 : xxtight ? 2 : 3;
  const noteFont = xxtight ? 12 : tight ? 13 : 14;
  const btnFont = xxxtight ? 13 : xxtight ? 14 : tight ? 15 : 16;
  const btnPad = xxxtight ? 8 : xxtight ? 10 : tight ? 13 : 16;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50,
      background: '#0e141d',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      overflowY: 'auto', overflowX: 'hidden',
    }}>
      {/* Scene art + scrim — fixed to the viewport so it stays put if the card ever has to scroll */}
      <div style={{ position: 'fixed', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
        <img
          src={won ? '/vault-freed.webp' : '/vault-caged.webp'}
          alt=""
          decoding="async"
          fetchPriority="high"
          style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 40%', display: 'block', backgroundColor: '#141d29' }}
        />
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(14,20,29,0.52) 0%, rgba(14,20,29,0.80) 26%, rgba(14,20,29,0.90) 100%)',
        }} />
      </div>

      {/* Result sits at the top and the chart absorbs the slack, so the note box and
          the comment button can stay full-size without pushing anything off-screen. */}
      <div style={{
        position: 'relative', zIndex: 1, width: '100%', maxWidth: colMax, height: '100%',
        padding: `${xxxtight ? 6 : xxtight ? 8 : xtight ? 10 : tight ? 12 : 16}px 24px`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap,
      }}>

        {/* Result header */}
        <div style={{ textAlign: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: xtight ? 2 : 6 }}>
            <span style={{ fontSize: 12 }}>{won ? '🔓' : '🔒'}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: accent, letterSpacing: '0.16em', textTransform: 'uppercase', textShadow: `0 0 14px ${accent}99` }}>
              {won ? 'Freed' : 'Still Caged'}
            </span>
          </div>
          {won ? (
            <>
              <p style={{ fontSize: xxxtight ? 19 : xxtight ? 22 : xtight ? 26 : tight ? 32 : 42, fontWeight: 900, color: '#e8dcc4', margin: 0, lineHeight: 1, fontVariantNumeric: 'tabular-nums', textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}>
                In {guessCount}
              </p>
              <p style={{ fontSize: 11, color: '#d6c3a5', marginTop: 4, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
                {maxGuesses - guessCount} guess{maxGuesses - guessCount !== 1 ? 'es' : ''} to spare
                {globalBest !== null && <> · Global best: <span style={{ color: accent, fontWeight: 700 }}>{globalBest}</span></>}
              </p>
              {isDaily && (streak != null || personalBest != null) && (
                <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: xtight ? 3 : 6, textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>
                  {streak != null && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#d6c3a5' }}>
                      🔥 <span style={{ color: accent, fontWeight: 800 }}>{streak}</span>-day streak
                    </span>
                  )}
                  {personalBest != null && (
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#d6c3a5' }}>
                      Best: <span style={{ color: accent, fontWeight: 800 }}>{personalBest}</span>
                    </span>
                  )}
                </div>
              )}
            </>
          ) : (
            <p style={{ fontSize: xxxtight ? 18 : xxtight ? 20 : xtight ? 22 : tight ? 24 : 28, fontWeight: 900, color: '#e8dcc4', margin: 0, textShadow: '0 2px 12px rgba(0,0,0,0.8)' }}>Out of guesses</p>
          )}
        </div>

        {/* Hidden code */}
        <div style={{ width: '100%', flexShrink: 0, ...panel }}>
          <p style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8b9bad', marginBottom: xxtight ? 3 : xtight ? 5 : 8, textAlign: 'center' }}>
            The Hidden Code
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            {secret.map((hex, i) => {
              const num = poolIndex(hex, pool);
              return <ColorCircle key={i} hex={hex} num={num} size={circle} />;
            })}
          </div>
        </div>

        {/* Distribution — the only element that flexes */}
        <div style={{
          width: '100%', ...panel,
          flex: '1 1 auto', minHeight: chartMin, maxHeight: chartMax,
          display: 'flex', flexDirection: 'column',
        }}>
          {distData ? (
            <>
              <DistChart data={distData} userMoves={guessCount} won={won} maxGuesses={maxGuesses} accent={accent} m={chartM} />
              {percentile !== null && !xxxtight && (
                <p style={{ fontSize: 11, color: '#d6c3a5', textAlign: 'center', marginTop: xtight ? 3 : 6, flexShrink: 0 }}>
                  Better than <span style={{ color: accent, fontWeight: 800 }}>{percentile}%</span> of solvers
                </p>
              )}
            </>
          ) : (
            <DistChartSkeleton maxGuesses={maxGuesses} m={chartM} />
          )}
        </div>

        {/* Comment section */}
        <div style={{ width: '100%', flexShrink: 0 }}>
          {!commentPosted ? (
            <>
              <textarea
                value={commentText}
                onChange={e => onCommentChange(e.target.value)}
                placeholder="Add a note… (optional)"
                maxLength={500}
                rows={noteRows}
                style={{
                  width: '100%', resize: 'none', borderRadius: 12,
                  border: `1.5px solid ${accent}59`, background: 'rgba(26,36,50,0.92)', color: '#e8dcc4',
                  padding: xxtight ? '7px 11px' : '11px 14px', fontSize: noteFont, outline: 'none', boxSizing: 'border-box',
                  fontFamily: 'inherit', lineHeight: 1.4, display: 'block',
                }}
              />
              <button
                onClick={onPostComment}
                disabled={commentPosting}
                style={{
                  width: '100%', borderRadius: 999, padding: `${btnPad}px 0`, marginTop: xxtight ? 5 : 8,
                  background: accent, color: '#0a1408', fontWeight: 800, fontSize: btnFont,
                  border: 'none', cursor: 'pointer', opacity: commentPosting ? 0.6 : 1,
                  boxShadow: `0 4px 22px ${accent}66`,
                }}
              >
                {commentPosting ? 'Posting…' : 'Comment My Score'}
              </button>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, border: '1px solid rgba(57,217,122,0.3)', background: 'rgba(57,217,122,0.08)', padding: xxtight ? '8px 14px' : '14px 16px' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#39d97a' }}>✓ Comment posted!</span>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

// ── main component ────────────────────────────────────────────────────────────

const Mastermind = () => {
  const [puzzleData, setPuzzleData] = useState<PuzzleData | null>(null);
  const [currentGuess, setCurrentGuess] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [secret, setSecret] = useState<string[]>([]);
  const [distData, setDistData] = useState<DistData | null>(null);
  const [showEnd, setShowEnd] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [streak, setStreak] = useState<number | undefined>(undefined);
  const [personalBest, setPersonalBest] = useState<number | undefined>(undefined);
  const [commentText, setCommentText] = useState('');
  const [commentPosted, setCommentPosted] = useState(false);
  const [commentPosting, setCommentPosting] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 520);
  const [isShort, setIsShort] = useState(() => window.innerHeight < 700);
  const [boardHeight, setBoardHeight] = useState(0);
  const boardRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  const isCustom = puzzleData?.isCustom ?? false;
  // Custom (11 rows): size circle to fill the board height so all rows fit with no scroll.
  //   circle = boardHeight/11 - 2*padding, capped. Small padding + high cap ⇒ circles grow
  //   to fill the space on desktop/laptop while vertical fit still guarantees no scroll.
  // Daily (15 rows): fixed slightly-bigger circle, board scrolls vertically.
  let circleSize: number;
  let rowPaddingY: number;
  let boardPadBottom: number;
  if (isCustom) {
    rowPaddingY = 1;
    const cap = isMobile ? 60 : 84;
    boardPadBottom = isMobile ? 6 : rowPaddingY; // tidy gap above the picker on mobile
    circleSize = boardHeight > 0
      ? Math.max(20, Math.min(cap, Math.floor((boardHeight - rowPaddingY - boardPadBottom) / 11) - rowPaddingY * 2))
      : (isMobile ? 38 : 48);
  } else {
    circleSize = isMobile ? 32 : 34;
    rowPaddingY = isMobile ? 6 : 7;
    boardPadBottom = rowPaddingY;
  }
  const circleGap = Math.max(4, Math.round(circleSize * 0.15));
  const compact = isMobile && isShort; // small phones: trim header + bottom-bar chrome to free board height

  useEffect(() => {
    const compute = () => { setIsMobile(window.innerWidth < 520); setIsShort(window.innerHeight < 700); };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height;
      if (h) setBoardHeight(h);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isMobile, puzzleData?.configured, showEnd]);

  useEffect(() => {
    // Only scrolls when the active row is off-screen (block:'nearest'), signalling more rows remain.
    activeRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [puzzleData?.guesses.length]);

  useEffect(() => {
    trpc.mastermind.getPuzzle.query()
      .then(data => {
        setPuzzleData(data);
        if (data.completed) {
          if (data.secret) setSecret(data.secret);
          setShowEnd(true);
          setStreak(data.streak);
          setPersonalBest(data.personalBest);
        }
      })
      .catch(() => void showToast({ text: 'Failed to load', appearance: 'neutral' }));
    // Fetched up front, not at game over: the chart is then already in hand the
    // moment the end screen mounts. Re-fetched after the final guess to fold in
    // the player's own result.
    trpc.mastermind.getDistribution.query().then(setDistData).catch(() => {});
  }, []);


  if (!puzzleData) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0e141d', fontFamily: MONO_FONT }}>
        <p style={{ color: '#2f6b45', fontSize: 13 }}>Loading…</p>
      </div>
    );
  }

  if (!puzzleData.configured) {
    return (
      <div style={{ display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0e141d', gap: 10, fontFamily: MONO_FONT }}>
        <p style={{ color: '#e8dcc4', fontSize: 16, fontWeight: 700 }}>Puzzle not set up yet</p>
        {puzzleData.creator && <p style={{ color: '#8b9bad', fontSize: 13 }}>Waiting for u/{puzzleData.creator}</p>}
      </div>
    );
  }

  const { poolColors, guesses, completed, won } = puzzleData;
  const { maxGuesses, secretLen } = mmConfig(puzzleData.isCustom);
  const activeRowIndex = guesses.length;

  const addColor = (hex: string) => {
    if (currentGuess.length >= secretLen || submitting || completed) return;
    setCurrentGuess(prev => [...prev, hex]);
  };

  const deleteLast = () => {
    if (submitting || completed) return;
    setCurrentGuess(prev => prev.slice(0, -1));
  };

  const submitGuess = async () => {
    if (currentGuess.length < secretLen || submitting || completed) return;
    setSubmitting(true);
    try {
      const result = await trpc.mastermind.submitGuess.mutate({ colors: currentGuess });
      const newGuess: MGuess = { colors: currentGuess, greens: result.greens, yellows: result.yellows };
      setPuzzleData(prev => prev ? { ...prev, guesses: [...prev.guesses, newGuess], completed: result.completed, won: result.won } : prev);
      setCurrentGuess([]);
      if (result.completed) {
        setSecret(result.secret ?? []);
        setShowEnd(true);
        setStreak(result.streak);
        setPersonalBest(result.personalBest);
        trpc.mastermind.getDistribution.query().then(setDistData).catch(() => {});
      }
    } catch {
      void showToast({ text: 'Failed to submit', appearance: 'neutral' });
    } finally {
      setSubmitting(false);
    }
  };

  const handlePostComment = async () => {
    if (commentPosted || commentPosting || !puzzleData) return;
    setCommentPosting(true);
    const emojiGrid = guesses.map(g => [
      ...Array(g.greens).fill('🟩'),
      ...Array(g.yellows).fill('🟨'),
      ...Array(secretLen - g.greens - g.yellows).fill('⬛'),
    ].join('')).join('\n');
    try {
      await trpc.mastermind.postComment.mutate({
        text: commentText,
        won,
        guessCount: guesses.length,
        emojiGrid,
        isCustom: puzzleData.isCustom,
        title: puzzleData.title,
      });
      setCommentPosted(true);
    } catch {
      void showToast({ text: 'Failed to post comment.', appearance: 'neutral' });
    } finally {
      setCommentPosting(false);
    }
  };

  const dateLabel = puzzleData.isCustom
    ? (puzzleData.title ? puzzleData.title.toUpperCase() : 'CUSTOM')
    : `DAILY · ${formatDate(new Date().toISOString().split('T')[0]!)}`;

  // ── picker shared UI ──────────────────────────────────────────────────────

  const PickerSwatches = ({ swatchSize }: { swatchSize: number }) => (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', width: '100%' }}>
      {poolColors.map((color, i) => (
        <button
          key={i}
          onClick={() => addColor(color.hex)}
          disabled={currentGuess.length >= secretLen || completed}
          style={{
            flex: '1 1 0', minWidth: 0, maxWidth: swatchSize, aspectRatio: '1', borderRadius: '50%',
            backgroundColor: color.hex,
            border: '2.5px solid rgba(150,175,200,0.18)',
            cursor: currentGuess.length >= secretLen || completed ? 'default' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            opacity: currentGuess.length >= secretLen || completed ? 0.45 : 1,
            padding: 0,
            transition: 'transform 0.08s, opacity 0.15s',
          }}
        >
          <span style={{
            fontSize: swatchSize * 0.35, fontWeight: 900,
            color: needsDarkText(color.hex) ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.88)',
            textShadow: needsDarkText(color.hex) ? 'none' : '0 1px 3px rgba(0,0,0,0.5)',
            userSelect: 'none',
          }}>{i + 1}</span>
        </button>
      ))}
    </div>
  );

  const LegendItem = ({ kind, label, size = 9, font = 9 }: { kind: 'exact' | 'color'; label: string; size?: number; font?: number }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: font, fontWeight: 700, color: '#8b9bad', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
      <Mark size={size} kind={kind} />
      {label}
    </span>
  );

  const Legend = () => (
    <div style={{ display: 'flex', gap: 16, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
      <LegendItem kind="exact" label="Right color · Right spot" />
      <LegendItem kind="color" label="Right color · Wrong spot" />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0e141d', position: 'relative', overflow: 'hidden', fontFamily: MONO_FONT }}>

      {/* ── Header ── */}
      <div ref={headerRef} style={{
        flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10,
        padding: compact ? '5px 14px' : '10px 14px', borderBottom: '1px solid #1a2432',
      }}>
        <Logo />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, fontWeight: 900, color: '#ff6b35', letterSpacing: '0.1em', textTransform: 'uppercase', margin: 0, lineHeight: 1 }}>
            The Rescue
          </p>
          {!compact && (
            <p style={{ fontSize: 9, fontWeight: 600, color: '#2f6b45', letterSpacing: '0.08em', textTransform: 'uppercase', margin: '3px 0 0' }}>
              {dateLabel}
            </p>
          )}
        </div>
        {!isMobile && <ProgressDots count={guesses.length} total={maxGuesses} />}
        <p style={{ fontSize: 18, fontWeight: 900, color: '#e8dcc4', margin: 0, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {guesses.length}<span style={{ fontSize: 11, color: '#2f6b45', fontWeight: 600 }}>/{maxGuesses}</span>
        </p>
        <button
          onClick={() => setShowHelp(true)}
          style={{ width: 24, height: 24, borderRadius: '50%', background: '#1a2432', border: '1px solid #2a3846', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0, padding: 0 }}
        >
          <span style={{ fontSize: 11, fontWeight: 800, color: '#d6c3a5', lineHeight: 1 }}>?</span>
        </button>
      </div>

      {/* ── Body ── */}
      <div
        style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', overflow: 'hidden', minHeight: 0, position: 'relative' }}
        onWheel={isMobile ? undefined : (e) => {
          if (boardRef.current && !boardRef.current.contains(e.target as Node)) boardRef.current.scrollBy({ top: e.deltaY });
        }}
      >

        {/* Board */}
        <div ref={boardRef} className="mastermind-board" style={{
          ...(isMobile ? { flex: 1, width: '100%' } : { flexShrink: 0 }),
          minHeight: 0, overflowY: 'auto', overflowX: 'hidden', paddingTop: rowPaddingY, paddingBottom: boardPadBottom,
        }}>
          {Array.from({ length: maxGuesses }, (_, i) => {
            const isActive = i === activeRowIndex && !completed;
            return (
              <div key={i} {...(isActive ? { ref: activeRowRef } : {})}>
                <BoardRow
                  rowNum={i + 1}
                  {...(guesses[i] ? { guess: guesses[i] } : {})}
                  isActive={isActive}
                  {...(isActive ? { currentColors: currentGuess, fillCount: currentGuess.length } : {})}
                  pool={poolColors}
                  circleSize={circleSize}
                  circleGap={circleGap}
                  paddingY={rowPaddingY}
                  secretLen={secretLen}
                />
              </div>
            );
          })}
        </div>

        {/* Desktop right panel */}
        {!isMobile && !completed && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '0 14px 12px', gap: 8 }}>
            <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2f6b45', textAlign: 'center', margin: 0 }}>
              Pick a Color
            </p>
            <PickerSwatches swatchSize={40} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <button onClick={() => void submitGuess()} disabled={currentGuess.length < secretLen || submitting} style={{
                width: currentGuess.length >= secretLen ? 116 : 100, height: 30, borderRadius: 999,
                background: currentGuess.length >= secretLen ? '#ff6b35' : '#2f3d4c',
                color: currentGuess.length >= secretLen ? '#1a0d06' : '#8b9bad',
                fontWeight: 800, fontSize: 13, border: 'none', cursor: 'pointer',
                opacity: submitting ? 0.6 : 1,
                boxShadow: currentGuess.length >= secretLen ? '0 3px 12px rgba(255,107,53,0.4)' : 'none',
              }}>
                {submitting ? '…' : currentGuess.length >= secretLen ? 'Submit Guess' : `${currentGuess.length}/${secretLen}`}
              </button>
              <button onClick={deleteLast} disabled={currentGuess.length === 0} style={{
                width: 80, height: 30, borderRadius: 999, background: '#1a2432',
                color: '#d6c3a5', fontWeight: 700, fontSize: 11,
                border: '1px solid #2f3d4c', cursor: 'pointer',
                opacity: currentGuess.length === 0 ? 0.35 : 1,
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
              }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
                Delete
              </button>
            </div>
            <Legend />
          </div>
        )}

      </div>

      {/* Mobile bottom bar */}
      {isMobile && !completed && (
        <div style={{ flexShrink: 0, background: '#0a120c', padding: compact ? '5px 14px 6px' : '8px 14px 8px', borderTop: '1px solid #1a2432' }}>
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#2f6b45', textAlign: 'center', margin: compact ? '0 0 4px' : '0 0 6px' }}>
            Tap to Add
          </p>
          <PickerSwatches swatchSize={56} />
          <div style={{ display: 'flex', gap: 8, marginTop: compact ? 6 : 8, alignItems: 'center' }}>
            <button onClick={deleteLast} disabled={currentGuess.length === 0} style={{
              width: 90, height: 42, borderRadius: 999, background: '#1a2432',
              color: '#d6c3a5', fontWeight: 700, fontSize: 12,
              border: '1px solid #2f3d4c', cursor: 'pointer',
              opacity: currentGuess.length === 0 ? 0.35 : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
            }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>
              Delete
            </button>
            <button onClick={() => void submitGuess()} disabled={currentGuess.length < secretLen || submitting} style={{
              flex: 1, height: 42, borderRadius: 999,
              background: currentGuess.length >= secretLen ? '#ff6b35' : '#2f3d4c',
              color: currentGuess.length >= secretLen ? '#1a0d06' : '#8b9bad',
              fontWeight: 800, fontSize: 14, border: 'none', cursor: 'pointer',
              opacity: submitting ? 0.6 : 1,
              boxShadow: currentGuess.length >= secretLen ? '0 3px 12px rgba(255,107,53,0.4)' : 'none',
            }}>
              {submitting ? '…' : currentGuess.length >= secretLen ? 'Submit Guess' : `${currentGuess.length}/${secretLen}`}
            </button>
          </div>
          {!compact && (
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap', marginTop: 5 }}>
              <LegendItem kind="exact" label="Right spot" size={8} font={8} />
              <LegendItem kind="color" label="Wrong spot" size={8} font={8} />
            </div>
          )}
        </div>
      )}

      {/* ── End screen ── */}
      {showEnd && (
        <EndScreen
          won={won}
          guessCount={guesses.length}
          secret={secret}
          pool={poolColors}
          distData={distData}
          streak={streak}
          personalBest={personalBest}
          isDaily={!puzzleData.isCustom}
          maxGuesses={maxGuesses}
          commentText={commentText}
          onCommentChange={setCommentText}
          onPostComment={() => void handlePostComment()}
          commentPosted={commentPosted}
          commentPosting={commentPosting}
        />
      )}

      {/* ── Help overlay ── */}
      {showHelp && (
        <div
          style={{ position: 'absolute', inset: 0, zIndex: 60, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflowY: 'auto' }}
          onClick={() => setShowHelp(false)}
        >
          <div
            style={{ background: '#0e141d', borderRadius: 20, padding: '24px 22px', width: '100%', maxWidth: 320, margin: 'auto', border: '1px solid #2f3d4c' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <p style={{ fontSize: 15, fontWeight: 900, color: '#e8dcc4', margin: 0 }}>How to Play</p>
              <button onClick={() => setShowHelp(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8b9bad', fontSize: 18, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              {[
                { icon: '🎯', text: `Pick ${secretLen} colors from the palette and submit your guess` },
                { icon: <Mark size={16} kind="exact" />, text: '2● — two are the right color in the right spot' },
                { icon: <Mark size={16} kind="color" />, text: '1◐ — one more is the right color, but the wrong spot' },
                { icon: '🔢', text: "The number counts matches — it never says which slot is right" },
                { icon: '⬛', text: 'No marks at all means none of your colors are in the code' },
                { icon: '🔐', text: `Crack the ${secretLen}-color code in ${maxGuesses} tries or fewer` },
              ].map(({ icon, text }) => (
                <div key={text} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 18, flexShrink: 0, lineHeight: 1.3, width: 20, display: 'flex', justifyContent: 'center', paddingTop: typeof icon === 'string' ? 0 : 2 }}>{icon}</span>
                  <p style={{ fontSize: 13, color: '#e8dcc4', margin: 0, lineHeight: 1.45 }}>{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Mastermind />
  </StrictMode>
);

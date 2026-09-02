import './index.css';

import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { MEMORY_CONFIG, memorizeMs as sharedMemorizeMs } from '../shared/memory-core';
import { inkOn } from '../shared/ink';
import { audioCtx, unlock } from './audio';

type RunData = inferRouterOutputs<AppRouter>['memory']['getRun'];
type LbData = inferRouterOutputs<AppRouter>['memory']['getLeaderboard'];
type SubmitResult = inferRouterOutputs<AppRouter>['memory']['submitStack'];
type Phase = 'loading' | 'ready' | 'memorize' | 'recall' | 'stackWin' | 'runOver' | 'leaderboard' | 'error';

type Stack = { size: number; sequence: number[]; memorizeMs: number };

const START_SIZE = MEMORY_CONFIG.startSize;
const MAX_SIZE = MEMORY_CONFIG.maxSize;
const pad2 = (n: number) => String(n).padStart(2, '0');

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { if (i === retries - 1) throw e; await new Promise(r => setTimeout(r, delayMs * (i + 1))); }
  }
  throw new Error('unreachable');
}

// ── Audio ─────────────────────────────────────────────────────────────────────
function tone(freq: number, dur: number, vol = 0.15, type: OscillatorType = 'sine') {
  try {
    const c = audioCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination); osc.type = type;
    const t = c.currentTime; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch { /* noop */ }
}
const sfxTap = () => tone(660, 0.07, 0.12);
const sfxTick = (p: number) => tone(900 - p * 300, 0.02, 0.05);
const sfxBeep = () => tone(520, 0.09, 0.1);
const sfxWin = () => { tone(660, 0.09, 0.14); setTimeout(() => tone(990, 0.15, 0.14), 90); };
const sfxFail = () => { tone(300, 0.14, 0.16, 'sawtooth'); setTimeout(() => tone(170, 0.24, 0.14, 'sawtooth'), 120); };

// ── Theme ───────────────────────────────────────────────────────────────────
const BG = 'radial-gradient(120% 90% at 50% -10%, #241f4d 0%, #14122a 45%, #0b0a16 100%)';
const ACCENT = '#818cf8';
const GRAD = 'linear-gradient(135deg,#6366f1,#a855f7)';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

const SoundIcon = ({ muted }: { muted: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    {muted ? (<><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>) : (<><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></>)}
  </svg>
);

// Colour-blind assist: numbers every colour so the stack can be read without
// relying on hue alone.
const LABELS_KEY = 'memory:labels';
const loadLabels = () => { try { return localStorage.getItem(LABELS_KEY) === '1'; } catch { return false; } };
const saveLabels = (on: boolean) => { try { localStorage.setItem(LABELS_KEY, on ? '1' : '0'); } catch { /* noop */ } };

const LabelsIcon = ({ on }: { on: boolean }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
    <circle cx="12" cy="12" r="3" />
    {!on && <line x1="3" y1="21" x2="21" y2="3" />}
  </svg>
);

const AVATAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#a855f7'];
const InitialAvatar = ({ name, size = 28 }: { name: string; size?: number }) => {
  const bg = AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;
  return <div style={{ width: size, height: size, borderRadius: '50%', backgroundColor: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{name[0]?.toUpperCase()}</div>;
};
const UserAvatar = ({ name, url, size = 28 }: { name: string; url?: string | undefined; size?: number }) =>
  url ? <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
      : <InitialAvatar name={name} size={size} />;

// ── Global keyframes ────────────────────────────────────────────────────────
const Styles = () => (
  <style>{`
    @keyframes barIn { from { opacity:0; transform: translateY(-8px) scale(0.96); } to { opacity:1; transform:none; } }
    @keyframes popIn { 0%{ transform: scale(0.6); opacity:0; } 60%{ transform: scale(1.08); } 100%{ transform: scale(1); opacity:1; } }
    @keyframes glowPulse { 0%,100%{ box-shadow:0 0 0 0 rgba(129,140,248,0.5);} 50%{ box-shadow:0 0 0 4px rgba(129,140,248,0.12);} }
    @keyframes floatBars { 0%,100%{ transform: translateY(0);} 50%{ transform: translateY(-6px);} }
    @keyframes shake { 0%,100%{transform:translateX(0);} 20%{transform:translateX(-6px);} 40%{transform:translateX(6px);} 60%{transform:translateX(-4px);} 80%{transform:translateX(4px);} }
    .mem-scroll::-webkit-scrollbar{ width:0; height:0; }
  `}</style>
);

// ── Stack of bars ─────────────────────────────────────────────────────────────
const StackBars = ({ colors, nums, activeIdx, animate, shake }: { colors: (string | null)[]; nums?: (number | null)[] | undefined; activeIdx?: number; animate?: boolean; shake?: boolean }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%', maxWidth: 210, height: '100%', margin: '0 auto', animation: shake ? 'shake 0.4s' : undefined }}>
    {colors.map((c, i) => {
      const active = i === activeIdx;
      const n = nums?.[i];
      return (
        <div key={i} style={{
          flex: 1, minHeight: 0, borderRadius: 11,
          background: c ?? 'rgba(255,255,255,0.04)',
          border: c ? '1px solid rgba(255,255,255,0.14)' : `2px dashed ${active ? ACCENT : 'rgba(255,255,255,0.16)'}`,
          boxShadow: c ? '0 3px 10px rgba(0,0,0,0.35)' : 'none',
          animation: active ? 'glowPulse 1.3s ease-in-out infinite' : (animate && c ? `barIn 0.28s ease ${i * 0.05}s both` : undefined),
          transition: 'background 0.12s',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}>
          {c && n != null && (
            <span style={{ fontSize: 15, fontWeight: 900, lineHeight: 1, color: inkOn(c) }}>{n}</span>
          )}
        </div>
      );
    })}
  </div>
);

// ── Leaderboard ────────────────────────────────────────────────────────────────
const Leaderboard = ({ onClose }: { onClose: () => void }) => {
  const [data, setData] = useState<LbData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { trpc.memory.getLeaderboard.query().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const entries = data?.top ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff' }}>
      <Styles />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 12px', flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Today's Deepest Runs</h2>
        <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', color: '#a1a1aa', fontSize: 15 }}>✕</button>
      </div>
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#71717a' }}>Loading…</p></div>
      ) : entries.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#71717a' }}>No runs yet. Be the first!</p></div>
      ) : (
        <div className="mem-scroll" style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 10px 16px' }}>
          {entries.map((entry, i) => {
            const rank = i + 1;
            const isMe = entry.member === username;
            const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
            return (
              <div key={entry.member} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', margin: '4px 0', borderRadius: 12, background: isMe ? 'rgba(129,140,248,0.16)' : CARD, border: isMe ? `1px solid ${ACCENT}` : `1px solid ${BORDER}` }}>
                <div style={{ width: 24, textAlign: 'center', fontSize: medal ? 16 : 13, fontWeight: 800, color: '#a1a1aa' }}>{medal ?? rank}</div>
                <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d4d4d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  {entry.reached != null && (
                    <p style={{ fontSize: 11, color: entry.cleared ? '#34d399' : '#71717a', margin: '1px 0 0', fontWeight: 600 }}>Stack {entry.reached} {entry.cleared ? '✓' : '✗'}</p>
                  )}
                </div>
                <p style={{ fontSize: 14, fontWeight: 800, color: isMe ? ACCENT : '#e4e4e7', margin: 0 }}>{entry.score}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ── Slim header ─────────────────────────────────────────────────────────────
const GameHeader = ({ size, muted, onMute, labels, onLabels }: { size: number; muted: boolean; onMute: () => void; labels: boolean; onLabels: () => void }) => {
  const prog = (size - START_SIZE) / (MAX_SIZE - START_SIZE);
  return (
    <div style={{ flexShrink: 0, padding: '12px 16px 8px', maxWidth: 480, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.18em', color: '#71717a' }}>STACK</span>
          <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', lineHeight: 1 }}>{pad2(size)}</span>
          <span style={{ fontSize: 11, color: '#52525b' }}>/ {MAX_SIZE}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <button onClick={onLabels} aria-label="Number the colours" aria-pressed={labels}
            style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: labels ? ACCENT : '#71717a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LabelsIcon on={labels} /></button>
          <button onClick={onMute} aria-label="Mute" aria-pressed={muted} style={{ width: 30, height: 30, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', color: '#71717a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><SoundIcon muted={muted} /></button>
        </div>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(4, prog * 100)}%`, background: GRAD, borderRadius: 2, transition: 'width 0.4s' }} />
      </div>
    </div>
  );
};

// Placeholder shown instantly on boot so the ready-countdown renders with zero
// network wait; startSize/memorizeMs are deterministic, only `sequence` (needed
// once memorize starts) has to wait on the server.
const PLACEHOLDER_STACK: Stack = { size: START_SIZE, sequence: [], memorizeMs: sharedMemorizeMs(START_SIZE) };

export const MemoryGame = () => {
  const [phase, setPhase] = useState<Phase>('ready');
  const [run, setRun] = useState<RunData | null>(null);
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;
  const [labels, setLabels] = useState(loadLabels);

  const [stack, setStack] = useState<Stack | null>(PLACEHOLDER_STACK);
  const stackRef = useRef(stack);
  stackRef.current = stack;
  const [taps, setTaps] = useState<number[]>([]);
  const [progress, setProgress] = useState(1);
  const [readyN, setReadyN] = useState(3);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [failAnswer, setFailAnswer] = useState<number[]>([]);
  const [posting, setPosting] = useState(false);
  const [posted, setPosted] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [wrongShake, setWrongShake] = useState(false);

  const rafRef = useRef(0);

  // Boot: fetch run data in the background — the ready-countdown UI is already
  // showing (see PLACEHOLDER_STACK) so there's no loading screen to wait through.
  useEffect(() => {
    unlock();
    void (async () => {
      try {
        const d = await withRetry(() => trpc.memory.getRun.query());
        setRun(d);
        const s = await trpc.memory.beginRun.mutate();
        setStack(s);
      } catch {
        void showToast({ text: 'Could not start run.', appearance: 'neutral' });
        setPhase('error');
      }
    })();
  }, []);

  // Ready countdown 3→GO→memorize
  useEffect(() => {
    if (phase !== 'ready') return;
    let cancelled = false;
    let n = 3; setReadyN(3);
    if (!mutedRef.current) sfxBeep();
    const id = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(id);
        // The countdown runs off a local placeholder so it starts instantly;
        // if beginRun's real sequence hasn't landed yet (slow network), wait
        // for it rather than entering memorize phase with an empty sequence.
        const advance = () => {
          if (cancelled) return;
          if (stackRef.current && stackRef.current.sequence.length > 0) { setProgress(1); setPhase('memorize'); }
          else setTimeout(advance, 100);
        };
        advance();
      } else { setReadyN(n); if (!mutedRef.current) sfxBeep(); }
    }, 650);
    return () => { cancelled = true; clearInterval(id); };
  }, [phase, stack?.size]);

  // Memorize countdown driver
  useEffect(() => {
    if (phase !== 'memorize' || !stack) return;
    const dur = stack.memorizeMs;
    const t0 = performance.now();
    let lastSec = Math.ceil(dur / 1000) + 1;
    const step = (now: number) => {
      const p = Math.max(0, 1 - (now - t0) / dur);
      setProgress(p);
      const secs = Math.ceil((p * dur) / 1000);
      if (!mutedRef.current && secs < lastSec && secs > 0) { lastSec = secs; sfxTick(1 - p); }
      if (p <= 0) { cancelAnimationFrame(rafRef.current); setTaps([]); setPhase('recall'); return; }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [phase, stack]);

  const palette = run?.palette ?? [];
  const pSize = stack && stack.size >= 10 ? 8 : 6;

  // Rebuild is BOTTOM-TO-TOP: taps[0] fills the bottom bar.
  const tapColor = (idx: number) => {
    if (!stack || taps.length >= stack.size) return;
    if (!mutedRef.current) sfxTap();
    setTaps(t => [...t, idx]);
  };
  const undo = () => { if (!taps.length) return; if (!mutedRef.current) sfxTap(); setTaps(t => t.slice(0, -1)); };

  const submitStack = async () => {
    if (!stack || taps.length !== stack.size || submitting) return;
    setSubmitting(true);
    const answer = [...taps].reverse(); // taps are bottom→top; server wants top→bottom
    try {
      const r = await trpc.memory.submitStack.mutate({ size: stack.size, answer });
      if (r.runOver) {
        setResult(r); setFailAnswer(answer);
        if (r.failed) { if (!mutedRef.current) sfxFail(); setWrongShake(true); setTimeout(() => setWrongShake(false), 450); }
        else if (!mutedRef.current) sfxWin();
        setPhase('runOver');
      } else {
        if (!mutedRef.current) sfxWin();
        setPhase('stackWin');
        setTimeout(() => { if (r.nextStack) { setStack(r.nextStack); setTaps([]); setProgress(1); setPhase('memorize'); } }, 1050);
      }
    } catch {
      void showToast({ text: 'Submit failed — try again.', appearance: 'neutral' });
    } finally { setSubmitting(false); }
  };

  const buildGrid = (reached: number, failed: boolean): string => {
    const greens = failed ? Math.max(0, reached - START_SIZE) : (MAX_SIZE - START_SIZE + 1);
    return '🟩'.repeat(greens) + (failed ? '🟥' : '');
  };

  const postScore = async () => {
    if (!result || !result.runOver || posting || posted) return;
    if (!mutedRef.current) sfxTap();
    setPosting(true);
    try {
      await trpc.memory.postComment.mutate({
        text: commentText, score: result.score ?? 0, reachedStack: result.reachedStack ?? 0,
        topPct: result.topPct ?? null, grid: buildGrid(result.reachedStack ?? 0, result.failed ?? false),
        userRank: result.userRank ?? null, playerCount: result.playerCount ?? null,
        streak: result.streak ?? null, lifetimeRuns: result.lifetimeRuns ?? null,
      });
      setPosted(true);
    } catch { void showToast({ text: 'Could not post.', appearance: 'neutral' }); }
    finally { setPosting(false); }
  };

  const onMute = () => setMuted(m => !m);
  const onLabels = () => setLabels(v => { saveLabels(!v); return !v; });

  // ── Loading / error ──────────────────────────────────────────────────────────
  if (phase === 'loading') return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: BG, color: '#a1a1aa' }}>Loading…</div>;
  if (phase === 'error') return <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: BG, color: '#f87171', padding: 16, textAlign: 'center' }}>Failed to load. Please refresh.</div>;
  if (phase === 'leaderboard') return <Leaderboard onClose={() => setPhase(result ? 'runOver' : 'loading')} />;

  // ── Ready countdown ─────────────────────────────────────────────────────────────
  if (phase === 'ready' && stack) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff' }}>
        <Styles />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
          <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.22em', color: '#71717a', margin: 0 }}>STACK {pad2(stack.size)}</p>
          <div key={readyN} style={{ fontSize: 96, fontWeight: 900, lineHeight: 1, background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'popIn 0.4s ease' }}>{readyN}</div>
          <p style={{ fontSize: 13, color: '#a1a1aa', margin: 0 }}>Get ready…</p>
        </div>
      </div>
    );
  }

  // ── Memorize ──────────────────────────────────────────────────────────────────
  if (phase === 'memorize' && stack) {
    const colors = stack.sequence.map(idx => palette[idx]?.hex ?? '#000');
    const nums = labels ? stack.sequence.map(idx => idx + 1) : undefined;
    const secs = Math.ceil((progress * stack.memorizeMs) / 1000);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
        <Styles />
        <GameHeader size={stack.size} muted={muted} onMute={onMute} labels={labels} onLabels={onLabels} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '6px 16px 18px', maxWidth: 480, margin: '0 auto', width: '100%' }}>
          <div style={{ textAlign: 'center', flexShrink: 0, marginBottom: 8 }}>
            <p style={{ fontSize: 16, fontWeight: 800, margin: 0 }}>Memorize the order</p>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: '#71717a', margin: '2px 0 0' }}>You'll rebuild it <span style={{ color: ACCENT, fontWeight: 800 }}>bottom → top</span></p>
            <p style={{ fontSize: 34, fontWeight: 900, margin: '2px 0 0', color: progress < 0.3 ? '#f87171' : ACCENT, fontVariantNumeric: 'tabular-nums' }}>{secs}<span style={{ fontSize: 14, color: '#71717a', fontWeight: 700 }}>s</span></p>
          </div>
          <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', animation: 'floatBars 3.5s ease-in-out infinite' }}>
            <StackBars colors={colors} nums={nums} animate />
          </div>
        </div>
      </div>
    );
  }

  // ── Recall (build bottom-to-top) ────────────────────────────────────────────────
  if (phase === 'recall' && stack) {
    const slots: (string | null)[] = Array.from({ length: stack.size }, (_, p) => {
      const fromBottom = stack.size - 1 - p;
      return fromBottom < taps.length ? (palette[taps[fromBottom]!]?.hex ?? '#000') : null;
    });
    const slotNums = labels ? Array.from({ length: stack.size }, (_, p) => {
      const fromBottom = stack.size - 1 - p;
      return fromBottom < taps.length ? taps[fromBottom]! + 1 : null;
    }) : undefined;
    const activeIdx = taps.length < stack.size ? stack.size - 1 - taps.length : -1;
    const full = taps.length === stack.size;
    const activePalette = palette.slice(0, pSize);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
        <Styles />
        <GameHeader size={stack.size} muted={muted} onMute={onMute} labels={labels} onLabels={onLabels} />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '4px 16px 14px', maxWidth: 480, margin: '0 auto', width: '100%' }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: '#a1a1aa', margin: '0 0 6px', flexShrink: 0 }}>
            Rebuild <span style={{ color: ACCENT, fontWeight: 800 }}>bottom → top</span> · {taps.length}/{stack.size}
          </p>
          <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', marginBottom: 10 }}>
            <StackBars colors={slots} nums={slotNums} activeIdx={activeIdx} shake={wrongShake} />
          </div>
          <div style={{ flexShrink: 0, width: '100%', maxWidth: 300, display: 'grid', gridTemplateColumns: `repeat(${pSize === 6 ? 3 : 4}, 1fr)`, gap: 9, marginBottom: 10 }}>
            {activePalette.map((c, i) => (
              <button key={i} onClick={() => tapColor(i)} disabled={full} aria-label={c.name}
                style={{ aspectRatio: '1.35', borderRadius: 13, background: c.hex, border: '1px solid rgba(255,255,255,0.18)', cursor: full ? 'default' : 'pointer', opacity: full ? 0.5 : 1, boxShadow: '0 3px 10px rgba(0,0,0,0.4)', transition: 'transform 0.08s', transform: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 900, color: inkOn(c.hex), padding: 0 }}
                onPointerDown={e => { if (!full) (e.currentTarget as HTMLButtonElement).style.transform = 'scale(0.92)'; }}
                onPointerUp={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; }}
                onPointerLeave={e => { (e.currentTarget as HTMLButtonElement).style.transform = 'none'; }}>
                {labels ? i + 1 : ''}
              </button>
            ))}
          </div>
          <div style={{ flexShrink: 0, width: '100%', maxWidth: 300, display: 'flex', gap: 8 }}>
            <button onClick={undo} disabled={taps.length === 0}
              style={{ flexShrink: 0, height: 50, padding: '0 20px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: '#e4e4e7', fontWeight: 700, fontSize: 14, border: `1px solid ${BORDER}`, cursor: taps.length ? 'pointer' : 'default', opacity: taps.length ? 1 : 0.4 }}>
              Undo
            </button>
            <button onClick={submitStack} disabled={!full || submitting}
              style={{ flex: 1, height: 50, borderRadius: 999, background: full ? GRAD : 'rgba(255,255,255,0.08)', color: full ? '#fff' : '#71717a', fontWeight: 800, fontSize: 15, border: 'none', cursor: full && !submitting ? 'pointer' : 'default', boxShadow: full ? '0 4px 18px rgba(99,102,241,0.45)' : 'none' }}>
              {submitting ? 'Checking…' : full ? 'Lock it in' : `Tap ${stack.size - taps.length} more`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Stack cleared flash ─────────────────────────────────────────────────────────
  if (phase === 'stackWin' && stack) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff' }}>
        <Styles />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center' }}>
          <div style={{ fontSize: 52, animation: 'popIn 0.4s ease' }}>⚡</div>
          <p style={{ fontSize: 28, fontWeight: 900, margin: 0, background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Stack {stack.size} cleared!</p>
          <p style={{ fontSize: 14, color: '#a1a1aa', margin: 0 }}>Climbing to Stack {stack.size + 1}…</p>
        </div>
      </div>
    );
  }

  // ── Run over ───────────────────────────────────────────────────────────────────
  if (phase === 'runOver' && result && result.runOver) {
    const won = !result.failed;
    const truth = result.sequence;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
        <Styles />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: '16px 18px 16px', maxWidth: 420, margin: '0 auto', width: '100%' }}>
          {/* Hero */}
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 34, animation: 'popIn 0.4s ease' }}>{won ? '🏆' : '🎯'}</div>
            <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: '#71717a', margin: '2px 0 0' }}>YOU REACHED</p>
            <p style={{ fontSize: 44, fontWeight: 900, margin: 0, lineHeight: 1.05, background: GRAD, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Stack {result.reachedStack}</p>
            <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', marginTop: 8, padding: '5px 14px', borderRadius: 999, background: CARD, border: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: '#fff' }}>{result.score} pts</span>
              {result.topPct != null && <><span style={{ color: '#3f3f46' }}>·</span><span style={{ fontSize: 13, fontWeight: 700, color: ACCENT }}>Top {result.topPct}%</span></>}
            </div>
            <p style={{ fontSize: 15, letterSpacing: 1, margin: '8px 0 0' }}>{buildGrid(result.reachedStack ?? 0, result.failed ?? false)}</p>
            {won && <p style={{ fontSize: 13, fontWeight: 700, color: '#34d399', margin: '6px 0 0' }}>Perfect — all {MAX_SIZE} cleared!</p>}
            {result.recorded && (
              <p style={{ fontSize: 10, color: '#52525b', margin: '4px 0 0', letterSpacing: '0.02em' }}>
                {[
                  result.userRank != null ? `🏅 #${result.userRank} today` : null,
                  result.streak != null && result.streak > 1 ? `🔥 ${result.streak}-day streak` : null,
                  result.lifetimeRuns != null ? `📊 ${result.lifetimeRuns} lifetime run${result.lifetimeRuns === 1 ? '' : 's'}` : null,
                ].filter(Boolean).join('   ·   ')}
              </p>
            )}
          </div>

          {/* Failed-stack reveal */}
          {result.failed && (
            <div style={{ flexShrink: 0, marginTop: 12 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', color: '#71717a', textAlign: 'center', margin: '0 0 6px' }}>STACK {result.reachedStack} · {result.correctCount}/{truth.length} RIGHT</p>
              <div style={{ display: 'flex', gap: 22, justifyContent: 'center' }}>
                {[{ label: 'ANSWER', seq: truth, cmp: false }, { label: 'YOU', seq: failAnswer, cmp: true }].map(col => (
                  <div key={col.label} style={{ textAlign: 'center' }}>
                    <p style={{ fontSize: 9, fontWeight: 700, color: '#52525b', margin: '0 0 5px', letterSpacing: '0.1em' }}>{col.label}</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {col.seq.map((idx, i) => {
                        const wrong = col.cmp && idx !== truth[i];
                        const hex = palette[idx]?.hex ?? '#000';
                        return (
                          <div key={i} style={{ width: 34, height: labels ? 15 : 11, borderRadius: 4, background: hex, outline: wrong ? '2px solid #f87171' : 'none', outlineOffset: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {labels && <span style={{ fontSize: 10, fontWeight: 900, lineHeight: 1, color: inkOn(hex) }}>{idx + 1}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ flex: 1, minHeight: 8 }} />

          {/* Actions */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!posted ? (
              <>
                <input value={commentText} onChange={e => setCommentText(e.target.value)} placeholder="Add a note… (optional)" maxLength={500}
                  style={{ width: '100%', borderRadius: 12, border: `1px solid ${BORDER}`, background: CARD, padding: '11px 14px', fontSize: 14, color: '#fff', outline: 'none' }} />
                <button onClick={postScore} disabled={posting}
                  style={{ width: '100%', height: 48, borderRadius: 999, background: GRAD, color: '#fff', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', opacity: posting ? 0.6 : 1, boxShadow: '0 4px 18px rgba(99,102,241,0.4)' }}>
                  {posting ? 'Posting…' : 'Comment My Depth'}
                </button>
              </>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', padding: '11px' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>✓ Posted!</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <div style={{ height: '100vh', background: BG }} />;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryGame />
  </StrictMode>
);

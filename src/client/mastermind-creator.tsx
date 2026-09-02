import './index.css';

import { StrictMode, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { audioCtx } from './audio';
import { MASTERMIND_CONFIG } from '../shared/mastermind-core';

const { poolSize: POOL_SIZE, secretLen: SECRET_LEN } = MASTERMIND_CONFIG.custom;

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

type PColor = { name: string; hex: string };

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hexToHsv(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

type WheelProps = {
  hue: number; sat: number; val: number;
  maxW: number; maxH: number;
  onChange: (h: number, s: number, v: number) => void;
};

const WHEEL_GAP = 14;
// Same budget ColorGuessr custom mode uses (see WheelPicker): cap the wheel, fix the
// bar height, then let the measured box shrink both further on short screens.
const WHEEL_MAX_MOBILE = 250;
const WHEEL_MAX_DESKTOP = 210;

// Module scope so both steps can tick, on the shared context that audio.ts already
// unlocks from the first pointerdown — iOS WKWebView never unlocks from a pointermove.
const playNote = (freq: number, dur = 0.08) => {
  const ctx = audioCtx();
  if (!ctx) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start();
    osc.stop(ctx.currentTime + dur);
  } catch { /* audio not available */ }
};

// Rising G major arpeggio, staggered to land with the plate's lock ripple.
const LOCK_IN = [392, 493.88, 587.33, 783.99];
const playLockIn = () => {
  LOCK_IN.forEach((f, i) => {
    setTimeout(() => playNote(f, i === LOCK_IN.length - 1 ? 0.28 : 0.12), i * 60);
  });
};

// One chromatic step per swatch, so each colour keeps its own pitch across both steps.
const swatchNote = (i: number) => playNote(220 * Math.pow(2, i / 12));

const ColorWheelPicker = ({ hue, sat, val, maxW, maxH, onChange }: WheelProps) => {
  const wheelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<'wheel' | 'bar' | null>(null);
  const lastNoteRef = useRef(-1);
  const lastBarStepRef = useRef(-1);
  const isMobile = window.innerWidth < 480;
  const barH = isMobile ? 30 : 25;
  const knob = 24;
  const dot = 22;
  // Capped like ColorGuessr, then clamped to the measured box so nothing ever scrolls.
  const size = Math.max(90, Math.min(
    maxW,
    maxH - WHEEL_GAP - barH - 8,
    isMobile ? WHEEL_MAX_MOBILE : WHEEL_MAX_DESKTOP,
  ));
  const R = size / 2;

  const hRad = (hue * Math.PI) / 180;
  const hx = R + R * sat * Math.sin(hRad);
  const hy = R - R * sat * Math.cos(hRad);
  const currentHex = hsvToHex(hue, sat, val);
  const brightHex = hsvToHex(hue, sat, 1);


  const readWheel = (clientX: number, clientY: number) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const dx = clientX - (rect.left + R);
    const dy = clientY - (rect.top + R);
    const newSat = Math.min(1, Math.sqrt(dx * dx + dy * dy) / R);
    let newHue = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (newHue < 0) newHue += 360;
    // Play chromatic note when crossing 30° zone boundaries
    const noteIdx = Math.floor(newHue / 30) % 12;
    if (noteIdx !== lastNoteRef.current) {
      lastNoteRef.current = noteIdx;
      playNote(220 * Math.pow(2, noteIdx / 12));
    }
    onChange(newHue, newSat, val);
  };

  const readBar = (clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const newVal = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    // Play note per 10% step
    const step = Math.min(10, Math.floor(newVal * 10));
    if (step !== lastBarStepRef.current) {
      lastBarStepRef.current = step;
      playNote(150 * Math.pow(2, newVal * 1.5));
    }
    onChange(hue, sat, newVal);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: WHEEL_GAP }}>
      {/* Hue + saturation wheel */}
      <div
        ref={wheelRef}
        style={{ width: size, height: size, borderRadius: '50%', position: 'relative', cursor: 'crosshair', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={e => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const dx = e.clientX - (rect.left + R), dy = e.clientY - (rect.top + R);
          if (Math.sqrt(dx * dx + dy * dy) > R) return;
          lastNoteRef.current = -1;
          dragging.current = 'wheel';
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          readWheel(e.clientX, e.clientY);
        }}
        onPointerMove={e => { if (dragging.current === 'wheel') readWheel(e.clientX, e.clientY); }}
        onPointerUp={() => { dragging.current = null; }}
      >
        {/* Hue ring */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 0deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))' }} />
        {/* White saturation overlay */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle, white 0%, transparent 100%)' }} />
        {/* Dark brightness overlay */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `rgba(0,0,0,${(1 - val).toFixed(3)})` }} />
        {/* Handle */}
        <div style={{ position: 'absolute', left: hx - dot / 2, top: hy - dot / 2, width: dot, height: dot, borderRadius: '50%', border: '2.5px solid white', boxShadow: '0 1px 6px rgba(0,0,0,0.7)', backgroundColor: currentHex, pointerEvents: 'none' }} />
      </div>

      {/* Brightness bar — track is outlined so the black end doesn't vanish into the page */}
      <div style={{ width: size }}>
        <div
          ref={barRef}
          style={{
            width: '100%', height: barH, borderRadius: barH / 2, position: 'relative',
            background: `linear-gradient(to right, #000, ${brightHex})`,
            border: '1px solid #4a5b6e',
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.6), 0 1px 0 rgba(255,255,255,0.05)',
            cursor: 'ew-resize', touchAction: 'none', userSelect: 'none',
          }}
          onPointerDown={e => {
            lastBarStepRef.current = -1;
            dragging.current = 'bar';
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            readBar(e.clientX);
          }}
          onPointerMove={e => { if (dragging.current === 'bar') readBar(e.clientX); }}
          onPointerUp={() => { dragging.current = null; }}
        >
          <div style={{ position: 'absolute', left: `calc(${val * 100}% - ${knob / 2}px)`, top: (barH - knob) / 2, width: knob, height: knob, borderRadius: '50%', border: '2.5px solid white', boxShadow: '0 1px 6px rgba(0,0,0,0.7)', backgroundColor: currentHex, pointerEvents: 'none' }} />
        </div>
      </div>
    </div>
  );
};

const Shackle = ({ size }: { size: number }) => (
  <svg width={size} height={size * 32 / 26} viewBox="0 -2 26 32" style={{ overflow: 'visible', flexShrink: 0 }} aria-hidden="true">
    <path className="mm-bow mm-bow-open" d="M7 13 V9 a6 6 0 0 1 12 0 v4" />
    <path className="mm-bow mm-bow-shut" d="M7 13 V9 a6 6 0 0 1 12 0 v4" />
    <rect x="4" y="13" width="18" height="14" rx="3" fill="currentColor" style={{ transition: 'fill 0.35s ease' }} />
  </svg>
);

const RIVET: CSSProperties = {
  position: 'absolute', width: 5, height: 5, borderRadius: '50%',
  background: 'radial-gradient(circle at 35% 30%, #55677e, #1b2430 70%)',
  boxShadow: '0 1px 1px rgba(0,0,0,0.7)',
};

type CodePlateProps = {
  secret: string[];
  wellSize: number;
  seatedAt: number | null;
};

// The four secret slots read as a lock face, mirroring the vault language the play screen uses.
const CodePlate = ({ secret, wellSize, seatedAt }: CodePlateProps) => {
  const locked = secret.length >= SECRET_LEN;
  const discSize = Math.round(wellSize * 0.77);
  const counts = new Map<string, number>();
  secret.forEach(h => counts.set(h, (counts.get(h) ?? 0) + 1));

  return (
    <div
      className={locked ? 'mm-plate-locked' : undefined}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 18px', borderRadius: 16, border: '1px solid #0a0f16',
        background: 'linear-gradient(180deg, #1f2b3a 0%, #141c27 100%)',
        boxShadow: locked
          ? 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.75), 0 0 0 1px rgba(63,154,99,0.55), 0 0 26px rgba(63,154,99,0.28), 0 10px 24px rgba(0,0,0,0.55)'
          : 'inset 0 1px 0 rgba(255,255,255,0.10), inset 0 -1px 0 rgba(0,0,0,0.75), 0 10px 24px rgba(0,0,0,0.55)',
        transition: 'box-shadow 0.35s ease',
      }}
    >
      <span style={{ ...RIVET, top: 7, left: 8 }} />
      <span style={{ ...RIVET, top: 7, right: 8 }} />
      <span style={{ ...RIVET, bottom: 7, left: 8 }} />
      <span style={{ ...RIVET, bottom: 7, right: 8 }} />

      <div style={{ color: locked ? '#3f9a63' : '#8b9bad', display: 'flex' }}>
        <Shackle size={22} />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        {Array.from({ length: SECRET_LEN }, (_, i) => {
          const hex = secret[i];
          const isTarget = !hex && i === secret.length;
          const dupes = hex ? counts.get(hex)! : 0;
          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
              <div
                role="img"
                aria-label={hex ? `Position ${i + 1}, filled` : `Position ${i + 1}, empty`}
                style={{
                  position: 'relative', width: wellSize, height: wellSize, borderRadius: '50%',
                  display: 'grid', placeItems: 'center',
                  background: isTarget
                    ? 'radial-gradient(circle at 50% 50%, rgba(255,107,53,0.16) 0%, transparent 68%), #05090e'
                    : '#05090e',
                  boxShadow: locked
                    ? 'inset 0 3px 7px rgba(0,0,0,0.95), inset 0 -2px 0 rgba(255,255,255,0.13), 0 0 0 1px rgba(63,154,99,0.75), 0 0 14px rgba(63,154,99,0.3)'
                    : 'inset 0 3px 7px rgba(0,0,0,0.95), inset 0 -2px 0 rgba(255,255,255,0.13), 0 0 0 1px #26333f',
                }}
              >
                {isTarget && (
                  <span
                    className="mm-target-ring"
                    style={{
                      position: 'absolute', inset: -3, borderRadius: '50%',
                      border: '2.5px solid #ff6b35', boxShadow: '0 0 12px rgba(255,107,53,0.45)',
                      pointerEvents: 'none',
                    }}
                  />
                )}
                {hex && (
                  <span
                    className={`${seatedAt === i ? 'mm-seat' : ''} ${locked ? 'mm-lock-pulse' : ''}`.trim() || undefined}
                    style={{
                      position: 'relative', width: discSize, height: discSize, borderRadius: '50%',
                      backgroundColor: hex, overflow: 'hidden',
                      boxShadow: locked
                        ? '0 0 0 3px #3f9a63, 0 0 16px rgba(63,154,99,0.85)'
                        : `0 0 15px ${hex}66`,
                      animationDelay: locked ? `${i * 60}ms` : undefined,
                    }}
                  >
                    <span style={{
                      position: 'absolute', inset: 0, borderRadius: '50%',
                      background: 'linear-gradient(150deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.06) 38%, transparent 60%)',
                    }} />
                  </span>
                )}
                {dupes > 1 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -4, fontSize: 9, fontWeight: 600,
                    fontFamily: MONO_FONT, background: '#0e141d', color: '#ff6b35',
                    border: '1px solid #3b2a20', borderRadius: 6, padding: '0 4px', lineHeight: 1.5,
                  }}>×{dupes}</span>
                )}
              </div>
              <span style={{
                fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', fontFamily: MONO_FONT,
                color: hex ? '#566b83' : '#3d4d61', fontVariantNumeric: 'tabular-nums',
              }}>{i + 1}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DEFAULT_HSV: [number, number, number] = [25, 0.95, 0.92];

// Mirrors the play screen's approach: shrink fixed-size elements first as the
// viewport gets short, with scroll as the fallback for whatever's left over.
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

// Measures the slack the picker is allowed to fill. The picker renders inside an
// absolutely-positioned child so its own size can never feed back into this box.
const useBoxSize = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]!.contentRect;
      setBox({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box] as const;
};

export const MastermindCreator = () => {
  const { w: vpW, h: vpH } = useViewport();
  const tight = vpH < 640;
  const xtight = vpH < 520;
  const mid = vpW >= 640;
  const wide = vpW >= 900;
  const [pickerRef, pickerBox] = useBoxSize();
  const slotSize = xtight ? 34 : tight ? 40 : wide ? 62 : mid ? 56 : 50;
  const swatchSize = xtight ? 38 : tight ? 44 : wide ? 62 : mid ? 56 : 52;
  // Plate chrome (shackle, gaps, padding) eats ~100px; the rest splits between wells.
  const plateAvail = Math.min(vpW - 32, 640);
  const wellSize = Math.max(34, Math.min(swatchSize + 12, Math.floor((plateAvail - 100) / SECRET_LEN)));
  const [step, setStep] = useState<'pool' | 'secret'>('pool');
  const [pool, setPool] = useState<(PColor | null)[]>(() => {
    const arr: (PColor | null)[] = Array(POOL_SIZE).fill(null);
    arr[0] = { name: '', hex: hsvToHex(DEFAULT_HSV[0], DEFAULT_HSV[1], DEFAULT_HSV[2]) };
    return arr;
  });
  const [secret, setSecret] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [postState, setPostState] = useState<'idle' | 'saving'>('idle');
  const [activeSlot, setActiveSlot] = useState(0);
  const [hsv, setHsv] = useState<[number, number, number]>(DEFAULT_HSV);
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [seatedAt, setSeatedAt] = useState<number | null>(null);

  const poolFull = pool.every(Boolean);
  const poolColors = pool.filter(Boolean) as PColor[];

  const onSlotClick = (i: number) => {
    swatchNote(i);
    setActiveSlot(i);
    if (pool[i]) {
      setHsv(hexToHsv(pool[i]!.hex));
    } else {
      const hex = hsvToHex(hsv[0], hsv[1], hsv[2]);
      const next = [...pool];
      next[i] = { name: '', hex };
      setPool(next);
    }
  };

  const onWheelChange = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    const hex = hsvToHex(h, s, v);
    const next = [...pool];
    next[activeSlot] = { name: '', hex };
    setPool(next);
  };

  // Even hue spacing with a small jitter, so a re-roll always looks different but
  // two swatches can never land close enough for players to confuse them.
  const surpriseMe = () => {
    const start = Math.random() * 360;
    const step = 360 / POOL_SIZE;
    const next = Array.from({ length: POOL_SIZE }, (_, i) => {
      const h = (start + step * i + (Math.random() * 18 - 9) + 360) % 360;
      const s = 0.72 + Math.random() * 0.24;
      const v = 0.78 + Math.random() * 0.2;
      return { name: '', hex: hsvToHex(h, s, v) };
    });
    playLockIn();
    setPool(next);
    setActiveSlot(0);
    setHsv(hexToHsv(next[0]!.hex));
    setShowConfirmed(true);
  };

  const goNextSlot = () => {
    // No other empty slots → this was the last one, show confirmation tick
    const otherEmpty = pool.findIndex((c, i) => i !== activeSlot && !c);
    if (otherEmpty === -1) {
      playLockIn(); // palette complete — same fanfare the plate gets
      setShowConfirmed(true);
      return;
    }
    // Move to next empty slot — onSlotClick sounds the note for it
    for (let i = 1; i <= POOL_SIZE; i++) {
      const idx = (activeSlot + i) % POOL_SIZE;
      if (!pool[idx]) { onSlotClick(idx); return; }
    }
  };

  const addToSecret = (hex: string, poolIdx: number) => {
    if (secret.length >= SECRET_LEN) return;
    if (secret.length + 1 === SECRET_LEN) playLockIn();
    else swatchNote(poolIdx);
    setSeatedAt(secret.length);
    setSecret(prev => [...prev, hex]);
  };

  const removeLastSecret = () => {
    if (secret.length === 0) return;
    playNote(165, 0.1);
    setSeatedAt(null);
    setSecret(prev => prev.slice(0, -1));
  };

  const handlePost = async () => {
    if (!poolFull || secret.length < SECRET_LEN) return;
    setPostState('saving');
    try {
      const result = await trpc.mastermind.createCustomPuzzle.mutate({
        poolColors: pool as PColor[],
        secret,
        title: title.trim() || undefined,
      });
      // Stays in 'saving' — the button keeps its spinner state until the new post
      // loads, which is the real confirmation the puzzle went live.
      navigateTo(result.postUrl);
    } catch (err) {
      console.error('[mastermind-creator] handlePost failed:', err);
      void showToast({ text: 'Failed to save. Try again.', appearance: 'neutral' });
      setPostState('idle');
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: '#0e141d', fontFamily: MONO_FONT }}>
      {/* Header */}
      <div className="shrink-0" style={{ borderBottom: '1px solid #2f3d4c', background: '#0e141d' }}>
        {step === 'pool' ? (
          <div className="mx-auto flex max-w-sm items-center gap-3 px-4 py-2 sm:max-w-lg md:max-w-2xl">
            <input
              type="text"
              placeholder="Puzzle title… (optional)"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={60}
              className="min-w-0 flex-1 rounded-lg border border-[#3a4a5c] bg-[#1a2432] px-3 py-1.5 text-xs font-semibold text-[#e8dcc4] placeholder-[#5f7185] outline-none focus:border-[#ff6b35] focus:ring-1 focus:ring-[#ff6b35]"
            />
            <button
              onClick={surpriseMe}
              title="Fill all six slots with well-spaced colors"
              className="shrink-0 rounded-full border border-[#3a4a5c] bg-[#1a2432] px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#d6c3a5] transition-all hover:border-[#ff6b35] hover:text-[#ff6b35] active:scale-95 sm:px-3"
            >
              ✨<span className="hidden sm:ml-1 sm:inline">Surprise me</span>
            </button>
            <p className="shrink-0 text-xs font-semibold uppercase tracking-widest text-[#8b9bad]">Step 1</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-sm items-center justify-between px-4 py-2 sm:max-w-lg md:max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#8b9bad]">Step 2: Set the Secret</p>
            <button onClick={() => setStep('pool')} className="text-xs text-[#ff6b35] font-semibold">Back</button>
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full min-h-0 max-w-sm flex-1 flex-col overflow-hidden px-4 pt-3 sm:max-w-lg md:max-w-2xl lg:max-w-4xl">

        {step === 'pool' && (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-stretch lg:gap-8">
            <div className="flex min-h-0 flex-1 flex-col">
            {/* Color slots */}
            <div className="mb-3 shrink-0">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-widest text-[#8b9bad]">
                Tap a slot · drag wheel to set color
              </p>
              <div style={{ display: 'flex', flexWrap: 'nowrap', gap: 8, justifyContent: 'center' }}>
                {pool.map((c, i) => (
                  <button
                    key={i}
                    onClick={() => onSlotClick(i)}
                    style={{
                      width: 'calc((100% - 40px) / 6)', aspectRatio: '1', maxWidth: slotSize, borderRadius: '50%',
                      backgroundColor: c?.hex ?? '#1a2432',
                      border: activeSlot === i
                        ? '3px solid #ff6b35'
                        : c ? '2px solid rgba(255,255,255,0.15)' : '2px dashed #4a5b6e',
                      boxShadow: activeSlot === i
                        ? '0 0 0 2px #0e141d, 0 0 0 4px #ff6b35'
                        : c ? '0 2px 8px rgba(0,0,0,0.35)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: 'pointer', padding: 0, transition: 'box-shadow 0.15s, border 0.15s',
                    }}
                  >
                    {!c && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#4a5b6e', userSelect: 'none' }}>{i + 1}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Color wheel — fills whatever height is left over */}
            <div ref={pickerRef} className="relative min-h-0 w-full flex-1">
              <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
                <ColorWheelPicker
                  hue={hsv[0]} sat={hsv[1]} val={hsv[2]}
                  maxW={pickerBox.w || 240} maxH={pickerBox.h || 280}
                  onChange={onWheelChange}
                />
              </div>
            </div>
            </div>

            {/* Actions */}
            <div className="mx-auto w-full max-w-md shrink-0 pb-4 pt-3 lg:my-auto lg:w-72 lg:shrink-0 lg:pt-4" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={showConfirmed ? undefined : goNextSlot}
                disabled={showConfirmed}
                className={`w-full rounded-full py-2.5 text-sm font-semibold transition-all active:scale-95 ${showConfirmed ? 'bg-green-600 text-white' : 'bg-[#2f3d4c] text-[#d6c3a5]'}`}
              >
                {showConfirmed ? 'Set ✓' : 'Set Color'}
              </button>
              <button
                onClick={() => setStep('secret')}
                disabled={!poolFull}
                className="w-full rounded-full bg-[#ff6b35] px-6 py-3.5 text-base font-bold text-[#1a0d06] transition-all hover:bg-[#e8542f] active:scale-95 disabled:opacity-30"
              >
                Click here: Set the Secret?
              </button>
            </div>
          </div>
        )}

        {step === 'secret' && (
          <div className="flex min-h-0 flex-1 flex-col pb-4">
            {!xtight && (
              <p className="mb-3 shrink-0 text-sm text-[#8b9bad]">
                Tap the pool colors below to build the {SECRET_LEN}-color secret. Repeats allowed.
              </p>
            )}

            {/* Secret slots — the tumbler plate */}
            <div className={`shrink-0 ${tight ? 'mb-3' : 'mb-5'}`}>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#8b9bad]">The Combination</p>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <CodePlate secret={secret} wellSize={wellSize} seatedAt={seatedAt} />
              </div>
            </div>

            {/* Pool swatches */}
            <div className="mb-4 shrink-0">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[#8b9bad]">Tap to Add</p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center' }}>
                {poolColors.map((color, i) => (
                  <button
                    key={i}
                    onClick={() => addToSecret(color.hex, i)}
                    disabled={secret.length >= SECRET_LEN}
                    style={{
                      width: swatchSize, height: swatchSize, borderRadius: '50%',
                      backgroundColor: color.hex,
                      border: '2px solid rgba(255,255,255,0.15)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                      cursor: secret.length >= SECRET_LEN ? 'default' : 'pointer',
                      opacity: secret.length >= SECRET_LEN ? 0.45 : 1,
                      padding: 0,
                    }}
                  />
                ))}
              </div>
            </div>

            <div style={{ flex: 1 }} />

            <div className="mx-auto w-full max-w-md shrink-0">
            <button
              onClick={removeLastSecret}
              disabled={secret.length === 0}
              className="mb-2 shrink-0 w-full rounded-full bg-[#2f3d4c] py-3 text-sm font-semibold text-[#d6c3a5] disabled:opacity-30"
            >
              Delete Last
            </button>

            <button
              onClick={() => void handlePost()}
              disabled={secret.length < SECRET_LEN || postState === 'saving'}
              className="shrink-0 w-full rounded-full bg-[#ff6b35] py-3.5 text-base font-bold text-[#1a0d06] transition-all hover:bg-[#e8542f] active:scale-95 disabled:opacity-40"
            >
              {postState === 'saving' ? 'Saving…' : 'Post Rescue Puzzle'}
            </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MastermindCreator />
  </StrictMode>
);

import React, { useEffect, useRef, useState } from 'react';
import { audioCtx } from '../audio';

type ColorWheelProps = {
  onColorSelected: (hexColor: string) => void;
  selectedColor?: string;
  muted?: boolean;
  availH?: number;
};

function hsbToHex(h: number, s: number, v: number): string {
  s /= 100; v /= 100;
  let r = 0, g = 0, b = 0;
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: r = v; g = t; b = p; break; case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break; case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break; case 5: r = v; g = p; b = q; break;
  }
  return '#' + [r, g, b].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function hexToHsb(hex: string): { h: number; s: number; b: number } {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const v = max, d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s: s * 100, b: v * 100 };
}

// Fixed musical notes: A5 / E5 / C5 — harmonically related, brief sine pops
const NOTES = { h: 880, s: 659, b: 523 };

function playTick(channel: 'h' | 's' | 'b') {
  try {
    const ctx = audioCtx();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = NOTES[channel];
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0, t);
    gain.gain.linearRampToValueAtTime(0.045, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.028);
    osc.start(t);
    osc.stop(t + 0.03);
  } catch { /* AudioContext unavailable */ }
}

export const ColorWheel = ({ onColorSelected, selectedColor, muted, availH }: ColorWheelProps) => {
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [brightness, setBrightness] = useState(100);
  const skipSyncRef = useRef(false);
  const lastTickRef = useRef(0);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 480);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 480);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  // Width fixed — keep wide enough to drag. Height fits available space, clamped.
  const sliderW = isMobile ? 44 : window.innerWidth < 900 ? 38 : 34;
  const MIN_H = 170, MAX_H = isMobile ? 320 : 240;
  const fallbackH = isMobile ? (window.innerWidth < 390 ? 225 : 280) : 205;
  // Axis captions cost their line plus the column gap. MIN_H floors the track,
  // so on a viewport too short to honour it the captions would be the part that
  // gets clipped by the picker box — drop them there instead and the layout is
  // exactly what it was before they existed.
  const LABEL_BLOCK = 20;
  // byVH: deterministic viewport budget so hex/submit are never pushed off.
  const rawVH = window.innerHeight - (window.innerHeight < 560 ? 160 : 235);
  const rawH = availH && availH > 0 ? availH - 6 : fallbackH;
  const showLabels = Math.min(rawH, rawVH) >= MIN_H + LABEL_BLOCK;
  const reserve = showLabels ? LABEL_BLOCK : 0;
  const sliderH = Math.max(MIN_H, Math.min(MAX_H, rawH - reserve, rawVH - reserve));
  const thumbSize = Math.round(sliderW * 0.88);
  const gap = isMobile ? 22 : window.innerWidth < 900 ? 26 : 30;

  useEffect(() => {
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    if (selectedColor?.startsWith('#')) {
      const { h, s, b } = hexToHsb(selectedColor);
      setHue(h); setSaturation(s); setBrightness(b);
    }
  }, [selectedColor]);

  const applyDrag = (el: HTMLDivElement, clientY: number, channel: 'h' | 's' | 'b') => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(clientY - rect.top, rect.height)) / rect.height;
    let newH = hue, newS = saturation, newB = brightness;
    if (channel === 'h') { newH = ratio * 359; setHue(newH); }
    else if (channel === 's') { newS = ratio * 100; setSaturation(newS); }
    else { newB = ratio * 100; setBrightness(newB); }

    if (!muted) {
      // eslint-disable-next-line react-hooks/purity
      const now = Date.now();
      if (now - lastTickRef.current > 55) { lastTickRef.current = now; playTick(channel); }
    }

    skipSyncRef.current = true;
    onColorSelected(hsbToHex(newH, newS, newB));
  };

  const handlers = (channel: 'h' | 's' | 'b') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      applyDrag(e.currentTarget, e.clientY, channel);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      applyDrag(e.currentTarget, e.clientY, channel);
    },
  });

  const hueGrad = 'linear-gradient(to bottom,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)';
  const satGrad = `linear-gradient(to bottom,${hsbToHex(hue,0,brightness)},${hsbToHex(hue,100,brightness)})`;
  const briGrad = `linear-gradient(to bottom,#000,${hsbToHex(hue,saturation,100)})`;

  const thumb = (pct: number) => ({
    position: 'absolute' as const,
    left: '50%',
    top: `calc(${pct}% - ${thumbSize / 2}px)`,
    transform: 'translateX(-50%)',
    width: thumbSize,
    height: thumbSize,
    borderRadius: '50%',
    background: '#fff',
    border: '2.5px solid rgba(0,0,0,0.15)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    pointerEvents: 'none' as const,
  });

  const LABELS = { h: 'HUE', s: 'SAT', b: 'BRIGHT' };

  const slider = (channel: 'h' | 's' | 'b', bg: string, pct: number) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div
        style={{
          width: sliderW,
          height: sliderH,
          borderRadius: sliderW / 2,
          background: bg,
          position: 'relative',
          cursor: 'pointer',
          touchAction: 'none',
          userSelect: 'none',
          border: '1px solid rgba(0,0,0,0.1)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          flexShrink: 0,
        }}
        {...handlers(channel)}
      >
        <div style={thumb(pct)} />
      </div>
      {showLabels && (
        <span style={{
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
          color: '#9ca3af', lineHeight: 1, whiteSpace: 'nowrap',
        }}>
          {LABELS[channel]}
        </span>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap }}>
      {slider('h', hueGrad, (hue / 359) * 100)}
      {slider('s', satGrad, saturation)}
      {slider('b', briGrad, brightness)}
    </div>
  );
};

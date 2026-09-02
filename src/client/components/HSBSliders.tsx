import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { audioCtx } from '../audio';

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

// Each channel sonifies its own value, so the ear tracks the drag: hue sweeps an
// octave around the colour wheel, saturation grows a harmonic as it richens,
// brightness rides pitch from dark/low to bright/high. `t01` is the 0–1 position.
function playTick(channel: 'h' | 's' | 'b', t01: number) {
  try {
    const ctx = audioCtx();
    if (!ctx) return;
    const t = ctx.currentTime;

    const voice = (freq: number, level: number, type: OscillatorType = 'sine') => {
      if (level <= 0.0002) return;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.035);
    };

    if (channel === 'h') {
      voice(440 * Math.pow(2, t01), 0.042);            // 440 → 880 Hz, red → red
    } else if (channel === 's') {
      voice(523, 0.026 + 0.020 * t01);                 // grey = thin, saturated = full
      voice(1046, 0.026 * t01, 'triangle');            // harmonic fades in with sat
    } else {
      voice(196 * Math.pow(2, 2 * t01), 0.038);        // 196 → 784 Hz, dark → bright
    }
  } catch { /* AudioContext unavailable */ }
}

type HSBSlidersProps = {
  onColorSelected: (hexColor: string) => void;
  selectedColor?: string;
  muted?: boolean;
  compact?: boolean;
  hintSlot?: React.ReactNode;
  /** Height budget measured by the parent; tracks shrink to fit rather than spill. */
  fitH?: number;
};

export const HSBSliders = ({ onColorSelected, selectedColor, muted, compact, hintSlot, fitH }: HSBSlidersProps) => {
  const init = selectedColor?.startsWith('#') ? hexToHsb(selectedColor) : { h: 120, s: 100, b: 100 };
  const [hue, setHue] = useState(init.h);
  const [sat, setSat] = useState(init.s);
  const [bri, setBri] = useState(init.b);
  const skipSyncRef = useRef(false);
  const lastTickRef = useRef(0);
  const mutedRef = useRef(muted);
  useLayoutEffect(() => { mutedRef.current = muted; });

  useEffect(() => {
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    if (selectedColor?.startsWith('#')) {
      const { h, s, b } = hexToHsb(selectedColor);
      setHue(h); setSat(s); setBri(b);
    }
  }, [selectedColor]);

  const tickThrottle = (channel: 'h' | 's' | 'b', t01: number) => {
    if (mutedRef.current) return;
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    if (now - lastTickRef.current > 45) { lastTickRef.current = now; playTick(channel, t01); }
  };

  const applyDrag = (el: HTMLDivElement, clientX: number, channel: 'h' | 's' | 'b') => {
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(clientX - rect.left, rect.width)) / rect.width;
    let newH = hue, newS = sat, newB = bri;
    if (channel === 'h') { newH = ratio * 359; setHue(newH); }
    else if (channel === 's') { newS = ratio * 100; setSat(newS); }
    else { newB = ratio * 100; setBri(newB); }
    skipSyncRef.current = true;
    tickThrottle(channel, ratio);
    onColorSelected(hsbToHex(newH, newS, newB));
  };

  const handlers = (channel: 'h' | 's' | 'b') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      applyDrag(e.currentTarget, e.clientX, channel);
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      applyDrag(e.currentTarget, e.clientX, channel);
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => { e.currentTarget.releasePointerCapture(e.pointerId); },
  });

  const isMobile = window.innerWidth < 480;
  // Tracks are the touch target — keep them well above the ~44px finger minimum.
  const wantTrackH = compact ? 36 : isMobile ? 48 : 40;
  const wantRowGap = compact ? 10 : 14;
  // Three rows plus two gaps have to land inside the measured box, so on a short
  // one the gap goes first and the track follows it down to a still-tappable 26.
  const rowGap = fitH && fitH < wantTrackH * 3 + wantRowGap * 2 ? 6 : wantRowGap;
  const trackH = fitH ? Math.max(26, Math.min(wantTrackH, Math.floor((fitH - rowGap * 2) / 3))) : wantTrackH;
  const thumbSize = Math.round(trackH * 0.8);
  const labelW = compact ? 32 : isMobile ? 40 : 44;

  const hueGrad = 'linear-gradient(to right,#FF0000,#FFFF00,#00FF00,#00FFFF,#0000FF,#FF00FF,#FF0000)';
  const satGrad = `linear-gradient(to right,${hsbToHex(hue, 0, bri)},${hsbToHex(hue, 100, bri)})`;
  const briGrad = `linear-gradient(to right,#000,${hsbToHex(hue, sat, 100)})`;

  const thumbStyle = (pct: number) => ({
    position: 'absolute' as const,
    top: '50%',
    left: `calc(${pct}% - ${thumbSize / 2}px)`,
    transform: 'translateY(-50%)',
    width: thumbSize, height: thumbSize, borderRadius: '50%',
    background: '#fff',
    border: '2.5px solid rgba(0,0,0,0.15)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    pointerEvents: 'none' as const,
  });

  const row = (label: string, channel: 'h' | 's' | 'b', bg: string, pct: number) => (
    <div key={channel} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
      <span style={{ width: labelW, flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: '#8a8f98', textTransform: 'uppercase' }}>
        {label}
      </span>
      <div
        style={{
          position: 'relative', flex: 1, height: trackH, borderRadius: trackH / 2,
          background: bg, cursor: 'pointer', touchAction: 'none', userSelect: 'none',
          border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}
        {...handlers(channel)}
      >
        <div style={thumbStyle(pct)} />
      </div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap, width: '100%' }}>
      {row('Hue', 'h', hueGrad, (hue / 359) * 100)}
      {row('Sat', 's', satGrad, sat)}
      {row('Bri', 'b', briGrad, bri)}
      {hintSlot}
    </div>
  );
};

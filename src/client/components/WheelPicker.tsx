import React, { useEffect, useRef, useState } from 'react';

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

// Shared AudioContext
let sharedCtx: AudioContext | null = null;
function getCtx(): AudioContext | null {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!sharedCtx) sharedCtx = new AC();
    if (sharedCtx.state === 'suspended') void sharedCtx.resume();
    return sharedCtx;
  } catch { return null; }
}

const NOTES = { wheel: 880, bar: 523 } as const;

function playTick(channel: 'wheel' | 'bar') {
  try {
    const ctx = getCtx();
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

type WheelPickerProps = {
  onColorSelected: (hexColor: string) => void;
  selectedColor?: string;
  muted?: boolean;
  hintSlot?: React.ReactNode;
};

export const WheelPicker = ({ onColorSelected, selectedColor, muted, hintSlot }: WheelPickerProps) => {
  const init = selectedColor?.startsWith('#') ? hexToHsb(selectedColor) : { h: 120, s: 100, b: 100 };
  const [hue, setHue] = useState(init.h);
  const [sat, setSat] = useState(init.s);
  const [bri, setBri] = useState(init.b);
  const skipSyncRef = useRef(false);
  const lastTickRef = useRef(0);
  const wheelRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  // Refs so pointer-capture callbacks always read current values without stale closure
  const hueRef = useRef(hue);
  const satRef = useRef(sat);
  const briRef = useRef(bri);
  const mutedRef = useRef(muted);
  hueRef.current = hue; satRef.current = sat; briRef.current = bri; mutedRef.current = muted;

  useEffect(() => {
    if (skipSyncRef.current) { skipSyncRef.current = false; return; }
    if (selectedColor?.startsWith('#')) {
      const { h, s, b } = hexToHsb(selectedColor);
      setHue(h); setSat(s); setBri(b);
    }
  }, [selectedColor]);

  const tickThrottle = (channel: 'wheel' | 'bar') => {
    if (mutedRef.current) return;
    const now = Date.now();
    if (now - lastTickRef.current > 55) { lastTickRef.current = now; playTick(channel); }
  };

  const applyWheel = (clientX: number, clientY: number) => {
    if (!wheelRef.current) return;
    const rect = wheelRef.current.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx, dy = clientY - cy;
    const radius = rect.width / 2;
    // +90 aligns hue=0 (red) with 12-o'clock to match CSS conic-gradient(from 0deg)
    const newH = ((Math.atan2(dy, dx) * 180 / Math.PI) + 90 + 360) % 360;
    const newS = Math.min(Math.sqrt(dx * dx + dy * dy) / radius * 100, 100);
    setHue(newH); setSat(newS);
    skipSyncRef.current = true;
    tickThrottle('wheel');
    onColorSelected(hsbToHex(newH, newS, briRef.current));
  };

  const applyBar = (clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const newB = Math.max(0, Math.min((clientX - rect.left) / rect.width * 100, 100));
    setBri(newB);
    skipSyncRef.current = true;
    tickThrottle('bar');
    onColorSelected(hsbToHex(hueRef.current, satRef.current, newB));
  };

  const isMobile = window.innerWidth < 480;
  const wheelSize = isMobile
    ? Math.min(240, Math.max(190, window.innerWidth - 60))
    : Math.min(195, Math.max(160, window.innerWidth - 80));
  const barH = isMobile ? 30 : 25;

  const thumbR = 11;
  const maxR = wheelSize / 2 - thumbR;

  const angleRad = (hue - 90) * Math.PI / 180;
  const thumbX = Math.cos(angleRad) * (sat / 100) * maxR;
  const thumbY = Math.sin(angleRad) * (sat / 100) * maxR;
  const currentHex = hsbToHex(hue, sat, bri);
  const fullBriHex = hsbToHex(hue, sat, 100);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, width: '100%', marginTop: 20 }}>
      {/* Hue / Saturation wheel */}
      <div
        ref={wheelRef}
        style={{ position: 'relative', width: wheelSize, height: wheelSize, borderRadius: '50%', cursor: 'crosshair', touchAction: 'none', userSelect: 'none', flexShrink: 0 }}
        onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); applyWheel(e.clientX, e.clientY); }}
        onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; applyWheel(e.clientX, e.clientY); }}
        onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); }}
      >
        {/* Hue: conic gradient — 0deg (top) = red, clockwise */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'conic-gradient(from 0deg, hsl(0,100%,50%), hsl(45,100%,50%), hsl(90,100%,50%), hsl(135,100%,50%), hsl(180,100%,50%), hsl(225,100%,50%), hsl(270,100%,50%), hsl(315,100%,50%), hsl(360,100%,50%))' }} />
        {/* Saturation: white centre → transparent edge */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0) 100%)' }} />
        {/* Thumb — shows actual current color (brightness applied) */}
        <div style={{
          position: 'absolute',
          left: `calc(50% + ${thumbX}px - ${thumbR}px)`,
          top: `calc(50% + ${thumbY}px - ${thumbR}px)`,
          width: thumbR * 2, height: thumbR * 2, borderRadius: '50%',
          background: currentHex,
          border: '2.5px solid white',
          boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
          pointerEvents: 'none',
        }} />
      </div>

      {/* Brightness bar — same width as wheel, hint floats right via absolute */}
      <div style={{ position: 'relative', width: wheelSize }}>
        <div
          ref={barRef}
          style={{ position: 'relative', width: wheelSize, height: barH, borderRadius: Math.round(barH / 2), background: `linear-gradient(to right, #000000, ${fullBriHex})`, cursor: 'pointer', touchAction: 'none', userSelect: 'none', border: '1px solid rgba(0,0,0,0.1)', boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}
          onPointerDown={e => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); applyBar(e.clientX); }}
          onPointerMove={e => { if (!e.currentTarget.hasPointerCapture(e.pointerId)) return; applyBar(e.clientX); }}
          onPointerUp={e => { e.currentTarget.releasePointerCapture(e.pointerId); }}
        >
          <div style={{
            position: 'absolute',
            left: `calc(${bri}% - ${thumbR}px)`,
            top: `calc(50% - ${thumbR}px)`,
            width: thumbR * 2, height: thumbR * 2, borderRadius: '50%',
            background: currentHex,
            border: '2.5px solid white',
            boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
            pointerEvents: 'none',
          }} />
        </div>
        {hintSlot && (
          <div style={{ position: 'absolute', left: wheelSize + 10, top: '50%', transform: 'translateY(-50%)', whiteSpace: 'nowrap' }}>
            {hintSlot}
          </div>
        )}
      </div>
    </div>
  );
};

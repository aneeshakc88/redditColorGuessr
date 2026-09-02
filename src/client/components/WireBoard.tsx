// Colorwire's dot-connect board, extracted out of wire.tsx so Rewire's level 2
// can reuse it unchanged. `backgroundImage`, when set, is the only behavior
// Colorwire itself doesn't use — everything else is a verbatim move.
import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { advanceWire, type WirePuzzle } from '../../shared/wire-core';
import { inkOn } from '../../shared/ink';
import { audioCtx, unlock } from '../audio';

const ACCENT = '#38bdf8';
const BORDER = 'rgba(255,255,255,0.09)';

function tone(freq: number, dur: number, vol = 0.12, type: OscillatorType = 'sine') {
  try {
    const c = audioCtx(); if (!c) return;
    const osc = c.createOscillator(); const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination); osc.type = type;
    const t = c.currentTime; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t); gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.start(t); osc.stop(t + dur + 0.02);
  } catch { /* noop */ }
}
const sfxStep = (n: number) => tone(420 + (n % 12) * 26, 0.03, 0.05, 'triangle');
const sfxLink = () => { tone(660, 0.07, 0.12); setTimeout(() => tone(990, 0.11, 0.1), 70); };
const sfxCut = () => tone(220, 0.05, 0.08, 'sawtooth');

type Routes = number[][];

export const WireBoard = ({ puzzle, colors, routes, dragColor, onRoutes, onDragEnd, onFirstTouch, locked, muted, hintEmpty, labels, backgroundImage }: {
  puzzle: WirePuzzle;
  colors: string[];
  routes: Routes;
  dragColor: number | null;
  onRoutes: (r: Routes, dragging: number | null) => void;
  onDragEnd: (drew: boolean) => void;
  onFirstTouch?: () => void;
  locked: boolean;
  muted?: boolean;
  hintEmpty?: boolean;
  labels?: boolean;
  backgroundImage?: string;
}) => {
  const { w, h, pairs } = puzzle;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ color: number; drew: boolean } | null>(null);
  // Pointer events can outpace React's re-render during a fast drag, so the
  // handlers read and write this mirror instead of the (possibly stale) prop.
  const live = useRef<Routes>(routes);
  useEffect(() => { live.current = routes; }, [routes]);

  const commit = (next: Routes, dragging: number | null) => {
    live.current = next;
    onRoutes(next, dragging);
  };

  // cell -> colour of the dot sitting on it (-1 if none)
  const dotOf = useMemo(() => {
    const d = new Int32Array(w * h).fill(-1);
    pairs.forEach((p, i) => { d[p.a] = i; d[p.b] = i; });
    return d;
  }, [pairs, w, h]);

  const cellFromPoint = (x: number, y: number): number | null => {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const c = Math.floor(((x - rect.left) / rect.width) * w);
    const r = Math.floor(((y - rect.top) / rect.height) * h);
    if (r < 0 || c < 0 || r >= h || c >= w) return null;
    return r * w + c;
  };

  const endDrag = () => {
    if (!drag.current) return;
    const drew = drag.current.drew;
    drag.current = null;
    onDragEnd(drew);
  };

  const onDown = (e: ReactPointerEvent) => {
    if (locked) return;
    unlock();
    const cell = cellFromPoint(e.clientX, e.clientY);
    if (cell == null) return;
    onFirstTouch?.();
    const next = live.current.map(r => [...r]);
    const dot = dotOf[cell]!;
    if (dot !== -1) {
      next[dot] = [cell];
      drag.current = { color: dot, drew: false };
    } else {
      const owner = next.findIndex(r => r.includes(cell));
      if (owner === -1) return;
      next[owner] = next[owner]!.slice(0, next[owner]!.indexOf(cell) + 1);
      drag.current = { color: owner, drew: false };
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    commit(next, drag.current.color);
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || locked) return;
    const target = cellFromPoint(e.clientX, e.clientY);
    if (target == null) return;

    const next = live.current.map(r => [...r]);
    const color = d.color;
    let finished = false;
    // Walk cell by cell toward the pointer so a fast drag doesn't skip cells.
    for (let guard = 0; guard < 90; guard++) {
      const path = next[color]!;
      const last = path[path.length - 1];
      if (last == null || last === target) break;
      const lr = Math.floor(last / w), lc = last % w;
      const tr = Math.floor(target / w), tc = target % w;
      const cell = lc !== tc ? last + (tc > lc ? 1 : -1) : last + (tr > lr ? w : -w);
      const res = advanceWire(next, pairs, w, color, cell);
      if (res.outcome === 'blocked') break;
      d.drew = true;
      if (!muted) { if (res.cut) sfxCut(); sfxStep(next[color]!.length); }
      if (res.outcome === 'done') { finished = true; if (!muted) sfxLink(); break; }
    }
    commit(next, finished ? null : color);
    if (finished) endDrag();
  };

  const cx = (i: number) => (i % w) + 0.5;
  const cy = (i: number) => Math.floor(i / w) + 0.5;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${w} ${h}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      style={{
        width: '100%', height: '100%', touchAction: 'none', userSelect: 'none',
        borderRadius: 14, background: '#0d1626', border: `1px solid ${BORDER}`,
        boxShadow: '0 10px 34px rgba(0,0,0,0.45)', cursor: locked ? 'default' : 'pointer',
      }}
    >
      {backgroundImage ? (
        <>
          <image href={backgroundImage} x={0} y={0} width={w} height={h} preserveAspectRatio="xMidYMid slice" />
          {/* Scrim so wires/dots of any colour stay legible over an arbitrary photo. */}
          <rect x={0} y={0} width={w} height={h} fill="rgba(4,10,20,0.32)" />
        </>
      ) : (
        Array.from({ length: w * h }, (_, i) => (
          <rect key={i} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill="#131f33" />
        ))
      )}
      <g stroke={backgroundImage ? 'rgba(255,255,255,0.6)' : '#1b2a42'} strokeWidth={0.03} strokeLinecap="square" style={{ pointerEvents: 'none' }}>
        {backgroundImage && Array.from({ length: w * h }, (_, i) => (
          <rect key={`s${i}`} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill="none" stroke="rgba(0,0,0,0.45)" strokeWidth={0.07} />
        ))}
        {Array.from({ length: w + 1 }, (_, i) => <line key={`gv${i}`} x1={i} y1={0} x2={i} y2={h} />)}
        {Array.from({ length: h + 1 }, (_, i) => <line key={`gh${i}`} x1={0} y1={i} x2={w} y2={i} />)}
      </g>

      {/* Once every pair is joined, the only thing left is coverage — so call
          out exactly which cells are still bare. */}
      {hintEmpty && Array.from({ length: w * h }, (_, i) => (
        routes.some(p => p.includes(i)) ? null : (
          <rect key={`e${i}`} x={i % w + 0.12} y={Math.floor(i / w) + 0.12} width={0.76} height={0.76} rx={0.16}
            fill="rgba(56,189,248,0.14)" stroke={ACCENT} strokeWidth={0.05}
            style={{ animation: 'wNeed 1.5s ease-in-out infinite' }} />
        )
      ))}

      {routes.map((path, color) => {
        if (path.length < 2) return null;
        const pts = path.map(c => `${cx(c)},${cy(c)}`).join(' ');
        return (
          <polyline
            key={color} points={pts} fill="none" stroke={colors[color]}
            strokeWidth={0.46} strokeLinecap="round" strokeLinejoin="round"
            opacity={dragColor === color ? 0.95 : 0.88}
          />
        );
      })}

      {pairs.map((p, i) => {
        const path = routes[i] ?? [];
        const done = path.length > 1 && ((path[0] === p.a && path[path.length - 1] === p.b) || (path[0] === p.b && path[path.length - 1] === p.a));
        return [p.a, p.b].map(c => (
          <g key={`${i}-${c}`}>
            <circle cx={cx(c)} cy={cy(c)} r={0.31} fill={colors[i]} />
            {done && <circle cx={cx(c)} cy={cy(c)} r={0.40} fill="none" stroke={colors[i]} strokeWidth={0.055} opacity={0.55} />}
            {labels && (
              <text x={cx(c)} y={cy(c)} textAnchor="middle" dominantBaseline="central" fontSize={0.36} fontWeight={800}
                fill={inkOn(colors[i] ?? '#ffffff')} style={{ pointerEvents: 'none' }}>{i + 1}</text>
            )}
          </g>
        ));
      })}
    </svg>
  );
};

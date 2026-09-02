import './index.css';

import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { WheelPicker } from './components/WheelPicker';
import { HSBSliders } from './components/HSBSliders';
import { inkOn } from '../shared/ink';
import { randomHex } from '../shared/namecolor-core';

const BG = '#0f0f10';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

export const NameColorCreator = () => {
  const [hex, setHex] = useState(randomHex());
  const [mode, setMode] = useState<'wheel' | 'sliders'>('wheel');
  const [title, setTitle] = useState('');
  const [posting, setPosting] = useState(false);
  // The picker sizes itself from the box it is GIVEN, not from the viewport —
  // Reddit's desktop webview runs zoomed, so a viewport guess left the wheel
  // taller than the pane and the brightness bar clipped clean off.
  const pickerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = pickerRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Short webviews can't afford the full header and swatch on top of a picker.
  const [short, setShort] = useState(() => window.innerHeight < 620);
  useEffect(() => {
    const onResize = () => setShort(window.innerHeight < 620);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const post = async () => {
    if (posting) return;
    setPosting(true);
    try {
      const res = await trpc.namecolor.createCustomPost.mutate({ hex, title: title.trim() || undefined });
      navigateTo(res.postUrl);
    } catch (err) {
      console.error('[namecolor-creator] post failed:', err);
      // The server names the wall when it knows it (Reddit's rate limit is the
      // one a new account actually hits); anything else keeps the generic line.
      const msg = err instanceof Error && /rate limit/i.test(err.message)
        ? err.message
        : 'Could not post the color. Try again.';
      void showToast({ text: msg, appearance: 'neutral' });
      setPosting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
      <div style={{ flexShrink: 0, padding: short ? '8px 16px 4px' : '12px 16px 6px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <p style={{ fontSize: short ? 15 : 18, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Post a color to name</p>
        {!short && (
          <p style={{ fontSize: 11, color: '#71717a', margin: '2px 0 8px', fontWeight: 600 }}>
            No right answer — players comment names and the most upvoted one leads.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: short ? 6 : 0 }}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title… (optional)" maxLength={60}
            style={{ flex: 1, minWidth: 0, borderRadius: 10, border: `1px solid ${BORDER}`, background: CARD, padding: '8px 12px', fontSize: 13, color: '#fff', outline: 'none' }} />
          <button onClick={() => setHex(randomHex())}
            style={{ flexShrink: 0, height: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${BORDER}`, background: CARD, color: '#e4e4e7', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            Random
          </button>
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: short ? '6px 16px' : '8px 16px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <div style={{ height: short ? 46 : 68, borderRadius: 16, background: hex, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${BORDER}` }}>
          <span style={{ fontSize: short ? 17 : 20, fontWeight: 900, letterSpacing: '-0.02em', color: inkOn(hex) }}>{hex}</span>
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: short ? 6 : 8 }}>
          {(['wheel', 'sliders'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              style={{
                flex: 1, height: 32, borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
                background: mode === m ? 'rgba(255,255,255,0.13)' : 'transparent',
                border: `1px solid ${mode === m ? 'rgba(255,255,255,0.25)' : BORDER}`,
                color: mode === m ? '#fff' : '#71717a',
              }}>
              {m === 'wheel' ? 'Wheel' : 'Sliders'}
            </button>
          ))}
        </div>
      </div>

      {/* The pane is measured, and the picker is absolutely positioned inside it
          so its own size can never feed back into that measurement. */}
      <div ref={pickerRef} style={{ position: 'relative', flex: 1, minHeight: 0, padding: '4px 16px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <div style={{ position: 'absolute', inset: '4px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {box.w > 0 && box.h > 0 && (mode === 'wheel'
            ? <WheelPicker onColorSelected={setHex} selectedColor={hex} muted fit={{ w: box.w - 32, h: box.h - 8 }} />
            : <HSBSliders onColorSelected={setHex} selectedColor={hex} muted compact fitH={box.h - 8} />)}
        </div>
      </div>

      <div style={{ flexShrink: 0, padding: short ? '6px 16px 10px' : '10px 16px 14px', maxWidth: 480, width: '100%', margin: '0 auto' }}>
        <button onClick={() => void post()} disabled={posting}
          style={{
            width: '100%', height: short ? 44 : 52, borderRadius: 999, border: 'none', fontSize: 15, fontWeight: 900,
            cursor: posting ? 'default' : 'pointer', background: hex, color: inkOn(hex),
          }}>
          {posting ? 'Posting…' : 'Post this color'}
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NameColorCreator />
  </StrictMode>
);

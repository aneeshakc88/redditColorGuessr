import './index.css';

import { StrictMode, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { WheelPicker } from './components/WheelPicker';
import { PP_MIN_ROUNDS, PP_MAX_ROUNDS } from '../shared/palette-poet-core';

type Round = { hex: string; name: string; description: string };

const INIT_COLORS = ['#E63946', '#2A9D8F', '#E9C46A', '#6A4C93', '#1D7874'];
const CHIP = 34;
const PP_NICE_ROUNDS = 3;

const inputStyle: CSSProperties = {
  width: '100%', borderRadius: 10, border: '1.5px solid #e5e7eb', background: '#f9fafb',
  padding: '8px 12px', fontSize: 13, color: '#111', outline: 'none', boxSizing: 'border-box',
  minWidth: 0,
};
const labelStyle: CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
  color: '#9ca3af', display: 'block', marginBottom: 3,
};

function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]!.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export const PalettePoetCreator = () => {
  const [title, setTitle] = useState('');
  const [roundCount, setRoundCount] = useState(PP_MIN_ROUNDS);
  const [currentRound, setCurrentRound] = useState(0);
  const [rounds, setRounds] = useState<Round[]>(
    INIT_COLORS.map(hex => ({ hex, name: '', description: '' }))
  );
  const [postState, setPostState] = useState<'idle' | 'saving' | 'done'>('idle');
  const [postUrl, setPostUrl] = useState('');
  const [pickerRef, pickerBox] = useBoxSize<HTMLDivElement>();

  const activeRounds = rounds.slice(0, roundCount);
  const current = rounds[currentRound]!;
  const missing = activeRounds.filter(r => !r.name.trim()).length;
  const allNamed = missing === 0;
  const canAdd = roundCount < PP_MAX_ROUNDS;

  const hint = !current.name.trim()
    ? `Round ${currentRound + 1} of ${roundCount} — pick a shade and name it`
    : missing > 0
      ? `${missing} round${missing > 1 ? 's' : ''} still unnamed — tap a dot to fill ${missing > 1 ? 'them' : 'it'} in`
        : `Round ${currentRound + 1} of ${roundCount} — tap a dot to edit any color`;

  const addIsPrimary = roundCount < PP_NICE_ROUNDS;
  const footerNote = !allNamed
    ? `Name every color to continue`
    : canAdd
      ? `${roundCount} color${roundCount > 1 ? 's' : ''} so far — most palettes use ${PP_NICE_ROUNDS}-${PP_MAX_ROUNDS}`
      : `Full palette of ${PP_MAX_ROUNDS} — ready to post`;

  const updateRound = (patch: Partial<Round>) => {
    setRounds(prev => prev.map((r, i) => i === currentRound ? { ...r, ...patch } : r));
  };

  const handlePost = async () => {
    if (!allNamed) return;
    setPostState('saving');
    try {
      const result = await trpc.palettePoet.createPuzzle.mutate({
        title: title.trim(),
        colors: activeRounds.map(r => ({ hex: r.hex, name: r.name.trim(), description: r.description.trim() })),
      });
      setPostUrl(result.postUrl);
      setPostState('done');
      navigateTo(result.postUrl);
    } catch (err) {
      console.error('[palette-poet-creator] failed:', err);
      void showToast({ text: 'Failed to post. Try again.', appearance: 'neutral' });
      setPostState('idle');
    }
  };

  if (postState === 'done') {
    return (
      <div className="flex flex-col items-center justify-center gap-6 overflow-hidden bg-white px-6" style={{ height: '100dvh' }}>
        <p style={{ fontSize: 28, fontWeight: 900, color: '#111', textAlign: 'center' }}>Palette posted!</p>
        <div style={{ display: 'flex', gap: 10 }}>
          {activeRounds.map((r, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: r.hex, boxShadow: '0 2px 8px rgba(0,0,0,0.18)' }} />
              <p style={{ fontSize: 9, color: '#9ca3af', maxWidth: 44, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', maxWidth: 280 }}>
          Players will see your color names and try to match the exact shades.
        </p>
        {postUrl && (
          <button
            onClick={() => navigateTo(postUrl)}
            style={{ height: 48, borderRadius: 999, background: '#ea580c', color: '#fff', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', padding: '0 32px' }}
          >
            View Palette
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col overflow-hidden bg-white" style={{ height: '100dvh' }}>
      {/* Header — label + title on one row */}
      <div style={{ borderBottom: '1px solid #f3f4f6', padding: '6px 16px', flexShrink: 0 }}>
        <div className="mx-auto flex w-full max-w-md items-center gap-3 sm:max-w-5xl">
          <p className="hidden sm:block" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0, whiteSpace: 'nowrap' }}>
            Palette Poet — Create
          </p>
          <input
            type="text"
            placeholder="Puzzle title…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={60}
            style={{ ...inputStyle, flex: 1, borderRadius: 8, padding: '5px 10px', fontSize: 12, fontWeight: 600 }}
          />
        </div>
      </div>

      {/* Round chips — count control merged into the selector */}
      <div style={{ flexShrink: 0, padding: '8px 16px 4px' }}>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center' }}>
          {Array.from({ length: PP_MAX_ROUNDS }, (_, i) => {
            if (i >= roundCount) {
              return (
                <button
                  key={i}
                  onClick={() => { setRoundCount(i + 1); setCurrentRound(i); }}
                  aria-label={`Add round ${i + 1}`}
                  style={{
                    width: CHIP, height: CHIP, borderRadius: '50%', flexShrink: 0,
                    border: '2px dashed #e5e7eb', background: '#fff', color: '#d1d5db',
                    fontSize: 16, fontWeight: 700, lineHeight: 1, cursor: 'pointer', padding: 0,
                  }}
                >
                  +
                </button>
              );
            }
            const r = rounds[i]!;
            const selected = i === currentRound;
            const named = r.name.trim().length > 0;
            return (
              <div key={i} style={{ position: 'relative', flexShrink: 0 }}>
                <button
                  onClick={() => setCurrentRound(i)}
                  aria-label={`Round ${i + 1}`}
                  style={{
                    display: 'block', width: CHIP, height: CHIP, borderRadius: '50%', border: 'none',
                    cursor: 'pointer', backgroundColor: r.hex, padding: 0,
                    outline: selected ? '3px solid #ea580c' : named ? '2px solid rgba(0,0,0,0.12)' : '2px dashed #d1d5db',
                    outlineOffset: 2,
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                  }}
                >
                  {!named && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.85)', textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>{i + 1}</span>
                  )}
                </button>
                {selected && i === roundCount - 1 && roundCount > PP_MIN_ROUNDS && (
                  <button
                    onClick={() => { setRoundCount(roundCount - 1); setCurrentRound(roundCount - 2); }}
                    aria-label="Remove round"
                    style={{
                      position: 'absolute', top: -7, right: -7, width: 17, height: 17, borderRadius: '50%',
                      border: '2px solid #fff', background: '#111827', color: '#fff',
                      fontSize: 10, lineHeight: '13px', padding: 0, cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <p style={{ textAlign: 'center', fontSize: 10.5, color: '#9ca3af', margin: '5px 0 0', fontWeight: 600 }}>
          {hint}
        </p>
      </div>

      {/* Main — wheel beside the text fields on wide screens, stacked on narrow */}
      <div className="mx-auto flex w-full min-h-0 max-w-md flex-1 flex-col gap-2 px-4 pb-1 sm:max-w-5xl sm:flex-row sm:items-stretch sm:gap-8">
        {/* Picker pane measures the space it is GIVEN — the wheel is absolutely
            positioned inside so its size can never feed back into the measurement. */}
        <div ref={pickerRef} className="relative min-h-0 min-w-0 flex-1">
          <div className="absolute inset-0 flex items-center justify-center">
            {pickerBox.w > 0 && pickerBox.h > 0 && (
              <WheelPicker
                selectedColor={current.hex}
                onColorSelected={hex => updateRound({ hex })}
                fit={pickerBox}
              />
            )}
          </div>
        </div>

        <div className="flex w-full flex-shrink-0 flex-col justify-center gap-2 sm:w-[340px]">
          <div>
            <label style={labelStyle}>
              Color Name <span style={{ color: '#ea580c' }}>*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. 3am regret, grandma's couch…"
              value={current.name}
              onChange={e => updateRound({ name: e.target.value })}
              maxLength={80}
              style={{ ...inputStyle, fontWeight: 600 }}
            />
          </div>
          <div>
            <label style={labelStyle}>
              Description <span style={{ fontWeight: 400, color: '#d1d5db', textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <input
              type="text"
              placeholder="the shade you see at 3am when you can't sleep"
              value={current.description}
              onChange={e => updateRound({ description: e.target.value })}
              maxLength={200}
              style={{ ...inputStyle, color: '#374151' }}
            />
          </div>
        </div>
      </div>

      {/* Pinned actions — Add stays primary until the palette is a decent length */}
      <div style={{ borderTop: '1px solid #f3f4f6', padding: '8px 16px', background: '#fff', flexShrink: 0 }}>
        <div className="mx-auto w-full max-w-md sm:max-w-5xl">
          <div style={{ display: 'flex', gap: 8 }}>
            {canAdd && (
              <button
                onClick={() => { setRoundCount(roundCount + 1); setCurrentRound(roundCount); }}
                disabled={!allNamed}
                className={allNamed && addIsPrimary ? 'pp-add-pulse' : undefined}
                style={{
                  flex: addIsPrimary ? 2 : 1, height: 44, borderRadius: 999,
                  border: addIsPrimary ? 'none' : '2px solid #fed7aa',
                  background: !allNamed ? '#f3f4f6' : addIsPrimary ? '#ea580c' : '#fff',
                  color: !allNamed ? '#9ca3af' : addIsPrimary ? '#fff' : '#ea580c',
                  fontWeight: 800, fontSize: 15,
                  cursor: allNamed ? 'pointer' : 'default',
                }}
              >
                + Add Next Color
              </button>
            )}
            <button
              onClick={handlePost}
              disabled={!allNamed || postState === 'saving'}
              style={{
                flex: canAdd && addIsPrimary ? 1 : 2, height: 44, borderRadius: 999,
                border: allNamed && canAdd && addIsPrimary ? '2px solid #e5e7eb' : 'none',
                background: !allNamed ? '#f3f4f6' : canAdd && addIsPrimary ? '#fff' : '#ea580c',
                color: !allNamed ? '#9ca3af' : canAdd && addIsPrimary ? '#4b5563' : '#fff',
                fontWeight: 800, fontSize: 15,
                cursor: allNamed ? 'pointer' : 'default',
                opacity: postState === 'saving' ? 0.7 : 1,
              }}
            >
              {postState === 'saving' ? 'Posting…' : canAdd && addIsPrimary ? 'Post Now' : 'Post Palette'}
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 10.5, color: '#9ca3af', margin: '5px 0 0', fontWeight: 600 }}>
            {footerNote}
          </p>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PalettePoetCreator />
  </StrictMode>
);

import './index.css';

import { StrictMode, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo, showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { COLOR_PALETTE } from '../shared/colors';

type PColor = { name: string; hex: string };

const SearchIcon = () => (
  <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6.5" cy="6.5" r="5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
  </svg>
);

const ChevronIcon = ({ dir }: { dir: 'left' | 'right' }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    {dir === 'left' ? <polyline points="15 18 9 12 15 6" /> : <polyline points="9 18 15 12 9 6" />}
  </svg>
);

export const Creator = () => {
  const [colors, setColors] = useState<PColor[]>(() => COLOR_PALETTE.map(c => ({ name: c.name, hex: c.hex })));
  const [pizzaLoading, setPizzaLoading] = useState(false);
  const pizzaLoaded = useRef(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [browseIndex, setBrowseIndex] = useState(0);
  const [confirmed, setConfirmed] = useState<(PColor | null)[]>([null, null, null, null, null]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [hints, setHints] = useState<string[]>(['', '', '', '', '']);
  const [inputMode, setInputMode] = useState<'slider' | 'wheel'>('slider');
  const [postState, setPostState] = useState<'idle' | 'saving' | 'done'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPizzaColors = () => {
    if (pizzaLoaded.current || pizzaLoading) return;
    setPizzaLoading(true);
    trpc.game.getColors.query()
      .then(data => { setColors(data); pizzaLoaded.current = true; })
      .catch(() => { /* keep local palette */ })
      .finally(() => setPizzaLoading(false));
  };

  const displayColors = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return colors;
    const sw = colors.filter(c => c.name.toLowerCase().startsWith(q));
    const rest = colors.filter(c => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...sw, ...rest];
  }, [colors, searchQuery]);

  const currentColor = displayColors[browseIndex] ?? null;
  const allConfirmed = confirmed.every(Boolean);

  const firstUnused = (confirmedList: (PColor | null)[]) => {
    const names = new Set(confirmedList.filter(Boolean).map(c => c!.name));
    const idx = colors.findIndex(c => !names.has(c.name));
    return Math.max(0, idx);
  };

  const jumpToRound = (i: number) => {
    setCurrentRound(i);
    setSearchQuery('');
    setSearchOpen(false);
    const c = confirmed[i];
    if (c) {
      const idx = colors.findIndex(col => col.name === c.name);
      setBrowseIndex(Math.max(0, idx));
    } else {
      setBrowseIndex(firstUnused(confirmed));
    }
  };

  const handleSearchSelect = (idx: number) => {
    setBrowseIndex(idx);
    setSearchOpen(false);
    inputRef.current?.blur();
  };

  const handlePick = () => {
    if (!currentColor) return;
    const dupeIdx = confirmed.findIndex((c, i) => i !== currentRound && c?.name === currentColor.name);
    if (dupeIdx !== -1) {
      void showToast({ text: `Already used in Round ${dupeIdx + 1}`, appearance: 'neutral' });
      return;
    }
    const next = [...confirmed];
    next[currentRound] = currentColor;
    setConfirmed(next);
    if (currentRound < 4) {
      const nr = currentRound + 1;
      setCurrentRound(nr);
      const existing = next[nr];
      if (existing) {
        const idx = colors.findIndex(c => c.name === existing.name);
        setBrowseIndex(Math.max(0, idx));
      } else {
        setBrowseIndex(firstUnused(next));
      }
      setSearchQuery('');
    }
  };

  const handlePost = async () => {
    if (!allConfirmed) return;
    setPostState('saving');
    try {
      const result = await trpc.game.createCustomPuzzle.mutate({
        colors: confirmed.map(c => ({ name: c!.name, hex: c!.hex })),
        hints,
        title: title.trim() || undefined,
        inputMode,
      });
      setPostState('done');
      navigateTo(result.postUrl);
    } catch (err) {
      console.error('[creator] handlePost failed:', err);
      void showToast({ text: 'Failed to post. Try again.', appearance: 'neutral' });
      setPostState('idle');
    }
  };

  if (postState === 'done') {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-6 bg-white dark:bg-gray-900 px-4">
        <p className="text-2xl font-black text-gray-900 dark:text-white">Puzzle ready!</p>
        <div className="flex gap-3">
          {confirmed.map((c, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <div className="h-12 w-12 rounded-xl shadow-md" style={{ backgroundColor: c?.hex }} />
              <p className="w-12 truncate text-center text-[9px] font-medium text-gray-400">{c?.name}</p>
            </div>
          ))}
        </div>
        <p className="max-w-xs text-center text-sm text-gray-500 dark:text-gray-400">
          Players will see each color name and try to match the exact shade.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="shrink-0 border-b border-gray-100 bg-white/95 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        <div className="mx-auto flex max-w-sm items-center px-4 py-1.5 sm:max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Custom Color Guessr</p>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col overflow-hidden px-4 pt-3 sm:max-w-lg">

        {/* Title input */}
        <div className="mb-4 shrink-0">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
              Puzzle Title <span className="font-normal normal-case text-gray-300">(optional)</span>
            </label>
            <div className="flex items-center overflow-hidden rounded-full bg-gray-800 p-0.5">
              {(['slider', 'wheel'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-all ${
                    inputMode === mode
                      ? 'bg-white text-gray-900 shadow'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>
          <input
            type="text"
            placeholder="e.g. Sunset Vibes, Ocean Palette…"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={60}
            className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-800 placeholder-gray-300 outline-none transition focus:border-orange-400 focus:bg-white focus:ring-2 focus:ring-orange-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder-gray-600"
          />
        </div>

        {/* Round circles */}
        <div className="mb-4 flex shrink-0 items-center justify-center gap-3">
          {confirmed.map((c, i) => (
            <button
              key={i}
              onClick={() => jumpToRound(i)}
              className="flex h-10 w-10 items-center justify-center rounded-full transition-all active:scale-95"
              style={{
                backgroundColor: c?.hex ?? 'transparent',
                border: i === currentRound ? '2.5px solid #ea580c' : c ? '2px solid transparent' : '2px solid #d1d5db',
                boxShadow: c ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {!c && <span className="text-xs font-bold text-gray-400">{i + 1}</span>}
            </button>
          ))}
        </div>

        {/* Search bar + dropdown */}
        <div className="relative shrink-0">
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <span className="shrink-0 text-gray-400"><SearchIcon /></span>
            <input
              ref={inputRef}
              type="text"
              placeholder={pizzaLoading ? 'Loading colors…' : 'Search color names…'}
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setBrowseIndex(0); }}
              onFocus={() => { setSearchOpen(true); loadPizzaColors(); }}
              className="flex-1 bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none dark:text-gray-200"
            />
            {searchOpen && (
              <button
                onClick={() => { setSearchOpen(false); setSearchQuery(''); inputRef.current?.blur(); }}
                className="shrink-0 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
            )}
          </div>

          {searchOpen && (
            <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-2xl border border-gray-100 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800">
              {pizzaLoading ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">Loading colors…</p>
              ) : displayColors.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">No colors found</p>
              ) : (
                displayColors.map((c, idx) => (
                  <button
                    key={`${c.name}-${idx}`}
                    onClick={() => handleSearchSelect(idx)}
                    className="flex w-full items-center gap-4 px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    <div
                      className="h-9 w-9 shrink-0 rounded-full border border-black/10 shadow-sm"
                      style={{ backgroundColor: c.hex }}
                    />
                    <div className="min-w-0 text-left">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.name}</p>
                      <p className="font-mono text-xs text-gray-400">{c.hex}</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Card + arrows + hint + dots + button */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col pb-4">

          {/* Card row */}
          <div className="flex min-h-0 flex-1 items-center gap-2" style={{ minHeight: 72 }}>
            <button
              onClick={() => setBrowseIndex(i => Math.max(0, i - 1))}
              disabled={browseIndex === 0}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-md transition-all active:scale-95 disabled:opacity-25 dark:bg-gray-800"
            >
              <ChevronIcon dir="left" />
            </button>

            <div
              className="flex min-h-0 flex-1 flex-col justify-end rounded-3xl px-5 pt-3 pb-4 shadow-lg"
              style={{
                backgroundColor: currentColor?.hex ?? '#94a3b8',
                alignSelf: 'stretch',
              }}
            >
              {currentColor ? (
                <>
                  <p className="text-xl font-black leading-snug text-white drop-shadow-sm">{currentColor.name}</p>
                  <p className="mt-0.5 font-mono text-xs text-white/70">{currentColor.hex}</p>
                </>
              ) : (
                <p className="text-sm text-white/60">No results</p>
              )}
            </div>

            <button
              onClick={() => setBrowseIndex(i => Math.min(displayColors.length - 1, i + 1))}
              disabled={browseIndex >= displayColors.length - 1}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white shadow-md transition-all active:scale-95 disabled:opacity-25 dark:bg-gray-800"
            >
              <ChevronIcon dir="right" />
            </button>
          </div>

          {/* Hint input for current round */}
          <div className="mt-2 shrink-0">
            <div className="mb-0.5 flex items-center justify-between">
              <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-amber-500">
                💡 Hint for Round {currentRound + 1}
                <span className="font-normal normal-case text-gray-300">(optional)</span>
              </label>
              <span className="text-[10px] tabular-nums text-gray-400">{(hints[currentRound] ?? '').length}/80</span>
            </div>
            <input
              type="text"
              value={hints[currentRound] ?? ''}
              onChange={e => {
                const val = e.target.value.slice(0, 80);
                setHints(prev => { const n = [...prev]; n[currentRound] = val; return n; });
              }}
              placeholder="Write your hint… e.g. Brilliant red-orange or like Chinese lacquer…"
              maxLength={80}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-amber-800 dark:bg-amber-950/30 dark:text-gray-200 dark:placeholder-gray-500"
            />
          </div>

          {/* Round progress dots */}
          <div className="flex shrink-0 items-center justify-center gap-2 py-2">
            {confirmed.map((c, i) => (
              <button
                key={i}
                onClick={() => jumpToRound(i)}
                className="rounded-full transition-all"
                style={{
                  width: i === currentRound ? '20px' : '8px',
                  height: '8px',
                  backgroundColor: c?.hex ?? (i === currentRound ? '#ea580c' : '#d1d5db'),
                  opacity: i === currentRound ? 1 : 0.65,
                }}
              />
            ))}
          </div>

          {/* Action button */}
          {allConfirmed ? (
            <button
              onClick={handlePost}
              disabled={postState === 'saving'}
              className="w-full shrink-0 rounded-full bg-orange-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-60"
            >
              {postState === 'saving' ? 'Posting…' : 'Post Challenge'}
            </button>
          ) : (
            <button
              onClick={handlePick}
              disabled={!currentColor}
              className="w-full shrink-0 rounded-full bg-orange-600 px-6 py-3.5 text-base font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-50"
            >
              Pick for Round {currentRound + 1}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Creator />
  </StrictMode>
);

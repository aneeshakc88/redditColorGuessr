import { describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { EQUINOX_BANK, EQUINOX_BANK_N } from '../shared/equinox-bank';
import { EMPTY, EQUINOX_COLORS, NAVY, decodePuzzle, equinoxPuzzleNumber, pickDaily, solveLogical, violations } from '../shared/equinox-core';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const today = new Date().toISOString().split('T')[0]!;
const encoded = { n: EQUINOX_BANK_N, ...pickDaily(EQUINOX_BANK, today) };
const puzzle = decodePuzzle(encoded);
const answer = solveLogical(puzzle).cells;

// Who the server says is viewing. Logged-out feed viewers get the card too, so
// tests flip this to cover the path where nothing can be recorded.
let viewer: string | null = 'test-user';
const submits = vi.fn();

vi.mock('./trpc', () => ({
  trpc: {
    equinox: {
      getBoard: { query: () => Promise.resolve({ puzzle: encoded, date: today, num: equinoxPuzzleNumber(today), playerCount: 3, alreadyPlayed: false, best: null, username: viewer, streak: null }) },
      begin: { mutate: () => Promise.resolve({ counts: true, startedAt: Date.now() }) },
      submit: {
        mutate: ({ cells }: { cells: number[] }) => {
          submits(cells);
          return Promise.resolve(violations(EQUINOX_BANK_N, cells, puzzle.numbers).length > 0
            ? { solved: false as const, reason: 'rules broken' }
            : { solved: true as const, score: 900, timeSec: 12, recorded: true, playerCount: 4, userRank: 1, topPct: 25, streak: 2, lifetimeSolves: 7 });
        },
      },
      postComment: { mutate: () => Promise.resolve({ success: true }) },
    },
  },
}));

vi.mock('@devvit/web/client', () => ({
  showToast: vi.fn(),
  context: { username: 'test-user' },
}));

const { EquinoxGame } = await import('./equinox-game');

const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const cellsIn = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLButtonElement>('button[aria-label^="row "]'));
const byLabel = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

async function mount(node: ReactElement) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => { createRoot(host).render(node); });
  await flush();
  return host;
}

describe('Equinox in the feed card', () => {
  it('plays the full board with the reset control folded into the header', async () => {
    const host = await mount(<EquinoxGame compact />);

    expect(cellsIn(host)).toHaveLength(EQUINOX_BANK_N * EQUINOX_BANK_N);
    // The bottom Reset button is what the compact layout trades for cell size.
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Reset')).toBe(false);
    expect(byLabel(host, 'Reset board')).not.toBeNull();

    const i = puzzle.clues.findIndex(c => c === EMPTY);
    await act(async () => { cellsIn(host)[i]!.click(); });
    await flush();
    expect(cellsIn(host)[i]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.orange));

    await act(async () => { byLabel(host, 'Reset board')!.click(); });
    await flush();
    expect(cellsIn(host)[i]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.empty));
  });

  it('shows the trophy only when the host offers a leaderboard', async () => {
    const bare = await mount(<EquinoxGame compact />);
    expect(byLabel(bare, 'Leaderboard')).toBeNull();

    const open = vi.fn();
    const withLb = await mount(<EquinoxGame compact onLeaderboard={open} />);
    await act(async () => { byLabel(withLb, 'Leaderboard')!.click(); });
    expect(open).toHaveBeenCalled();
  });

  it('keeps the standalone layout on the expanded entrypoint', async () => {
    const host = await mount(<EquinoxGame />);
    expect(Array.from(host.querySelectorAll('button')).some(b => b.textContent?.trim() === 'Reset')).toBe(true);
    expect(byLabel(host, 'Reset board')).toBeNull();
    expect(host.textContent).toContain(today);
  });

  // The server rejects an anonymous submit, so the client must never send one —
  // otherwise a logged-out solver is stranded on a finished board with a toast
  // telling them to retry something that can never succeed.
  it('celebrates a logged-out solve locally instead of submitting it', async () => {
    viewer = null;
    submits.mockClear();
    try {
      const host = await mount(<EquinoxGame compact />);
      for (let i = 0; i < puzzle.clues.length; i++) {
        if (puzzle.clues[i] !== EMPTY) continue;
        await act(async () => { cellsIn(host)[i]!.click(); });
        if (answer[i] === NAVY) await act(async () => { cellsIn(host)[i]!.click(); });
      }
      await flush();

      expect(submits).not.toHaveBeenCalled();
      expect(host.textContent).toContain('Puzzle solved');
      expect(host.textContent).toContain('Log in to Reddit');
      expect(host.textContent).not.toContain('Comment score');
    } finally { viewer = 'test-user'; }
  });
});

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

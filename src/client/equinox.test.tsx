import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { EQUINOX_BANK, EQUINOX_BANK_N } from '../shared/equinox-bank';
import {
  EMPTY, NAVY, ORANGE, EQUINOX_COLORS, decodePuzzle, equinoxPuzzleNumber, equinoxScore, pickDaily, solveLogical, violations,
} from '../shared/equinox-core';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const today = new Date().toISOString().split('T')[0]!;
const encoded = { n: EQUINOX_BANK_N, ...pickDaily(EQUINOX_BANK, today) };
const puzzle = decodePuzzle(encoded);
const answer = solveLogical(puzzle).cells;

let submitted: number[][] = [];

// Stands in for the server: same acceptance rules, so a board the UI sends is
// judged here exactly the way trpc.equinox.submit judges it.
vi.mock('./trpc', () => ({
  trpc: {
    equinox: {
      getBoard: { query: () => Promise.resolve({ puzzle: encoded, date: today, num: equinoxPuzzleNumber(today), playerCount: 3, alreadyPlayed: false, best: null, username: 'test-user', streak: null }) },
      begin: { mutate: () => Promise.resolve({ counts: true, startedAt: Date.now() }) },
      submit: {
        mutate: ({ cells }: { cells: number[] }) => {
          submitted.push(cells);
          if (cells.some(c => c === EMPTY) || violations(EQUINOX_BANK_N, cells, puzzle.numbers).length > 0) {
            return Promise.resolve({ solved: false as const, reason: 'rules broken' });
          }
          return Promise.resolve({
            solved: true as const, score: equinoxScore(12), timeSec: 12, recorded: true,
            playerCount: 4, userRank: 1, topPct: 25, streak: 2, lifetimeSolves: 7,
          });
        },
      },
      getLeaderboard: { query: () => Promise.resolve({ top: [], userRank: null, username: 'test-user', dailyCount: 0, date: today, snoovatars: {}, userScore: null, userTimeSec: null, stats: null, streak: null }) },
      postComment: { mutate: () => Promise.resolve({ success: true }) },
    },
  },
}));

vi.mock('@devvit/web/client', () => ({
  showToast: vi.fn(),
  context: { username: 'test-user' },
}));

const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 0)); }); };
const dots = () => Array.from(document.querySelectorAll<HTMLButtonElement>('button[aria-label^="row "]'));
const byText = (text: string) => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.trim() === text);
const click = async (el: Element | undefined) => {
  await act(async () => { (el as HTMLButtonElement).click(); });
  await flush();
};

// The module mounts itself on import, so the whole suite drives one board.
const mounted = (async () => {
  document.body.innerHTML = '<div id="root"></div>';
  await import('./equinox');
  await flush();
})();

describe('Equinox board', () => {
  it('renders the board the server handed it, with clue cells locked', async () => {
    await mounted;
    const cells = dots();
    expect(cells).toHaveLength(EQUINOX_BANK_N * EQUINOX_BANK_N);
    cells.forEach((el, i) => expect(el.disabled, `cell ${i}`).toBe(puzzle.clues[i] !== EMPTY));
    expect(document.body.textContent).toContain(today);
  });

  it('cycles a cell orange, then navy, then empty', async () => {
    await mounted;
    const i = puzzle.clues.findIndex(c => c === EMPTY);

    await click(dots()[i]);
    expect(dots()[i]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.orange));

    await click(dots()[i]);
    expect(dots()[i]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.navy));

    await click(dots()[i]);
    expect(dots()[i]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.empty));
  });

  it('resets the whole board', async () => {
    await mounted;
    const i = puzzle.clues.findIndex(c => c === EMPTY);
    const j = puzzle.clues.lastIndexOf(EMPTY);

    await click(dots()[i]);
    await click(dots()[j]);
    await click(dots()[j]);
    expect(dots()[j]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.navy));

    await click(byText('Reset'));
    expect(dots()[i]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.empty));
    expect(dots()[j]!.style.backgroundColor).toBe(rgb(EQUINOX_COLORS.empty));
  });

  it('counts down the dots left to fill', async () => {
    await mounted;
    const empties = puzzle.clues.filter(c => c === EMPTY).length;
    expect(document.body.textContent).toContain(`${empties} left`);

    const i = puzzle.clues.findIndex(c => c === EMPTY);
    await click(dots()[i]);
    expect(document.body.textContent).toContain(`${empties - 1} left`);
    await click(byText('Reset'));
  });

  it('calls out the broken lines locally and never bothers the server', async () => {
    await mounted;
    submitted = [];
    // Fill every open cell with the opposite of the answer — guaranteed illegal.
    for (let i = 0; i < puzzle.clues.length; i++) {
      if (puzzle.clues[i] !== EMPTY) continue;
      await click(dots()[i]);
      if (answer[i] === ORANGE) await click(dots()[i]);
    }

    // The coach line names the first broken line rather than a generic warning.
    expect(document.body.textContent).toMatch(/max 3|are identical|clue/i);
    expect(document.body.textContent).not.toContain('BALANCED IN');
    expect(submitted, 'a wrong board must not reach the server').toHaveLength(0);
    await click(byText('Reset'));
  });

  it('submits the right answer and shows the score the server returned', async () => {
    await mounted;
    submitted = [];
    for (let i = 0; i < puzzle.clues.length; i++) {
      if (puzzle.clues[i] !== EMPTY) continue;
      await click(dots()[i]);
      if (answer[i] === NAVY) await click(dots()[i]);
    }

    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toEqual(answer);
    // The celebration screen carries the solve, the time and the streak — and
    // deliberately nothing else (no score, rank or board thumbnail).
    expect(document.body.textContent).toContain('Puzzle solved');
    expect(document.body.textContent).toContain('0:12');
    expect(document.body.textContent).toContain('day streak');
    expect(document.body.textContent).not.toContain(`${equinoxScore(12)} pts`);
    expect(document.body.textContent).not.toContain('#1 today');
    expect(byText('Reset')).toBeUndefined();
  });

  it('posts the score to the thread', async () => {
    await mounted;
    await click(byText('Comment score'));
    expect(document.body.textContent).toContain('Posted');
  });
});

function rgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

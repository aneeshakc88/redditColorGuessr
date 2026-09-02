import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { EQUINOX_BANK, EQUINOX_BANK_N } from '../shared/equinox-bank';
import { NAVY, ORANGE, equinoxPuzzleNumber, pickDaily } from '../shared/equinox-core';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const today = new Date().toISOString().split('T')[0]!;
const encoded = { n: EQUINOX_BANK_N, ...pickDaily(EQUINOX_BANK, today) };

// Whether the server says this account has ever met Equinox.
let isNewPlayer = true;
const onboarded = vi.fn();

vi.mock('./trpc', () => ({
  trpc: {
    equinox: {
      getBoard: { query: () => Promise.resolve({ puzzle: encoded, date: today, num: equinoxPuzzleNumber(today), playerCount: 3, alreadyPlayed: false, best: null, username: 'test-user', streak: null, isNewPlayer }) },
      begin: { mutate: () => Promise.resolve({ counts: true, startedAt: Date.now() }) },
      markOnboarded: { mutate: () => { onboarded(); return Promise.resolve({ ok: true }); } },
      submit: { mutate: () => Promise.resolve({ solved: false as const, reason: 'rules broken' }) },
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

// Each lesson's open cells and the colour the rule forces on them.
const SOLUTIONS: Record<number, number>[] = [
  { 11: NAVY },
  { 1: NAVY, 8: NAVY },
  { 6: NAVY, 7: ORANGE },
];

/** Cycles a tutorial cell to the colour the lesson wants: one tap sun, two sky. */
async function place(host: HTMLElement, i: number, colour: number) {
  await act(async () => { cellsIn(host)[i]!.click(); });
  if (colour === NAVY) await act(async () => { cellsIn(host)[i]!.click(); });
}

async function solveLesson(host: HTMLElement, step: number) {
  for (const [i, colour] of Object.entries(SOLUTIONS[step]!)) {
    await place(host, Number(i), colour);
  }
  // The first two lessons hold for a beat on "Exactly." then advance on their
  // own; the last one waits for the hand-off tap instead.
  await act(async () => { await new Promise(r => setTimeout(r, 900)); });
}

const handoff = (host: HTMLElement) =>
  Array.from(host.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Play Daily Now');

describe('Equinox first-run walkthrough', () => {
  beforeEach(() => { onboarded.mockClear(); });

  it('teaches three rules on a 4x4, then hands over the real board', async () => {
    const host = await mount(<EquinoxGame compact />);

    expect(host.textContent).toContain('Balance every line');
    expect(cellsIn(host)).toHaveLength(16);

    await solveLesson(host, 0);
    expect(host.textContent).toContain('Obey the numbers');

    await solveLesson(host, 1);
    expect(host.textContent).toContain('No twin lines');

    await solveLesson(host, 2);
    // The daily is timed, so the last hop asks before it starts rather than
    // dropping a still-tapping player onto a scored board.
    expect(host.textContent).toContain('Walkthrough complete');
    expect(cellsIn(host)).toHaveLength(0);

    await act(async () => { handoff(host)!.click(); });
    await flush();
    expect(cellsIn(host)).toHaveLength(EQUINOX_BANK_N * EQUINOX_BANK_N);
    expect(onboarded).toHaveBeenCalled();
  });

  it('lands on today’s board when skipped, and records that too', async () => {
    const host = await mount(<EquinoxGame compact />);

    await act(async () => { byLabel(host, 'Skip the walkthrough')!.click(); });
    await flush();

    expect(cellsIn(host)).toHaveLength(EQUINOX_BANK_N * EQUINOX_BANK_N);
    expect(onboarded).toHaveBeenCalled();
  });

  // A wrong pair must not advance: the board shakes and the lesson stays put.
  it('holds the lesson when the placement breaks the rule', async () => {
    const host = await mount(<EquinoxGame compact />);

    await place(host, 11, ORANGE);
    await act(async () => { await new Promise(r => setTimeout(r, 900)); });

    expect(host.textContent).toContain('Balance every line');
    expect(cellsIn(host)).toHaveLength(16);
  });

  it('never interrupts a player the server already knows', async () => {
    isNewPlayer = false;
    try {
      const host = await mount(<EquinoxGame compact />);
      expect(cellsIn(host)).toHaveLength(EQUINOX_BANK_N * EQUINOX_BANK_N);
      expect(host.textContent).not.toContain('Balance every line');
    } finally { isNewPlayer = true; }
  });

  it('offers the walkthrough again from the rules sheet', async () => {
    isNewPlayer = false;
    try {
      const host = await mount(<EquinoxGame compact />);
      await act(async () => { byLabel(host, 'How to play')!.click(); });
      await flush();

      const replay = Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes('Replay'));
      expect(replay).toBeDefined();

      await act(async () => { replay!.click(); });
      await flush();
      expect(cellsIn(host)).toHaveLength(16);
    } finally { isNewPlayer = true; }
  });
});

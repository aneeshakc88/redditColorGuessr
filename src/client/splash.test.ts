import { afterEach, describe, expect, it, vi } from 'vitest';

let requestExpandedModeMock: ReturnType<typeof vi.fn>;
let navigateToMock: ReturnType<typeof vi.fn>;

vi.mock('@devvit/web/client', () => {
  requestExpandedModeMock = vi.fn();
  navigateToMock = vi.fn();

  return {
    navigateTo: navigateToMock,
    context: {
      username: 'test-user',
    },
    requestExpandedMode: requestExpandedModeMock,
  };
});

afterEach(() => {
  requestExpandedModeMock?.mockReset();
  navigateToMock?.mockReset();
});

// The splash paints over several async ticks — post info, then stats — and how
// long that takes depends on how loaded the machine is. These used to wait one
// setTimeout(0), which was enough on a warm run and not on a busy one, so they
// failed at random. Wait for the button to actually exist instead.
const findButton = (match: (b: HTMLButtonElement) => boolean): Promise<HTMLButtonElement> =>
  vi.waitFor(() => {
    const hit = Array.from(document.querySelectorAll('button')).find(match);
    if (!hit) throw new Error('button not rendered yet');
    return hit;
  }, { timeout: 15_000, interval: 20 });

describe('Splash', () => {
  it('clicking the "Scoreboard" button shows the scoreboard', { timeout: 30_000 }, async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('./splash');

    const scoreboardButton = await findButton(
      (b) => /scoreboard/i.test(b.textContent ?? '') || /scoreboard/i.test(b.getAttribute('aria-label') ?? '')
    );
    expect(scoreboardButton).toBeTruthy();
  });

  it('clicking the "Play" button calls requestExpandedMode(...)', { timeout: 30_000 }, async () => {
    const startButton = await findButton((b) => /^play$/i.test(b.textContent?.trim() ?? ''));
    expect(startButton).toBeTruthy();

    startButton.click();

    expect(requestExpandedModeMock).toHaveBeenCalledTimes(1);
  });
});

// Runs last on purpose: importing ./splash mounts a React root, so the suite
// above has to be the one that sets that root up and imports it first.
//
// The pinned board has fewer slots than notes on a short card, so something has
// to be left off. Which note that is matters: it must never be the leader.
describe('Name This Color — pinned board', () => {
  type Note = { id: string; name: string; author: string; votes: number; url: string; mine: boolean };
  const note = (id: string, votes: number): Note =>
    ({ id, name: id, author: 'u', votes, url: '/c/' + id, mine: false });

  it('keeps the top-voted names when there are more notes than pin holes', async () => {
    const { ncPlace, ncSlotSpecs } = await import('./splash');

    // A landscape phone: one row of gutter slots, no room for a centre note.
    const specs = ncSlotSpecs(false, 1);
    expect(specs.length).toBeLessThan(8);

    // getSplash hands the board over in vote order.
    const notes = [
      note('leader', 40), note('b', 30), note('c', 20), note('d', 10),
      note('e', 4), note('f', 3), note('g', 2), note('h', 1),
    ];
    const placed = ncPlace(notes, specs);

    expect(placed.size).toBe(specs.length);
    expect(placed.has('leader')).toBe(true);
    // Everything pinned is from the head of the vote order, nothing from the tail.
    for (const id of placed.keys()) {
      expect(notes.findIndex(n => n.id === id)).toBeLessThan(specs.length);
    }
  });

  it('pins a note in the same hole however its votes move', async () => {
    const { ncPlace, ncSlotSpecs } = await import('./splash');
    const specs = ncSlotSpecs(true, 4);

    const before = ncPlace([note('a', 9), note('b', 5), note('c', 1)], specs);
    // c overtakes; the board reorders but the pins must not jump around.
    const after = ncPlace([note('c', 12), note('a', 9), note('b', 5)], specs);

    for (const id of ['a', 'b', 'c']) {
      expect(after.get(id)).toEqual(before.get(id));
    }
  });
});

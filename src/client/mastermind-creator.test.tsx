import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const navigateTo = vi.fn();
const createCustomPuzzle = vi.fn(async (_args: { poolColors: { hex: string }[]; secret: string[] }) => ({ postUrl: 'https://reddit.com/r/x/comments/abc/' }));

vi.mock('@devvit/web/client', () => ({
  navigateTo: (url: string) => navigateTo(url),
  showToast: vi.fn(),
}));
vi.mock('./trpc', () => ({
  trpc: { mastermind: { createCustomPuzzle: { mutate: (args: unknown) => createCustomPuzzle(args as never) } } },
}));
vi.mock('./audio', () => ({ audioCtx: () => null }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no ResizeObserver; the picker only needs it to report a box.
class RO { observe() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver = RO;

const POOL_SIZE = 6;
const SECRET_LEN = 4;

const byText = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.includes(text));

const mountCreator = async () => {
  const host = document.createElement('div');
  host.id = 'root';
  document.body.appendChild(host);
  const { MastermindCreator } = await import('./mastermind-creator');
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const root = createRoot(mount);
  await act(async () => { root.render(<MastermindCreator />); });
  return mount;
};

describe('crack the code creator', () => {
  beforeEach(() => {
    navigateTo.mockClear();
    createCustomPuzzle.mockClear();
    document.body.innerHTML = '';
  });

  it('surprise me fills every pool slot with distinct colors', async () => {
    const mount = await mountCreator();
    await act(async () => { byText(mount, 'Surprise me')!.click(); });

    // Step 2 lists one tappable chip per filled pool color.
    await act(async () => { byText(mount, 'Set the Secret')!.click(); });
    const chips = Array.from(mount.querySelectorAll('button')).filter(b => /border-radius:\s*50%/.test(b.getAttribute('style') ?? ''));
    const hexes = chips
      .map(b => (b.getAttribute('style') ?? '').match(/background-color:\s*([^;]+)/)?.[1])
      .filter(Boolean);
    expect(hexes.length).toBe(POOL_SIZE);
    expect(new Set(hexes).size).toBe(POOL_SIZE);
  });

  it('posts the pool and secret once four discs are seated', async () => {
    const mount = await mountCreator();
    await act(async () => { byText(mount, 'Surprise me')!.click(); });
    await act(async () => { byText(mount, 'Set the Secret')!.click(); });

    const chip = () => Array.from(mount.querySelectorAll('button'))
      .filter(b => /border-radius:\s*50%/.test(b.getAttribute('style') ?? ''))[0]!;
    for (let i = 0; i < SECRET_LEN; i++) {
      await act(async () => { chip().click(); });
    }

    await act(async () => { byText(mount, 'Post Rescue Puzzle')!.click(); });
    await act(async () => {});

    expect(createCustomPuzzle).toHaveBeenCalledTimes(1);
    const sent = createCustomPuzzle.mock.calls[0]![0] as unknown as {
      poolColors: { hex: string }[]; secret: string[];
    };
    expect(sent.poolColors.length).toBe(POOL_SIZE);
    expect(sent.secret.length).toBe(SECRET_LEN);
    // Server rejects any secret color that isn't in the pool.
    const pool = new Set(sent.poolColors.map(c => c.hex));
    expect(sent.secret.every(h => pool.has(h))).toBe(true);
    expect(navigateTo).toHaveBeenCalledWith('https://reddit.com/r/x/comments/abc/');
  });

  it('leaves the post button disabled until the secret is full', async () => {
    const mount = await mountCreator();
    await act(async () => { byText(mount, 'Surprise me')!.click(); });
    await act(async () => { byText(mount, 'Set the Secret')!.click(); });

    expect(byText(mount, 'Post Rescue Puzzle')!.disabled).toBe(true);
    expect(byText(mount, 'Delete Last')!.disabled).toBe(true);
  });

  it('delete last removes only the most recent disc', async () => {
    const mount = await mountCreator();
    await act(async () => { byText(mount, 'Surprise me')!.click(); });
    await act(async () => { byText(mount, 'Set the Secret')!.click(); });

    const chips = () => Array.from(mount.querySelectorAll('button'))
      .filter(b => /border-radius:\s*50%/.test(b.getAttribute('style') ?? ''));
    await act(async () => { chips()[0]!.click(); });
    await act(async () => { chips()[1]!.click(); });
    await act(async () => { byText(mount, 'Delete Last')!.click(); });
    await act(async () => { chips()[2]!.click(); });
    await act(async () => { chips()[3]!.click(); });
    await act(async () => { chips()[4]!.click(); });

    await act(async () => { byText(mount, 'Post Rescue Puzzle')!.click(); });
    await act(async () => {});

    const sent = createCustomPuzzle.mock.calls[0]![0] as unknown as { poolColors: { hex: string }[]; secret: string[] };
    const poolHexes = sent.poolColors.map(c => c.hex);
    // chip 1 was deleted, so the secret is chips 0, 2, 3, 4 in tap order.
    expect(sent.secret).toEqual([poolHexes[0], poolHexes[2], poolHexes[3], poolHexes[4]]);
  });
});

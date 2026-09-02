import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@devvit/web/client', () => ({
  navigateTo: vi.fn(),
  showToast: vi.fn(),
}));
vi.mock('./trpc', () => ({
  trpc: { wire: { createCustomPuzzle: { mutate: vi.fn(async () => ({ postUrl: 'http://x/p' })) } } },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom gives every element a zero-sized box, and the editor maps a tap to a
// cell through that box.
const stubBox = (el: Element, size = 100) => {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: size, height: size, right: size, bottom: size, x: 0, y: 0, toJSON: () => ({}) });
};

const buttonWith = (root: HTMLElement, text: string) =>
  Array.from(root.querySelectorAll('button')).find(b => b.textContent?.includes(text));

const mountCreator = async () => {
  // The module mounts itself on import, so #root has to exist first.
  if (!document.getElementById('root')) {
    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);
  }
  const { WireCreator } = await import('./wire-creator');
  const mount = document.createElement('div');
  document.body.appendChild(mount);
  const root = createRoot(mount);
  await act(async () => { root.render(<WireCreator />); });
  // Smallest board keeps the generator's search short.
  await act(async () => { buttonWith(mount, '5')!.click(); });
  return mount;
};

const editorSvg = (mount: HTMLElement) => mount.querySelector('svg[viewBox="0 0 5 5"]')!;

// Placed dots only — the pending-pair ring is a circle too, but an unfilled one.
const dots = (mount: HTMLElement) =>
  Array.from(editorSvg(mount).querySelectorAll('circle')).filter(c => c.getAttribute('fill') !== 'none').length;

// Drops dots on distinct cells of the 5x5 editor by tapping through its box.
const tapCells = async (mount: HTMLElement, cells: [number, number][]) => {
  const svg = editorSvg(mount);
  stubBox(svg);
  for (const [c, r] of cells) {
    await act(async () => {
      // jsdom has no PointerEvent; React only needs the 'pointerdown' type.
      svg.dispatchEvent(new MouseEvent('pointerdown', { clientX: c * 20 + 10, clientY: r * 20 + 10, bubbles: true }));
    });
  }
};

const surprise = async (mount: HTMLElement) => {
  await act(async () => { buttonWith(mount, 'Surprise me')!.click(); });
  await act(async () => { await new Promise(r => setTimeout(r, 60)); });
};

// Three pairs on the 5x5 grid: the fewest a board can post with.
const handBuild = (mount: HTMLElement) =>
  tapCells(mount, [[0, 0], [4, 0], [0, 2], [4, 2], [0, 4], [4, 4]]);

describe('wire creator', () => {
  it('sends a hand-built board through the test screen and back', async () => {
    const mount = await mountCreator();
    await handBuild(mount);

    // One primary button, never two: a hand-built board's is Test & Verify.
    expect(buttonWith(mount, 'Validate & Post')).toBeFalsy();
    const testBtn = buttonWith(mount, 'Test & Verify')!;
    expect(testBtn.hasAttribute('disabled')).toBe(false);

    await act(async () => { testBtn.click(); });
    expect(mount.querySelector('.wc-testbar')).toBeTruthy();
    expect(buttonWith(mount, 'Clear wires')).toBeTruthy();
    expect(buttonWith(mount, 'Back to editing')).toBeTruthy();
    // The builder's own controls are gone while the test screen is up.
    expect(buttonWith(mount, 'Surprise me')).toBeFalsy();
    // Nothing posts until the run proves the board.
    expect(buttonWith(mount, 'Solve it to post')!.hasAttribute('disabled')).toBe(true);

    await act(async () => { buttonWith(mount, 'Back to editing')!.click(); });
    expect(buttonWith(mount, 'Test & Verify')).toBeTruthy();
  });

  it('posts an untouched generated board, but sends an edited one to the test screen', async () => {
    const mount = await mountCreator();
    await surprise(mount);

    // The carve is a proof, so an untouched board posts without being played.
    expect(buttonWith(mount, 'Test & Verify')).toBeFalsy();
    expect(buttonWith(mount, 'Validate & Post')!.hasAttribute('disabled')).toBe(false);

    const before = dots(mount);
    await tapCells(mount, [[0, 0]]);
    // One moved dot and the carve no longer describes this board.
    expect(dots(mount)).not.toBe(before);
    expect(buttonWith(mount, 'Validate & Post')).toBeFalsy();
    expect(buttonWith(mount, 'Test & Verify')).toBeTruthy();
  });

  it('drops a run when a dot moves under it', async () => {
    const mount = await mountCreator();
    await handBuild(mount);
    await act(async () => { buttonWith(mount, 'Test & Verify')!.click(); });
    await act(async () => { buttonWith(mount, 'Back to editing')!.click(); });

    const before = dots(mount);
    await tapCells(mount, [[0, 0]]);
    expect(dots(mount)).not.toBe(before);
    // Still their own board, so the test screen is still the only way out.
    expect(buttonWith(mount, 'Validate & Post')).toBeFalsy();
  });

  it('fits the builder into two header rows', async () => {
    const mount = await mountCreator();
    expect(mount.querySelector('.wc-head')!.children.length).toBe(2);
    // Every size preset on one row, squares and rectangles together.
    expect(mount.querySelectorAll('.wc-sizes button').length).toBe(10);
  });
});

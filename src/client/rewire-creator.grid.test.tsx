import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@devvit/web/client', () => ({
  navigateTo: vi.fn(),
  showToast: vi.fn(),
  showForm: vi.fn(async () => ({ action: 'SUBMITTED', values: { photo: 'http://x/p.jpg' } })),
}));
vi.mock('./trpc', () => ({
  trpc: { rewire: { pinImage: { mutate: vi.fn(async () => ({ mediaUrl: 'http://x/pinned.jpg' })) } } },
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('rewire creator grid', () => {
  it('keeps cell lines after a photo is picked', async () => {
    const host = document.createElement('div');
    host.id = 'root';
    document.body.appendChild(host);
    const { RewireCreator } = await import('./rewire-creator');

    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const root = createRoot(mount);
    await act(async () => { root.render(<RewireCreator />); });

    const btn = Array.from(mount.querySelectorAll('button')).find(b => b.textContent?.includes('Upload a photo'))!;
    await act(async () => { btn.click(); });
    await act(async () => {});

    const svg = mount.querySelector('svg[viewBox="0 0 5 5"]')!;
    expect(svg.querySelector('image')?.getAttribute('href')).toBe('http://x/pinned.jpg');
    const lines = Array.from(svg.querySelectorAll('line'));
    expect(lines.length).toBe(12); // 5x5 board: 6 vertical + 6 horizontal
  });
});

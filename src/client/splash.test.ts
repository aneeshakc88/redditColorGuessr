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

describe('Splash', () => {
  it('clicking the "Scoreboard" button shows the scoreboard', async () => {
    document.body.innerHTML = '<div id="root"></div>';

    await import('./splash');

    await new Promise((r) => setTimeout(r, 0));

    const scoreboardButton = Array.from(document.querySelectorAll('button')).find(
      (b) => /scoreboard/i.test(b.textContent ?? '') || /scoreboard/i.test(b.getAttribute('aria-label') ?? '')
    );
    expect(scoreboardButton).toBeTruthy();
  });

  it('clicking the "Start Game" button calls requestExpandedMode(...)', async () => {
    await new Promise((r) => setTimeout(r, 0));

    const startButton = Array.from(document.querySelectorAll('button')).find(
      (b) => /start game/i.test(b.textContent ?? '')
    );
    expect(startButton).toBeTruthy();

    startButton!.click();

    expect(requestExpandedModeMock).toHaveBeenCalledTimes(1);
  });
});

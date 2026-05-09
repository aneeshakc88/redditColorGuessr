import './index.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';

type RouterOutputs = inferRouterOutputs<AppRouter>;

type GameState =
  | 'loading'
  | 'playing'
  | 'submitted'
  | 'completed'
  | 'error';

const hsbToHex = (h: number, s: number, b: number): string => {
  const hue = ((h % 360) + 360) % 360;
  const saturation = s / 100;
  const brightness = b / 100;
  const c = saturation * brightness;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = brightness - c;

  let r = 0;
  let g = 0;
  let bl = 0;

  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    bl = x;
  } else if (hue < 240) {
    g = x;
    bl = c;
  } else if (hue < 300) {
    r = x;
    bl = c;
  } else {
    r = c;
    bl = x;
  }

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`.toUpperCase();
};

export const App = () => {
  const [gameState, setGameState] = useState<GameState>('loading');
  const [puzzleData, setPuzzleData] = useState<RouterOutputs['game']['getPuzzle'] | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [hue, setHue] = useState(120);
  const [saturation, setSaturation] = useState(65);
  const [brightness, setBrightness] = useState(40);
  const [submitting, setSubmitting] = useState(false);
  const [roundResult, setRoundResult] = useState<any>(null);

  const selectedColor = hsbToHex(hue, saturation, brightness);

  useEffect(() => {
    const fetchPuzzle = async () => {
      try {
        const data = await trpc.game.getPuzzle.query();
        setPuzzleData(data);

        if (data.completed) {
          setGameState('completed');
        } else if (data.completedRounds > 0) {
          setCurrentRound(data.completedRounds);
          setGameState('playing');
        } else {
          setGameState('playing');
        }
      } catch (error) {
        console.error('Failed to fetch puzzle:', error);
        setGameState('error');
      }
    };

    void fetchPuzzle();
  }, []);

  const resetControls = () => {
    setHue(120);
    setSaturation(65);
    setBrightness(40);
  };

  const handleSubmit = async () => {
    if (!puzzleData || submitting) return;

    setSubmitting(true);
    try {
      const result = await trpc.game.submitGuess.mutate({
        roundIndex: currentRound,
        guessHex: selectedColor,
      });

      setRoundResult(result);
      setGameState('submitted');

      setTimeout(() => {
        if (result.completed) {
          setGameState('completed');
        } else {
          setCurrentRound((prev) => prev + 1);
          resetControls();
          setRoundResult(null);
          setGameState('playing');
        }
      }, 2000);
    } catch (error) {
      console.error('Submission error:', error);
      void showToast({
        text: 'Error submitting guess. Try again!',
        appearance: 'neutral',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (gameState === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-900">
        <p className="text-gray-600 dark:text-gray-400">Loading puzzle...</p>
      </div>
    );
  }

  if (gameState === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white dark:bg-gray-900 p-4">
        <p className="text-red-600">Failed to load game. Please refresh.</p>
      </div>
    );
  }

  if (gameState === 'completed' && puzzleData) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-white dark:bg-gray-900 p-4">
        <div className="text-center">
          <h1 className="mb-2 text-4xl font-bold text-gray-900 dark:text-white">🎉 Complete!</h1>
          <p className="mb-6 text-2xl font-semibold text-orange-600 dark:text-orange-400">
            Final Score: {puzzleData.totalScore}/100
          </p>
          <p className="text-gray-600 dark:text-gray-400">Come back tomorrow for a new puzzle!</p>
        </div>
      </div>
    );
  }

  if (!puzzleData) {
    return <div />;
  }

  const colorName = puzzleData.colors[currentRound]?.name;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 pb-6">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex flex-col gap-1">
            <p className="text-xs uppercase tracking-[0.24em] text-gray-500 dark:text-gray-400">
              Round {currentRound + 1} of {puzzleData.totalRounds}
            </p>
            <p className="text-xl font-semibold text-gray-900 dark:text-white">Score: {puzzleData.totalScore}/100</p>
          </div>
          <div className="rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            {currentRound}/{puzzleData.totalRounds}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-6">
        <div className="rounded-[28px] border border-gray-200 bg-gray-50 p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950">
          <div className="mb-4 flex flex-col items-center gap-4 text-center">
            <div className="flex h-24 w-24 items-center justify-center rounded-full border border-gray-200 shadow-sm dark:border-gray-700" style={{ backgroundColor: selectedColor }} />
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Guess the color</p>
              <h2 className="text-4xl font-black" style={{ color: selectedColor }}>
                {colorName}
              </h2>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-gray-200 bg-white p-4 text-center dark:border-gray-800 dark:bg-gray-900">
              <p className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Hue</p>
              <div className="flex h-40 items-center justify-center">
                <input
                  type="range"
                  min="0"
                  max="360"
                  value={hue}
                  onChange={(event) => setHue(Number(event.target.value))}
                  className="h-40 w-10 -rotate-90 appearance-none accent-orange-600"
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{hue}°</p>
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-4 text-center dark:border-gray-800 dark:bg-gray-900">
              <p className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Saturation</p>
              <div className="flex h-40 items-center justify-center">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={saturation}
                  onChange={(event) => setSaturation(Number(event.target.value))}
                  className="h-40 w-10 -rotate-90 appearance-none accent-orange-600"
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{saturation}%</p>
            </div>

            <div className="rounded-3xl border border-gray-200 bg-white p-4 text-center dark:border-gray-800 dark:bg-gray-900">
              <p className="mb-3 text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">Brightness</p>
              <div className="flex h-40 items-center justify-center">
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={brightness}
                  onChange={(event) => setBrightness(Number(event.target.value))}
                  className="h-40 w-10 -rotate-90 appearance-none accent-orange-600"
                />
              </div>
              <p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-300">{brightness}%</p>
            </div>
          </div>
        </div>

        {roundResult && gameState === 'submitted' && (
          <div className="rounded-3xl border border-green-200 bg-green-50 p-5 dark:border-green-900 dark:bg-green-900/20">
            <p className="mb-3 text-center text-sm font-semibold uppercase tracking-[0.16em] text-green-700 dark:text-green-400">
              Round Complete!
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:justify-around">
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">Your Guess</p>
                <div className="h-16 w-16 rounded-xl border border-gray-300 dark:border-gray-600" style={{ backgroundColor: selectedColor }} />
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-green-600 dark:text-green-400">{roundResult.score}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">points</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">Actual</p>
                <div className="h-16 w-16 rounded-xl border border-gray-300 dark:border-gray-600" style={{ backgroundColor: roundResult.actualHex }} />
              </div>
            </div>
            <p className="mt-4 text-center text-sm font-semibold text-gray-900 dark:text-white">
              {roundResult.actualName}
            </p>
          </div>
        )}

        <button
          onClick={handleSubmit}
          disabled={submitting}
          className="w-full rounded-full bg-orange-600 px-6 py-3 text-lg font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-50 dark:bg-orange-600 dark:hover:bg-orange-700"
        >
          {submitting ? 'Submitting...' : 'Submit'}
        </button>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

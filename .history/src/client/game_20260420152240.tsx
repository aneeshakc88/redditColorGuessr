import './index.css';

import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import { trpc } from './trpc';
import { ColorWheel } from './components/ColorWheel';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';

type RouterOutputs = inferRouterOutputs<AppRouter>;

type GameState =
  | 'loading'
  | 'playing'
  | 'submitted'
  | 'completed'
  | 'error';

export const App = () => {
  const [gameState, setGameState] = useState<GameState>('loading');
  const [puzzleData, setPuzzleData] = useState<RouterOutputs['game']['getPuzzle'] | null>(null);
  const [currentRound, setCurrentRound] = useState(0);
  const [selectedColor, setSelectedColor] = useState<string>('#FF0000');
  const [submitting, setSubmitting] = useState(false);
  const [roundResult, setRoundResult] = useState<any>(null);

  // Fetch puzzle on mount
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

      // Auto-advance after 2 seconds
      setTimeout(() => {
        if (result.completed) {
          setGameState('completed');
        } else {
          setCurrentRound((prev) => prev + 1);
          setSelectedColor('#FF0000');
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
          <p className="text-gray-600 dark:text-gray-400">
            Come back tomorrow for a new puzzle!
          </p>
        </div>
      </div>
    );
  }

  if (!puzzleData) {
    return <div />;
  }

  const colorName = puzzleData.colors[currentRound]?.name;

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 pb-8">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-4">
          <div className="flex flex-col">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Round {currentRound + 1} of {puzzleData.totalRounds}
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              Score: {puzzleData.totalScore}/100
            </p>
          </div>
          <div className="flex h-8 w-16 items-center justify-center rounded-full bg-orange-100 dark:bg-orange-900/30">
            <p className="text-sm font-semibold text-orange-700 dark:text-orange-400">
              {currentRound}/{puzzleData.totalRounds}
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto flex max-w-lg flex-col items-center gap-8 px-4 py-8">
        {/* Color Name Display */}
        <div className="text-center">
          <p className="mb-4 text-sm font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            Guess the color
          </p>
          <h2 className="text-5xl font-black text-gray-900 dark:text-white">{colorName}</h2>
        </div>

        {/* Result Display */}
        {roundResult && gameState === 'submitted' && (
          <div className="w-full rounded-xl border-2 border-green-300 bg-green-50 p-6 dark:border-green-900 dark:bg-green-900/20">
            <div className="mb-3 text-center">
              <p className="text-sm font-semibold uppercase text-green-700 dark:text-green-400">
                Round Complete!
              </p>
            </div>
            <div className="flex items-center justify-around">
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">Your Guess</p>
                <div
                  className="h-16 w-16 rounded-lg border-2 border-gray-300 dark:border-gray-600"
                  style={{ backgroundColor: selectedColor }}
                />
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-green-600 dark:text-green-400">{roundResult.score}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">points</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">Actual</p>
                <div
                  className="h-16 w-16 rounded-lg border-2 border-gray-300 dark:border-gray-600"
                  style={{ backgroundColor: roundResult.actualHex }}
                />
              </div>
            </div>
            <p className="mt-4 text-center text-sm font-semibold text-gray-900 dark:text-white">
              {roundResult.actualName}
            </p>
          </div>
        )}

        {/* Color Wheel (only show when playing) */}
        {gameState === 'playing' && (
          <>
            <ColorWheel onColorSelected={setSelectedColor} selectedColor={selectedColor} />

            {/* Submit Button */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full max-w-xs rounded-full bg-orange-600 px-8 py-3 text-lg font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-50 dark:bg-orange-600 dark:hover:bg-orange-700"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
          {username ? `Hey ${username} 👋` : ''}
        </h1>
        <p className="text-center text-base text-gray-600 dark:text-gray-300">
          Edit{' '}
          <span className="rounded bg-[#e5ebee] px-1 py-0.5 dark:bg-gray-700">
            src/client/game.tsx
          </span>{' '}
          to get started.
        </p>
      </div>
      <div className="mt-5 flex items-center justify-center">
        <button
          className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-[#d93900] font-mono text-[2.5em] leading-none text-white transition-colors hover:bg-[#c23300] dark:bg-orange-600 dark:hover:bg-orange-700"
          onClick={decrement}
          disabled={loading}
        >
          -
        </button>
        <span className="mx-5 min-w-[50px] text-center text-[1.8em] leading-none font-medium text-gray-900 dark:text-white">
          {loading ? '...' : count}
        </span>
        <button
          className="flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-[#d93900] font-mono text-[2.5em] leading-none text-white transition-colors hover:bg-[#c23300] dark:bg-orange-600 dark:hover:bg-orange-700"
          onClick={increment}
          disabled={loading}
        >
          +
        </button>
      </div>
      <footer className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-3 text-[0.8em] text-gray-600 dark:text-gray-400">
        <button
          className="cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Docs
        </button>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <button
          className="cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
        >
          r/Devvit
        </button>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <button
          className="cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors"
          onClick={() => navigateTo('https://discord.com/invite/R7yu2wh9Qz')}
        >
          Discord
        </button>
      </footer>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

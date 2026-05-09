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
  const [selectedColor, setSelectedColor] = useState<string>('#228B22');
  const [submitting, setSubmitting] = useState(false);
  const [roundResult, setRoundResult] = useState<any>(null);

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

      setTimeout(() => {
        if (result.completed) {
          setGameState('completed');
        } else {
          setCurrentRound((prev) => prev + 1);
          setSelectedColor('#228B22');
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
    <div className="min-h-screen bg-white dark:bg-gray-900 pb-4">
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 dark:border-gray-800 dark:bg-gray-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-2">
          <div className="flex flex-col">
            <p className="text-xs uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
              Round {currentRound + 1} of {puzzleData.totalRounds}
            </p>
            <p className="text-base font-semibold text-gray-900 dark:text-white">Score: {puzzleData.totalScore}/100</p>
          </div>
          <div className="rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            {currentRound}/{puzzleData.totalRounds}
          </div>
        </div>
      </div>

      <div className="mx-auto flex max-w-lg flex-col items-center gap-5 px-4 py-5">
        <div className="text-center">
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Guess the color</p>
          <h2 className="text-4xl font-black text-gray-900 dark:text-white">{colorName}</h2>
        </div>

        {roundResult && gameState === 'submitted' && (
          <div className="w-full rounded-2xl border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-900/20">
            <p className="mb-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-green-700 dark:text-green-400">
              Round Complete!
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-around">
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">Your Guess</p>
                <div className="h-14 w-14 rounded-lg border border-gray-300 dark:border-gray-600" style={{ backgroundColor: selectedColor }} />
              </div>
              <div className="text-center">
                <p className="text-3xl font-black text-green-600 dark:text-green-400">{roundResult.score}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400">points</p>
              </div>
              <div className="flex flex-col items-center gap-2">
                <p className="text-xs text-gray-600 dark:text-gray-400">Actual</p>
                <div className="h-14 w-14 rounded-lg border border-gray-300 dark:border-gray-600" style={{ backgroundColor: roundResult.actualHex }} />
              </div>
            </div>
            <p className="mt-3 text-center text-sm font-semibold text-gray-900 dark:text-white">
              {roundResult.actualName}
            </p>
          </div>
        )}

        {gameState === 'playing' && (
          <>
            <ColorWheel onColorSelected={setSelectedColor} selectedColor={selectedColor} />

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded-full bg-orange-600 px-6 py-3 text-lg font-bold text-white transition-all hover:bg-orange-700 active:scale-95 disabled:opacity-50 dark:bg-orange-600 dark:hover:bg-orange-700"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

import './index.css';

import { navigateTo, requestExpandedMode, context } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-white dark:bg-gray-900 px-4">
      {/* Logo/Title */}
      <div className="text-center">
        <div className="mb-4 inline-block rounded-full bg-orange-100 p-4 dark:bg-orange-900/30">
          <div className="text-5xl">🎨</div>
        </div>
        <h1 className="mb-2 text-4xl font-black text-gray-900 dark:text-white">Color Guessr</h1>
        <p className="mb-2 text-lg text-gray-600 dark:text-gray-300">Guess the color every day</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">Max score: 100 points • 5 colors per puzzle</p>
      </div>

      {/* Game Preview/Info */}
      <div className="flex w-full max-w-sm gap-4 rounded-xl bg-gray-50 p-6 dark:bg-gray-800/50">
        <div className="flex flex-1 flex-col items-center gap-2">
          <div className="text-2xl">🎯</div>
          <p className="text-center text-xs font-semibold text-gray-600 dark:text-gray-400">See a color name</p>
        </div>
        <div className="flex flex-1 flex-col items-center gap-2">
          <div className="text-2xl">🌈</div>
          <p className="text-center text-xs font-semibold text-gray-600 dark:text-gray-400">Pick the right shade</p>
        </div>
        <div className="flex flex-1 flex-col items-center gap-2">
          <div className="text-2xl">⭐</div>
          <p className="text-center text-xs font-semibold text-gray-600 dark:text-gray-400">Earn up to 20 points</p>
        </div>
      </div>

      {/* Play Button */}
      <button
        className="flex h-14 w-full max-w-sm cursor-pointer items-center justify-center rounded-full bg-orange-600 text-lg font-bold text-white transition-all hover:bg-orange-700 active:scale-95 dark:bg-orange-600 dark:hover:bg-orange-700"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
      >
        Play Now
      </button>

      {/* Greeting */}
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Welcome, {context.username ?? 'friend'} 👋
      </p>

      {/* Footer */}
      <footer className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-3 text-[0.8em] text-gray-600 dark:text-gray-400">
        <button
          className="cursor-pointer transition-colors hover:text-gray-900 dark:hover:text-white"
          onClick={() => navigateTo('https://developers.reddit.com/docs')}
        >
          Docs
        </button>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <button
          className="cursor-pointer transition-colors hover:text-gray-900 dark:hover:text-white"
          onClick={() => navigateTo('https://www.reddit.com/r/Devvit')}
        >
          r/Devvit
        </button>
        <span className="text-gray-300 dark:text-gray-600">|</span>
        <button
          className="cursor-pointer transition-colors hover:text-gray-900 dark:hover:text-white"
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
    <Splash />
  </StrictMode>
);

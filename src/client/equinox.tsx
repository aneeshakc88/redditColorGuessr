import './index.css';

import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { EquinoxGame } from './equinox-game';
import { EquinoxScoreboard } from './equinox-scoreboard';

export const Equinox = () => {
  const [showLb, setShowLb] = useState(false);
  return (
    <div style={{ position: 'relative', height: '100dvh', overflow: 'hidden', background: '#08080a' }}>
      <EquinoxGame onLeaderboard={() => setShowLb(true)} />
      {showLb && <EquinoxScoreboard onClose={() => setShowLb(false)} overlay />}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Equinox />
  </StrictMode>
);

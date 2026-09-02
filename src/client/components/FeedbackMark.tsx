// Crack the Code feedback marks. Achromatic on purpose: all 18 guessable
// colors are saturated hues, so any tinted peg collides with a swatch a
// player can pick. Fill amount carries the meaning instead.
export const MARK_EXACT = '#e8dcc4';
export const MARK_COLOR = '#8b9bad';

// `color` overrides the ink — used where a slate half-mark would sink into
// nearby prose, and for the win state. Fill amount still carries the meaning,
// so the two marks stay legible even when they share an ink.
export const Mark = ({ size, kind, color, glow }: { size: number; kind: 'exact' | 'color'; color?: string; glow?: boolean }) => {
  const ink = color ?? (kind === 'exact' ? MARK_EXACT : MARK_COLOR);
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
      ...(kind === 'exact'
        ? {
            background: ink,
            boxShadow: glow ? `0 0 8px ${ink}80` : 'inset 0 0 0 1px rgba(14,20,29,0.35)',
          }
        : {
            background: `linear-gradient(90deg, ${ink} 0 50%, transparent 50% 100%)`,
            boxShadow: `inset 0 0 0 ${Math.max(1, Math.round(size * 0.13))}px ${ink}`,
          }),
    }} />
  );
};

export const PP_MIN_ROUNDS = 1;
export const PP_MAX_ROUNDS = 5;
export const PP_TOTAL_SCORE = 100;

// Distributes 100 points across roundCount rounds so a perfect run always
// sums to exactly 100 — remainder points go to the earliest rounds.
export function ppRoundMax(roundCount: number, roundIndex: number): number {
  const base = Math.floor(PP_TOTAL_SCORE / roundCount);
  const remainder = PP_TOTAL_SCORE % roundCount;
  return base + (roundIndex < remainder ? 1 : 0);
}

// 0..1 how good a round's score was, independent of its point cap — lets
// color/emoji/message buckets scale with round count instead of assuming /20.
export function ppScoreFrac(score: number, max: number): number {
  return max > 0 ? score / max : 0;
}

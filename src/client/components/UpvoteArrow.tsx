// Reddit's upvote arrow, drawn hollow on purpose. A webview can't cast a vote —
// tapping opens the comment — so the filled state, which on Reddit means "you
// voted", would be a promise this app can't keep.
export const UpvoteArrow = ({ size = 12, color = 'currentColor' }: { size?: number; color?: string }) => (
  <svg viewBox="0 0 20 20" width={size} height={size} fill="none" stroke={color}
    strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"
    style={{ display: 'block', flexShrink: 0 }}>
    <path d="M10 3.2 17 10.4h-3.7v5.9H6.7v-5.9H3z" />
  </svg>
);

/** Arrow + count, the way a comment's score reads. */
export const VoteCount = ({ votes, size = 12, color = 'currentColor', gap = 3 }: {
  votes: number; size?: number; color?: string; gap?: number;
}) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap, color }}>
    <UpvoteArrow size={size} color={color} />
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{votes}</span>
  </span>
);

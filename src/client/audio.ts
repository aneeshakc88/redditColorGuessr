// Single shared AudioContext, unlocked on the first touch gesture.
// iOS WKWebView (Reddit app) won't play sound during a drag unless the context
// is already 'running' when the first tick fires. resume() is async, so we:
//   1. unlock on touchstart/pointerdown (capture) — earliest point of the gesture
//   2. play a silent buffer + start a 0-gain keep-alive oscillator, which forces
//      the context to 'running' and stops iOS from re-suspending it between drags.

let ctx: AudioContext | null = null;
let keepAlive: OscillatorNode | null = null;

function create(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch { return null; }
  return ctx;
}

export function unlock(): void {
  const c = create();
  if (!c) return;
  if (c.state === 'suspended') void c.resume();
  try {
    // Silent 1-frame buffer — the gesture-bound trigger iOS needs to go running.
    const src = c.createBufferSource();
    src.buffer = c.createBuffer(1, 1, 22050);
    src.connect(c.destination);
    src.start(0);
    // Persistent inaudible oscillator — keeps the context awake so later ticks
    // are instant and iOS never drops it back to suspended.
    if (!keepAlive) {
      const osc = c.createOscillator();
      const g = c.createGain();
      g.gain.value = 0;
      osc.connect(g);
      g.connect(c.destination);
      osc.start();
      keepAlive = osc;
    }
  } catch { /* ignore */ }
}

let attached = false;
function attach(): void {
  if (attached || typeof window === 'undefined') return;
  attached = true;
  // capture so we run before React's own pointer handlers fire the first tick
  const opts = { passive: true, capture: true } as const;
  window.addEventListener('touchstart', unlock, opts);
  window.addEventListener('pointerdown', unlock, opts);
  window.addEventListener('touchend', unlock, opts);
  window.addEventListener('mousedown', unlock, opts);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ctx && ctx.state === 'suspended') void ctx.resume();
  });
}
attach();

// Returns the shared context, nudging it back to running if needed.
export function audioCtx(): AudioContext | null {
  const c = create();
  if (!c) return null;
  if (c.state === 'suspended') void c.resume();
  return c;
}

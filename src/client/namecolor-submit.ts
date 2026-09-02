import { trpc } from './trpc';
import { checkName } from '../shared/namecolor-core';

// Names are typed inline — on the feed splash itself, the way r/blanks does it.
// Tap the pill, a caret appears in the card, publish. No native form modal and
// no expanded view between the player and a one-word answer.

export type SubmitOutcome =
  | { kind: 'ok'; name: string; url: string }
  | { kind: 'message'; message: string };

export async function submitName(raw: string): Promise<SubmitOutcome> {
  // Pre-flight only — the server runs this same check before anything posts.
  const local = checkName(raw);
  if (!local.ok) return { kind: 'message', message: local.reason };

  try {
    const r = await trpc.namecolor.submitName.mutate({ name: local.name });
    if (r.status === 'ok') return { kind: 'ok', name: r.name, url: r.url };
    return { kind: 'message', message: r.message };
  } catch (e) {
    console.error('[namecolor] submit failed:', e);
    return { kind: 'message', message: 'Could not reach Reddit. Try again in a moment.' };
  }
}

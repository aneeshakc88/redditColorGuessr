// "Name This Color" — shared rules for the free-text names players submit.
// Validation lives here so the client can pre-flight it, but the server runs
// the exact same check before anything is turned into a public comment.

export const NAMECOLOR_CONFIG = {
  maxNameLen: 24,
  // A color is never closed: names and votes are taken forever. What ends is the
  // app's talking — one standings comment a day for the first few days, then the
  // thread is left alone. After that the board still moves, it just moves in the
  // app and the comments instead of in an announcement.
  roundHours: 24,
  recapDays: 4,
  // How many names the cross-post Hall of Fame keeps. It's a live snapshot of
  // the best-scoring names right now, so it only needs the head of the list.
  hallSize: 300,
  // Floor between on-demand vote sweeps, so a refresh-mashing viewer can't
  // turn one post into a comment-listing firehose.
  sweepMinIntervalMs: 60_000,
  // How many comments one sweep pulls. A post that exceeds this is truncated,
  // and a truncated listing is never treated as evidence a name is gone.
  commentFetchLimit: 1000,
  // How long a name is presumed alive before a sweep is allowed to conclude its
  // comment was deleted. Reddit's listing lags its own writes, so a name posted
  // seconds ago is routinely missing from the very next fetch.
  deleteGraceMs: 10 * 60_000,
  // Most names a single sweep may forget. Real deletions trickle in ones and
  // twos; a whole board going missing at once is a bad fetch, not fifty people
  // deleting in the same minute. Capping the bite means a bad listing can never
  // wipe a post, and names that really are gone still clear over a few sweeps.
  maxDeletesPerSweep: 10,
} as const;

// Anything printable: letters in any script, marks, digits, punctuation,
// symbols and emoji, joined by single spaces. What's excluded is what can't be
// seen — control characters, zero-width padding, bidi overrides — since those
// only exist to smuggle something past the filters below. ZWJ is the one
// exception, because compound emoji are built out of it.
const NAME_SHAPE = /^[\p{L}\p{M}\p{N}\p{P}\p{S} ‍]+$/u;

// A name with nothing but punctuation in it ("!!!", "~~~") isn't an answer.
// An emoji on its own is — "💙" is a real answer to what colour this is.
const HAS_SUBSTANCE = /[\p{L}\p{N}\p{Extended_Pictographic}]/u;

// Links and username/subreddit mentions are posted as real comments, so they'd
// be live spam and live pings. Everything else about the name is left alone.
const LINKY = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|net|org|io|gg|co|uk|ru|xyz|link|info|me|tv|app)\b|(?:^|[^a-z0-9])\/?[ur]\/[a-z0-9_-])/i;

// Spelling variants are deliberately NOT collapsed — "Blue" and "blu" are two
// different answers and voters can pick between them. This is only used to
// defeat separator-padded slurs below; diacritics are stripped first so "rétard"
// can't walk through the gate that "retard" can't.
const lettersOnly = (raw: string): string =>
  raw.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z]/g, '');

/** Reddit renders comments as markdown, and a name is free text now — so
 *  everything markdown would eat is escaped at the point it's printed. */
export const mdEscape = (s: string): string => s.replace(/([\\`*_~[\]()#>|^{}!+-])/g, '\\$1');

// Matched against the letters-only name, so spacing a slur out doesn't sneak
// it through.
const BLOCKED_SUBSTRINGS = [
  'nigg', 'niger', 'faggot', 'fagot', 'kike', 'spic', 'chink', 'gook', 'tranny',
  'retard', 'wetback', 'coon', 'raghead', 'towelhead', 'beaner', 'zipperhead',
  'goatfuck', 'childporn', 'rapist', 'pedo',
];

// Matched whole-word against the spaced name — these are short enough to eat
// innocent names ("cocktail", "Scunthorpe", "assam") as substrings.
const BLOCKED_WORDS = [
  'fuck', 'fucking', 'shit', 'cunt', 'cock', 'dick', 'ass', 'arse', 'bitch',
  'whore', 'slut', 'tits', 'titties', 'penis', 'vagina', 'cum', 'jizz',
  'anal', 'anus', 'rape', 'nazi', 'hitler', 'porn', 'wank', 'twat',
];

export type NameCheck =
  | { ok: true; name: string }
  | { ok: false; reason: string };

/** Clean + validate a submitted name. `name` is exactly what gets posted. */
export function checkName(raw: string): NameCheck {
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, reason: 'Type a name first.' };
  // Counted in code points, so an emoji costs one character and not two.
  if ([...name].length > NAMECOLOR_CONFIG.maxNameLen) {
    return { ok: false, reason: `Keep it to ${NAMECOLOR_CONFIG.maxNameLen} characters or less.` };
  }
  if (!NAME_SHAPE.test(name)) {
    return { ok: false, reason: 'No control or invisible characters.' };
  }
  if (!HAS_SUBSTANCE.test(name)) {
    return { ok: false, reason: 'Needs at least one letter, number or emoji.' };
  }
  if (LINKY.test(name)) {
    return { ok: false, reason: 'No links or u/ and r/ mentions — just the name.' };
  }

  const letters = lettersOnly(name);
  if (BLOCKED_SUBSTRINGS.some(b => letters.includes(b))) {
    return { ok: false, reason: "That one won't fly. Try another." };
  }
  const words = name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.some(w => BLOCKED_WORDS.includes(w))) {
    return { ok: false, reason: "That one won't fly. Try another." };
  }

  return { ok: true, name };
}

/** Time until the next 24h checkpoint, which either posts standings or settles
 *  the color. Rolls, so it always counts down to the *next* one. */
export const msToNextRound = (createdAt: number, now = Date.now()): number => {
  const roundMs = NAMECOLOR_CONFIG.roundHours * 3600 * 1000;
  return roundMs - (Math.max(0, now - createdAt) % roundMs);
};

export const roundCountdown = (createdAt: number, now = Date.now()): string => {
  const ms = msToNextRound(createdAt, now);
  const h = Math.floor(ms / 3600000);
  return h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60000))}m`;
};

/** Past the recap window the app stops posting — the board itself stays open. */
export const recapsDone = (createdAt: number, now = Date.now()): boolean =>
  Math.floor((now - createdAt) / (NAMECOLOR_CONFIG.roundHours * 3600 * 1000)) >= NAMECOLOR_CONFIG.recapDays;

export const recapLine = (createdAt: number, now = Date.now()): string =>
  recapsDone(createdAt, now) ? 'still open — names always count' : `standings in ${roundCountdown(createdAt, now)}`;

export const isHex = (hex: string): boolean => /^#[0-9A-Fa-f]{6}$/.test(hex);

/** Fully random — the color does not need to be pretty or nameable, that's the game. */
export const randomHex = (): string =>
  '#' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0').toUpperCase();

/** Reddit hands back a path; navigateTo wants something it can actually open. */
export const commentUrl = (permalink: string): string =>
  permalink.startsWith('http') ? permalink : `https://www.reddit.com${permalink}`;

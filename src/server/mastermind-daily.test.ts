import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Same in-memory Redis + stub reddit harness as wire-creators.test.ts, so what's
// under test is the shipped tRPC path rather than a re-implementation of it.
const mocks = vi.hoisted(() => {
  type ZEntry = { member: string; score: number };
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();

  const z = (key: string) => {
    let m = zsets.get(key);
    if (!m) { m = new Map(); zsets.set(key, m); }
    return m;
  };
  const h = (key: string) => {
    let m = hashes.get(key);
    if (!m) { m = new Map(); hashes.set(key, m); }
    return m;
  };
  const sorted = (key: string): ZEntry[] =>
    [...z(key).entries()]
      .map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));

  // Records which keys were written with a TTL, so "kept forever" is testable.
  const ttls = new Map<string, Date>();

  const redis = {
    get: async (k: string) => strings.get(k),
    set: async (k: string, v: string, opts?: { expiration?: Date }) => {
      strings.set(k, v);
      if (opts?.expiration) ttls.set(k, opts.expiration); else ttls.delete(k);
      return 'OK';
    },
    del: async (...ks: string[]) => { ks.forEach(k => strings.delete(k)); },
    exists: async (k: string) => (strings.has(k) ? 1 : 0),
    incrBy: async (k: string, n: number) => {
      const v = Number(strings.get(k) ?? 0) + n;
      strings.set(k, String(v));
      return v;
    },
    expire: async (k: string, secs: number) => { ttls.set(k, new Date(Date.now() + secs * 1000)); },
    zAdd: async (k: string, ...entries: ZEntry[]) => {
      let added = 0;
      for (const e of entries) { if (!z(k).has(e.member)) added++; z(k).set(e.member, e.score); }
      return added;
    },
    zScore: async (k: string, m: string) => z(k).get(m),
    zCard: async (k: string) => z(k).size,
    zIncrBy: async (k: string, m: string, n: number) => {
      const v = (z(k).get(m) ?? 0) + n;
      z(k).set(m, v);
      return v;
    },
    zRem: async (k: string, ms: string[]) => { ms.forEach(m => z(k).delete(m)); },
    zRange: async (k: string, start: number, stop: number, opts?: { by?: string; reverse?: boolean }) => {
      const all = sorted(k);
      if (opts?.by === 'score') return all.filter(e => e.score >= start && e.score <= stop);
      const list = opts?.reverse ? [...all].reverse() : all;
      const end = stop < 0 ? list.length + stop : stop;
      return list.slice(Math.max(0, start), end + 1);
    },
    zRank: async (k: string, m: string) => {
      const i = sorted(k).findIndex(e => e.member === m);
      return i < 0 ? undefined : i;
    },
    hGet: async (k: string, f: string) => h(k).get(f),
    hGetAll: async (k: string) => Object.fromEntries(h(k).entries()),
    hSet: async (k: string, obj: Record<string, string>) => {
      for (const [f, v] of Object.entries(obj)) h(k).set(f, v);
      return Object.keys(obj).length;
    },
    hDel: async (k: string, fs: string[]) => { fs.forEach(f => h(k).delete(f)); },
    hIncrBy: async (k: string, f: string, n: number) => {
      const v = Number(h(k).get(f) ?? 0) + n;
      h(k).set(f, String(v));
      return v;
    },
  };

  let postSeq = 0;
  // Posts created before the snapshot existed are the interesting case, so the
  // stub records a creation time the backfill can read back.
  const createdAt = new Map<string, Date>();
  const reddit = {
    submitCustomPost: async () => {
      const id = `t3_mm${++postSeq}`;
      createdAt.set(id.slice(3), new Date());
      return { id };
    },
    getPostById: async (id: string) => {
      const raw = id.startsWith('t3_') ? id.slice(3) : id;
      const at = createdAt.get(raw);
      if (!at) throw new Error('not found');
      return { id, createdAt: at };
    },
    submitComment: async () => ({ id: 't1_c1', distinguish: async () => {} }),
    getSnoovatarUrl: async () => undefined,
    getModerators: () => ({ all: async () => [] }),
    getUserByUsername: async () => undefined,
  };

  const context: Record<string, unknown> = {
    postId: undefined, username: undefined, subredditName: 'testsub', snoovatar: undefined,
  };

  const reset = () => {
    strings.clear(); zsets.clear(); hashes.clear(); ttls.clear(); postSeq = 0; createdAt.clear();
    context.postId = undefined; context.username = undefined;
  };

  return { redis, reddit, context, reset, zsets, strings, createdAt, ttls };
});

vi.mock('@devvit/web/server', () => ({
  redis: mocks.redis,
  reddit: mocks.reddit,
  context: mocks.context,
  settings: { get: async () => undefined },
}));

const { appRouter } = await import('./trpc');
const { createMastermindPost } = await import('./core/post');
const { getDailyMastermind } = await import('../shared/mastermind-core');

const caller = appRouter.createCaller({});

const asUser = (username: string | undefined, postId?: string) => {
  mocks.context.username = username;
  mocks.context.postId = postId;
};

const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T12:00:00Z`));

beforeEach(() => { mocks.reset(); vi.useFakeTimers(); });
afterEach(() => vi.useRealTimers());

describe('daily code generation', () => {
  it('gives the four reported dates four different codes', () => {
    const codes = ['2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11']
      .map(d => getDailyMastermind(d).secret.join(','));
    expect(new Set(codes).size).toBe(4);
  });

  it('never repeats a code within any 60-day span', () => {
    const codes: string[] = [];
    for (let i = 0; i < 400; i++) {
      const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().split('T')[0]!;
      codes.push(getDailyMastermind(d).secret.join(','));
    }
    for (let i = 0; i < codes.length; i++) {
      const window = codes.slice(i, i + 60);
      expect(new Set(window).size, `repeat within 60 days of index ${i}`).toBe(window.length);
    }
  });

  it('draws a 7-colour pool and a 5-slot code drawn from it', () => {
    const { poolColors, secret } = getDailyMastermind('2026-08-08');
    expect(poolColors).toHaveLength(7);
    expect(new Set(poolColors.map(c => c.hex)).size).toBe(7);
    expect(secret).toHaveLength(5);
    expect(secret.every(h => poolColors.some(c => c.hex === h))).toBe(true);
  });
});

describe('a daily post is frozen to its own date', () => {
  it('snapshots the code at creation', async () => {
    at('2026-08-08');
    asUser('mod');
    await createMastermindPost();

    expect(await mocks.redis.get('mastermind:date:mm1')).toBe('2026-08-08');
    const snap = JSON.parse((await mocks.redis.get('mastermind:snapshot:mm1'))!) as { secret: string[] };
    expect(snap.secret).toEqual(getDailyMastermind('2026-08-08').secret);
  });

  it('keeps serving its own pool days later', async () => {
    at('2026-08-08');
    asUser('mod');
    await createMastermindPost();

    at('2026-08-20');
    asUser('player', 't3_mm1');
    const state = await caller.mastermind.getPuzzle();
    expect(state.poolColors).toEqual(getDailyMastermind('2026-08-08').poolColors);
  });

  it("rejects a later day's code and still accepts its own", async () => {
    at('2026-08-08');
    asUser('mod');
    await createMastermindPost();
    const own = getDailyMastermind('2026-08-08').secret;
    const later = getDailyMastermind('2026-08-20').secret;
    expect(later).not.toEqual(own);

    at('2026-08-20');
    asUser('player', 't3_mm1');
    const wrong = await caller.mastermind.submitGuess({ colors: later });
    expect(wrong.won).toBe(false);

    const right = await caller.mastermind.submitGuess({ colors: own });
    expect(right.won).toBe(true);
    expect(right.secret).toEqual(own);
  });

  it('shows a finished puzzle the code it was actually played with', async () => {
    at('2026-08-08');
    asUser('mod');
    await createMastermindPost();
    const own = getDailyMastermind('2026-08-08').secret;

    asUser('player', 't3_mm1');
    await caller.mastermind.submitGuess({ colors: own });

    at('2026-08-20');
    const state = await caller.mastermind.getPuzzle();
    expect(state.completed).toBe(true);
    expect(state.secret).toEqual(own);
  });

  it('keeps the result, scoreboard and histogram forever', async () => {
    at('2026-08-08');
    asUser('mod');
    await createMastermindPost();

    asUser('player', 't3_mm1');
    await caller.mastermind.submitGuess({ colors: getDailyMastermind('2026-08-08').secret });

    for (const key of [
      'mastermind:progress:mm1:player',
      'mastermind:snapshot:mm1',
      'mastermind:date:mm1',
      'mastermind:lb:daily:2026-08-08',
      'mastermind:dist:mm1',
    ]) {
      expect(mocks.ttls.get(key), `${key} should not expire`).toBeUndefined();
    }
  });

  it('scores an archived post into that date, not today', async () => {
    at('2026-08-08');
    asUser('mod');
    await createMastermindPost();

    at('2026-08-20');
    asUser('player', 't3_mm1');
    await caller.mastermind.submitGuess({ colors: getDailyMastermind('2026-08-08').secret });

    expect(await mocks.redis.zScore('mastermind:lb:daily:2026-08-08', 'player')).toBe(15);
    expect(mocks.zsets.get('mastermind:lb:daily:2026-08-20')).toBeUndefined();
  });
});

describe('posts made before snapshots existed', () => {
  const seedLegacy = (rawPostId: string, created: string) => {
    mocks.strings.set(`color-guesser:post-type:${rawPostId}`, 'mastermind-daily');
    mocks.createdAt.set(rawPostId, new Date(`${created}T12:00:00Z`));
  };

  it('backfills from the real creation date on first open', async () => {
    seedLegacy('old1', '2026-08-09');
    at('2026-08-20');
    asUser('player', 't3_old1');

    const state = await caller.mastermind.getPuzzle();
    expect(await mocks.redis.get('mastermind:date:old1')).toBe('2026-08-09');
    expect(state.poolColors).toEqual(getDailyMastermind('2026-08-09').poolColors);
  });

  it('stays put once backfilled', async () => {
    seedLegacy('old2', '2026-08-09');
    at('2026-08-20');
    asUser('player', 't3_old2');
    const first = await caller.mastermind.getPuzzle();

    at('2026-09-15');
    const later = await caller.mastermind.getPuzzle();
    expect(later.poolColors).toEqual(first.poolColors);
    expect(await mocks.redis.get('mastermind:date:old2')).toBe('2026-08-09');
  });

  it('falls back to today when the post lookup fails', async () => {
    mocks.strings.set('color-guesser:post-type:gone', 'mastermind-daily');
    at('2026-08-20');
    asUser('player', 't3_gone');

    const state = await caller.mastermind.getPuzzle();
    expect(await mocks.redis.get('mastermind:date:gone')).toBe('2026-08-20');
    expect(state.poolColors).toEqual(getDailyMastermind('2026-08-20').poolColors);
  });

  it('does not write puzzle keys for a post that is not a daily', async () => {
    mocks.strings.set('color-guesser:post-type:wire1', 'wire-custom');
    at('2026-08-20');
    asUser('player', 't3_wire1');

    const state = await caller.mastermind.getPuzzle();
    expect(state.configured).toBe(false);
    expect(await mocks.redis.get('mastermind:snapshot:wire1')).toBeUndefined();
    expect(await mocks.redis.get('mastermind:date:wire1')).toBeUndefined();

    await expect(caller.mastermind.submitGuess({ colors: getDailyMastermind('2026-08-20').secret }))
      .rejects.toThrow('Not a Mastermind post');
    expect(await mocks.redis.get('mastermind:snapshot:wire1')).toBeUndefined();
  });
});

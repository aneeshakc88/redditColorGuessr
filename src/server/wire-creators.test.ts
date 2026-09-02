import { beforeEach, describe, expect, it, vi } from 'vitest';

// The creator board is only reachable through the real tRPC procedures, so the
// Devvit server module is replaced with an in-memory Redis + a stub reddit
// client. Everything under test (aggregation, backfill, solve accounting) is the
// shipped code path, not a copy of it.
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

  const redis = {
    get: async (k: string) => strings.get(k),
    set: async (k: string, v: string) => { strings.set(k, v); return 'OK'; },
    del: async (...ks: string[]) => { ks.forEach(k => strings.delete(k)); },
    exists: async (k: string) => (strings.has(k) ? 1 : 0),
    incrBy: async (k: string, n: number) => {
      const v = Number(strings.get(k) ?? 0) + n;
      strings.set(k, String(v));
      return v;
    },
    expire: async () => {},
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

  const submitted: { title: string }[] = [];
  let postSeq = 0;
  const reddit = {
    submitCustomPost: async ({ title }: { title: string }) => {
      submitted.push({ title });
      return { id: `t3_post${++postSeq}` };
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
    strings.clear(); zsets.clear(); hashes.clear(); submitted.length = 0; postSeq = 0;
    context.postId = undefined; context.username = undefined; context.snoovatar = undefined;
  };

  return { redis, reddit, context, reset, zsets, hashes, strings, submitted };
});

vi.mock('@devvit/web/server', () => ({
  redis: mocks.redis,
  reddit: mocks.reddit,
  context: mocks.context,
  settings: { get: async () => undefined },
}));

const { appRouter } = await import('./trpc');
const { generatePuzzle, solvePuzzle } = await import('../shared/wire-core');

const caller = appRouter.createCaller({});
const DAY = 24 * 3600 * 1000;

const asUser = (username: string | undefined, postId?: string) => {
  mocks.context.username = username;
  mocks.context.postId = postId;
};

// Seed a board straight into Redis the way the *old* build left it: the puzzle
// exists, but none of the creator-tab bookkeeping does.
const seedLegacyBoard = (postId: string, creator: string, title: string, plays?: number) => {
  const p = generatePuzzle(1, 5, 5, 4);
  mocks.strings.set(`color-guesser:post-type:${postId}`, 'wire-custom');
  mocks.strings.set(`wire:custom:${postId}`, JSON.stringify({ w: p.w, h: p.h, pairs: p.pairs, creator, title }));
  if (plays != null) mocks.zsets.set('wire:board-plays', new Map([...(mocks.zsets.get('wire:board-plays') ?? []), [postId, plays]]));
};

// Seed a fully-tracked board (post-fix shape) with a chosen solver count and age.
const seedBoard = (postId: string, creator: string, title: string, plays: number, ageDays = 0) => {
  seedLegacyBoard(postId, creator, title);
  const plays0 = mocks.zsets.get('wire:board-plays') ?? new Map();
  plays0.set(postId, plays);
  mocks.zsets.set('wire:board-plays', plays0);
  const meta = mocks.hashes.get('wire:board-meta') ?? new Map();
  meta.set(postId, JSON.stringify({ c: creator, t: title, at: Date.now() - ageDays * DAY }));
  mocks.hashes.set('wire:board-meta', meta);
};

beforeEach(() => mocks.reset());

describe('creator leaderboard — aggregation', () => {
  it('returns empty tabs when no board has ever been posted', async () => {
    asUser('viewer');
    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.builders).toEqual([]);
    expect(res.engaging).toEqual([]);
    expect(res.rising).toEqual([]);
    expect(res.ranks).toEqual({ builders: null, engaging: null, rising: null });
  });

  it('Builders counts only boards at or above the 5-solver bar', async () => {
    seedBoard('b_low1', 'alice', 'Low 1', 4);
    seedBoard('b_low2', 'alice', 'Low 2', 4);
    seedBoard('b_ok', 'bob', 'Qualifies', 5);
    asUser('viewer');

    const { builders } = await caller.wire.getCreatorLeaderboard();
    expect(builders.map(e => e.member)).toEqual(['bob']);
    expect(builders[0]!.score).toBe(1);
  });

  it('Builders ranks on qualifying boards, tie-broken by total solvers', async () => {
    seedBoard('c1', 'alice', 'A1', 10);
    seedBoard('c2', 'alice', 'A2', 10);
    seedBoard('c3', 'bob', 'B1', 90);
    seedBoard('c4', 'bob', 'B2', 5);
    seedBoard('c5', 'carol', 'C1', 6);
    seedBoard('c6', 'carol', 'C2', 6);
    seedBoard('c7', 'carol', 'C3', 6);
    asUser('viewer');

    const { builders } = await caller.wire.getCreatorLeaderboard();
    // carol 3 qualifying > bob & alice at 2; bob outranks alice on total solvers.
    expect(builders.map(e => [e.member, e.score, e.plays])).toEqual([
      ['carol', 3, 18], ['bob', 2, 95], ['alice', 2, 20],
    ]);
  });

  it('Engaging ranks on the single biggest board and links to it', async () => {
    seedBoard('e1', 'alice', 'Small', 3);
    seedBoard('e2', 'alice', 'Alice big', 40);
    seedBoard('e3', 'bob', 'Bob biggest', 41);
    asUser('viewer');

    const { engaging } = await caller.wire.getCreatorLeaderboard();
    expect(engaging.map(e => [e.member, e.score, e.bestTitle])).toEqual([
      ['bob', 41, 'Bob biggest'], ['alice', 40, 'Alice big'],
    ]);
    expect(engaging[0]!.bestUrl).toBe('https://www.reddit.com/comments/e3/');
  });

  it('Engaging drops creators whose boards have zero solvers', async () => {
    seedBoard('z1', 'alice', 'Unplayed', 0);
    seedBoard('z2', 'bob', 'Played', 2);
    asUser('viewer');

    const { engaging } = await caller.wire.getCreatorLeaderboard();
    expect(engaging.map(e => e.member)).toEqual(['bob']);
  });

  it('Rising admits a brand-new creator with zero solvers', async () => {
    seedBoard('r1', 'newbie', 'First board', 0);
    asUser('viewer');

    const { rising } = await caller.wire.getCreatorLeaderboard();
    expect(rising.map(e => [e.member, e.score, e.boards])).toEqual([['newbie', 0, 1]]);
  });

  it('Rising excludes creators past the 30-day window, whatever their output', async () => {
    seedBoard('p1', 'prolific', 'P1', 5);
    seedBoard('p2', 'prolific', 'P2', 5);
    seedBoard('p3', 'prolific', 'P3', 5);
    seedBoard('o1', 'oldtimer', 'O1', 5, 31);
    seedBoard('n1', 'newbie', 'N1', 5, 29);
    asUser('viewer');

    // Board count no longer evicts: a busy newcomer is exactly the point.
    const { rising } = await caller.wire.getCreatorLeaderboard();
    expect(rising.map(e => [e.member, e.boards])).toEqual([['prolific', 3], ['newbie', 1]]);
  });

  it('Rising uses a creator earliest board for the window, not their latest', async () => {
    seedBoard('m1', 'mixed', 'Old one', 1, 40);
    seedBoard('m2', 'mixed', 'New one', 1, 1);
    asUser('viewer');

    const { rising } = await caller.wire.getCreatorLeaderboard();
    expect(rising).toEqual([]);
  });

  it('reports the viewer own rank per tab, and null where they do not appear', async () => {
    seedBoard('v1', 'alice', 'A', 50);
    seedBoard('v2', 'alice', 'A2', 50);
    seedBoard('v3', 'viewer', 'V', 9);
    asUser('viewer');

    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.builders.map(e => e.member)).toEqual(['alice', 'viewer']);
    expect(res.ranks.builders).toBe(2);
    expect(res.ranks.engaging).toBe(2);
    expect(res.ranks.rising).toBe(2);
  });

  it('reports a null rank for a viewer who has posted nothing', async () => {
    seedBoard('n1', 'alice', 'A', 50);
    asUser('lurker');

    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.ranks).toEqual({ builders: null, engaging: null, rising: null });
  });

  it('reports null ranks for a logged-out viewer', async () => {
    seedBoard('n1', 'alice', 'A', 50);
    asUser(undefined);

    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.username).toBeNull();
    expect(res.ranks).toEqual({ builders: null, engaging: null, rising: null });
  });

  it('caps each tab at 25 rows', async () => {
    for (let i = 0; i < 30; i++) seedBoard(`cap${i}`, `user${i}`, `T${i}`, 5 + i);
    asUser('viewer');

    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.builders).toHaveLength(25);
    expect(res.engaging).toHaveLength(25);
    expect(res.rising).toHaveLength(25);
    expect(res.builders[0]!.member).toBe('user29');
  });

  it('ignores board-plays rows that have no meta (unknown creator)', async () => {
    const orphans = new Map([['ghost', 99]]);
    mocks.zsets.set('wire:board-plays', orphans);
    seedBoard('real', 'alice', 'Real', 7);
    asUser('viewer');

    const { builders } = await caller.wire.getCreatorLeaderboard();
    expect(builders.map(e => [e.member, e.plays])).toEqual([['alice', 7]]);
  });
});

describe('creator leaderboard — board registration', () => {
  it('lists a freshly created board immediately, before anyone solves it', async () => {
    asUser('alice');
    await caller.wire.createCustomPuzzle({ w: 5, h: 5, pairs: generatePuzzle(3, 5, 5, 4).pairs, title: 'Fresh' });

    asUser('viewer', 't3_post1');
    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.rising.map(e => [e.member, e.boards, e.score])).toEqual([['alice', 1, 0]]);
    expect(res.builders).toEqual([]);
    expect(res.engaging).toEqual([]);
  });

  it('backfills a legacy board when its splash is opened', async () => {
    seedLegacyBoard('old1', 'alice', 'Legacy');
    asUser('viewer', 't3_old1');

    const before = await caller.wire.getCreatorLeaderboard();
    // The creator-tab read itself registers the board being viewed.
    expect(before.rising.map(e => e.member)).toEqual(['alice']);

    mocks.reset();
    seedLegacyBoard('old2', 'bob', 'Legacy 2');
    asUser('viewer', 't3_old2');
    expect(await mocks.redis.zScore('wire:board-plays', 'old2')).toBeUndefined();

    await caller.wire.getSplash();
    expect(await mocks.redis.zScore('wire:board-plays', 'old2')).toBe(0);
    const meta = JSON.parse((await mocks.redis.hGet('wire:board-meta', 'old2'))!) as { c: string; t: string };
    expect(meta.c).toBe('bob');
    expect(meta.t).toBe('Legacy 2');

    asUser('viewer', undefined);
    const after = await caller.wire.getCreatorLeaderboard();
    expect(after.rising.map(e => e.member)).toEqual(['bob']);
  });

  it('never resets an existing solver count while backfilling meta', async () => {
    seedLegacyBoard('half', 'alice', 'Half tracked', 12);
    asUser('viewer', 't3_half');

    await caller.wire.getSplash();
    expect(await mocks.redis.zScore('wire:board-plays', 'half')).toBe(12);

    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.builders.map(e => [e.member, e.score, e.plays])).toEqual([['alice', 1, 12]]);
  });

  it('backfill is idempotent across repeated views', async () => {
    seedLegacyBoard('idem', 'alice', 'Once');
    asUser('viewer', 't3_idem');

    await caller.wire.getSplash();
    const metaFirst = await mocks.redis.hGet('wire:board-meta', 'idem');
    await caller.wire.getSplash();
    await caller.wire.getCreatorLeaderboard();

    expect(await mocks.redis.hGet('wire:board-meta', 'idem')).toBe(metaFirst);
    expect(await mocks.redis.zCard('wire:board-plays')).toBe(1);
    expect(await mocks.redis.zScore('wire:board-plays', 'idem')).toBe(0);
  });

  it('does not register daily posts as creator boards', async () => {
    asUser('viewer', undefined);
    await caller.wire.getSplash();
    expect(await mocks.redis.zCard('wire:board-plays')).toBe(0);

    const res = await caller.wire.getCreatorLeaderboard();
    expect(res.rising).toEqual([]);
  });
});

describe('creator leaderboard — solve accounting', () => {
  const solveCustom = async (postId: string, solver: string) => {
    asUser(solver, `t3_${postId}`);
    const board = await caller.wire.getBoard();
    const solution = solvePuzzle(board.puzzle, 250000)!;
    await caller.wire.begin();
    return caller.wire.submit({
      routes: solution.map((cells, color) => ({ color, cells })),
      moves: board.puzzle.pairs.length,
    });
  };

  it('credits a solve to the board and its creator, not the solver', async () => {
    asUser('alice');
    await caller.wire.createCustomPuzzle({ w: 5, h: 5, pairs: generatePuzzle(7, 5, 5, 4).pairs, title: 'Alice board' });

    const res = await solveCustom('post1', 'solver1');
    expect(res.solved).toBe(true);
    expect(await mocks.redis.zScore('wire:board-plays', 'post1')).toBe(1);

    asUser('viewer', undefined);
    const lb = await caller.wire.getCreatorLeaderboard();
    expect(lb.engaging.map(e => [e.member, e.score])).toEqual([['alice', 1]]);
    expect(lb.rising.map(e => [e.member, e.score])).toEqual([['alice', 1]]);
    expect(lb.builders).toEqual([]);
  });

  it('promotes a board into Builders on the fifth distinct solver', async () => {
    asUser('alice');
    await caller.wire.createCustomPuzzle({ w: 5, h: 5, pairs: generatePuzzle(11, 5, 5, 4).pairs, title: 'Climber' });

    for (const s of ['s1', 's2', 's3', 's4']) await solveCustom('post1', s);
    asUser('viewer', undefined);
    expect((await caller.wire.getCreatorLeaderboard()).builders).toEqual([]);

    await solveCustom('post1', 's5');
    asUser('viewer', undefined);
    const lb = await caller.wire.getCreatorLeaderboard();
    expect(lb.builders.map(e => [e.member, e.score, e.plays])).toEqual([['alice', 1, 5]]);
  });

  it('counts a repeat solve by the same user only once', async () => {
    asUser('alice');
    await caller.wire.createCustomPuzzle({ w: 5, h: 5, pairs: generatePuzzle(13, 5, 5, 4).pairs, title: 'Repeat' });

    await solveCustom('post1', 'solver1');
    await solveCustom('post1', 'solver1');
    expect(await mocks.redis.zScore('wire:board-plays', 'post1')).toBe(1);
  });

  it('does not touch creator tabs when the daily board is solved', async () => {
    asUser('daily-solver', undefined);
    const board = await caller.wire.getBoard();
    const solution = solvePuzzle(board.puzzle, 250000)!;
    await caller.wire.begin();
    const res = await caller.wire.submit({
      routes: solution.map((cells, color) => ({ color, cells })),
      moves: board.puzzle.pairs.length,
    });

    expect(res.solved).toBe(true);
    expect(await mocks.redis.zCard('wire:board-plays')).toBe(0);
    expect((await caller.wire.getCreatorLeaderboard()).rising).toEqual([]);
  });
});

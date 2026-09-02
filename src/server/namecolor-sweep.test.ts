import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Redis + a stub comment listing, so what's under test is the shipped
// sweep rather than a re-implementation of it.
const mocks = vi.hoisted(() => {
  const strings = new Map<string, string>();
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();

  const z = (k: string) => {
    let m = zsets.get(k);
    if (!m) { m = new Map(); zsets.set(k, m); }
    return m;
  };
  const h = (k: string) => {
    let m = hashes.get(k);
    if (!m) { m = new Map(); hashes.set(k, m); }
    return m;
  };
  const sorted = (k: string) =>
    [...z(k).entries()].map(([member, score]) => ({ member, score }))
      .sort((a, b) => a.score - b.score || (a.member < b.member ? -1 : 1));

  const redis = {
    get: async (k: string) => strings.get(k),
    set: async (k: string, v: string) => { strings.set(k, v); return 'OK'; },
    expire: async () => {},
    zAdd: async (k: string, ...es: { member: string; score: number }[]) => {
      for (const e of es) z(k).set(e.member, e.score);
      return es.length;
    },
    zCard: async (k: string) => z(k).size,
    zIncrBy: async (k: string, m: string, n: number) => {
      const v = (z(k).get(m) ?? 0) + n;
      z(k).set(m, v);
      return v;
    },
    zRem: async (k: string, ms: string[]) => { ms.forEach(m => z(k).delete(m)); },
    zRange: async (k: string, start: number, stop: number) => {
      const all = sorted(k);
      const end = stop < 0 ? all.length + stop : stop;
      return all.slice(Math.max(0, start), end + 1);
    },
    hGet: async (k: string, f: string) => h(k).get(f),
    hMGet: async (k: string, fs: string[]) => fs.map(f => h(k).get(f) ?? null),
    hGetAll: async (k: string) => Object.fromEntries(h(k).entries()),
    hSet: async (k: string, o: Record<string, string>) => {
      for (const [f, v] of Object.entries(o)) h(k).set(f, v);
      return Object.keys(o).length;
    },
    hDel: async (k: string, fs: string[]) => { fs.forEach(f => h(k).delete(f)); },
    hLen: async (k: string) => h(k).size,
  };

  // What Reddit's comment listing returns for the post under test.
  let listing: { id: string; score: number }[] = [];
  const comments: string[] = [];
  const reddit = {
    getComments: () => ({ all: async () => listing }),
    submitComment: async (args: { text: string }) => {
      comments.push(args.text);
      return { id: 't1_x', distinguish: async () => {} };
    },
  };

  const reset = () => {
    strings.clear(); zsets.clear(); hashes.clear();
    listing = []; comments.length = 0;
  };

  return {
    redis, reddit, reset, zsets, hashes, strings, comments,
    setListing: (l: { id: string; score: number }[]) => { listing = l; },
  };
});

vi.mock('@devvit/web/server', () => ({
  redis: mocks.redis,
  reddit: mocks.reddit,
  context: {},
  settings: { get: async () => undefined },
}));

const { ncKeys, sweepPost, sweepActivePosts } = await import('./core/namecolor');
const { NAMECOLOR_CONFIG } = await import('../shared/namecolor-core');

const DAY = 24 * 3600 * 1000;
const POST = 'abc123';

type Seed = { id: string; name: string; author: string; at: number; score: number };

const seedPost = async (entries: Seed[], createdAt = Date.now()) => {
  await mocks.redis.set(ncKeys.post(POST), JSON.stringify({ hex: '#123456', createdAt, creator: null, title: null }));
  await mocks.redis.set(ncKeys.sticky(POST), 't1_sticky');
  await mocks.redis.zAdd(ncKeys.active, { member: POST, score: createdAt });
  for (const e of entries) {
    await mocks.redis.hSet(ncKeys.entries(POST), {
      [e.id]: JSON.stringify({ raw: e.name, author: e.author, permalink: `/r/x/${e.id}`, at: e.at }),
    });
    await mocks.redis.hSet(ncKeys.byUser(POST), { [e.author]: JSON.stringify([e.id]) });
  }
  mocks.setListing(entries.map(e => ({ id: e.id, score: e.score })));
};

const held = () => mocks.strings.get(ncKeys.banked(POST));
const wins = (u: string) => mocks.zsets.get(ncKeys.wins)?.get(u) ?? 0;

beforeEach(() => {
  // One test walks the clock forward; make sure a failure there can't leave the
  // rest of the file running on a frozen Date.
  vi.useRealTimers();
  mocks.reset();
});

describe('vote counting never stops', () => {
  it('moves the color credit when a name overtakes long after the recaps ended', async () => {
    const born = Date.now() - 30 * DAY;
    await seedPost([
      { id: 'c1', name: 'Rust', author: 'ann', at: born, score: 9 },
      { id: 'c2', name: 'Clay', author: 'bo', at: born + 1000, score: 4 },
    ], born);

    await sweepPost(POST, true);
    expect(held()).toBe('ann');
    expect(wins('ann')).toBe(1);

    // Day 30: bo overtakes. The board would show it; the credit has to follow.
    mocks.setListing([{ id: 'c1', score: 9 }, { id: 'c2', score: 21 }]);
    await sweepPost(POST, true);

    expect(held()).toBe('bo');
    expect(wins('bo')).toBe(1);
    expect(wins('ann')).toBe(0);
  });

  it('credits nobody while every name still sits at zero', async () => {
    const at = Date.now();
    await seedPost([
      { id: 'c1', name: 'A', author: 'ann', at, score: 0 },
      { id: 'c2', name: 'B', author: 'bo', at: at + 1, score: 0 },
    ]);
    await sweepPost(POST, true);
    expect(held()).toBeUndefined();
    expect(wins('ann')).toBe(0);
    expect(wins('bo')).toBe(0);
  });

  it('breaks a tie the same way the board does, and does not trade the credit back and forth', async () => {
    const at = Date.now();
    await seedPost([
      { id: 'c2', name: 'Late', author: 'bo', at: at + 5000, score: 7 },
      { id: 'c1', name: 'Early', author: 'ann', at, score: 7 },
    ]);

    await sweepPost(POST, true);
    expect(held()).toBe('ann');

    await sweepPost(POST, true);
    await sweepPost(POST, true);
    expect(held()).toBe('ann');
    expect(wins('ann')).toBe(1);
    expect(wins('bo')).toBe(0);
  });
});

describe('deleted names', () => {
  it('drops a name whose comment is gone from the board, the votes and the hall', async () => {
    const born = Date.now() - 5 * DAY;
    await seedPost([
      { id: 'c1', name: 'Rust', author: 'ann', at: born, score: 9 },
      { id: 'c2', name: 'Clay', author: 'bo', at: born, score: 4 },
    ], born);
    await sweepPost(POST, true);
    expect(mocks.zsets.get(ncKeys.hall)?.has(`${POST}|c2`)).toBe(true);

    mocks.setListing([{ id: 'c1', score: 9 }]);
    await sweepPost(POST, true);

    expect(mocks.hashes.get(ncKeys.entries(POST))?.has('c2')).toBe(false);
    expect(mocks.zsets.get(ncKeys.votes(POST))?.has('c2')).toBe(false);
    expect(mocks.zsets.get(ncKeys.hall)?.has(`${POST}|c2`)).toBe(false);
    expect(mocks.hashes.get(ncKeys.hallMeta)?.has(`${POST}|c2`)).toBe(false);
    expect(JSON.parse(mocks.hashes.get(ncKeys.byUser(POST))!.get('bo')!)).toEqual([]);
  });

  it('keeps a name Reddit has not indexed yet', async () => {
    await seedPost([{ id: 'c1', name: 'Fresh', author: 'ann', at: Date.now(), score: 1 }]);
    mocks.setListing([]);
    await sweepPost(POST, true);
    expect(mocks.hashes.get(ncKeys.entries(POST))?.has('c1')).toBe(true);
  });

  it('forgets nothing when Reddit answers with an empty listing', async () => {
    const born = Date.now() - 5 * DAY;
    await seedPost([
      { id: 'c1', name: 'Rust', author: 'ann', at: born, score: 9 },
      { id: 'c2', name: 'Clay', author: 'bo', at: born, score: 4 },
    ], born);
    await sweepPost(POST, true);

    // A hiccup: the call succeeds but comes back with nothing. That is the fetch
    // saying nothing, not the whole board deleting itself.
    mocks.setListing([]);
    await sweepPost(POST, true);

    expect(mocks.hashes.get(ncKeys.entries(POST))?.size).toBe(2);
    expect(mocks.zsets.get(ncKeys.hall)?.has(`${POST}|c1`)).toBe(true);
    expect(mocks.zsets.get(ncKeys.hall)?.has(`${POST}|c2`)).toBe(true);
  });

  it('forgets nothing when the listing shows none of the names on this post', async () => {
    const born = Date.now() - 5 * DAY;
    await seedPost([
      { id: 'c1', name: 'Rust', author: 'ann', at: born, score: 9 },
      { id: 'c2', name: 'Clay', author: 'bo', at: born, score: 4 },
    ], born);
    await sweepPost(POST, true);

    // Comments came back, but not one of them is a name we know — the wrong
    // thread, or a partial answer. Either way it is not evidence of deletion.
    mocks.setListing([{ id: 'someone-elses-reply', score: 2 }]);
    await sweepPost(POST, true);

    expect(mocks.hashes.get(ncKeys.entries(POST))?.size).toBe(2);
  });

  it('never forgets more than a handful in one sweep', async () => {
    const born = Date.now() - 5 * DAY;
    const names = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`, name: `n${i}`, author: `u${i}`, at: born, score: 1,
    }));
    await seedPost(names, born);
    await sweepPost(POST, true);

    // One name survives, so the listing is trusted — but 39 vanishing at once is
    // still far more likely to be a bad answer than 39 real deletions.
    mocks.setListing([{ id: 'c0', score: 1 }]);
    await sweepPost(POST, true);

    const left = mocks.hashes.get(ncKeys.entries(POST))!.size;
    expect(left).toBe(40 - NAMECOLOR_CONFIG.maxDeletesPerSweep);
  });

  it('keeps every name when the listing was truncated', async () => {
    const born = Date.now() - 5 * DAY;
    const many = Array.from({ length: NAMECOLOR_CONFIG.commentFetchLimit }, (_, i) => ({
      id: `f${i}`, name: `n${i}`, author: `u${i}`, at: born, score: 1,
    }));
    await seedPost([...many, { id: 'mine', name: 'Mine', author: 'ann', at: born, score: 3 }], born);
    // A full page came back and the name is not on it — that is truncation, not a deletion.
    mocks.setListing(many.map(m => ({ id: m.id, score: m.score })));
    await sweepPost(POST, true);
    expect(mocks.hashes.get(ncKeys.entries(POST))?.has('mine')).toBe(true);
  });
});

describe('the cron only exists for the recap comments', () => {
  it('still posts the final day-4 recap', async () => {
    const born = Date.now() - (NAMECOLOR_CONFIG.recapDays * DAY + 3600 * 1000);
    await seedPost([{ id: 'c1', name: 'Rust', author: 'ann', at: born, score: 9 }], born);

    expect(await sweepActivePosts()).toBe(1);
    expect(mocks.comments.some(t => t.startsWith(`**Day ${NAMECOLOR_CONFIG.recapDays}:`))).toBe(true);
  });

  it('posts one recap a day for four days, then never again — while the votes keep counting', async () => {
    const born = Date.now() - 60_000;
    await seedPost([
      { id: 'c1', name: 'Rust', author: 'ann', at: born, score: 3 },
      { id: 'c2', name: 'Clay', author: 'bo', at: born + 1000, score: 1 },
    ], born);

    const recapsAfter = (days: number) => {
      // Walk the clock forward instead of the post back, so one post lives
      // through the whole window exactly as it would in production.
      vi.setSystemTime(born + days * DAY + 3600 * 1000);
      return sweepActivePosts();
    };

    for (let day = 1; day <= NAMECOLOR_CONFIG.recapDays; day++) {
      // The board has to move for a recap to be worth posting.
      mocks.setListing([{ id: 'c1', score: 3 + day }, { id: 'c2', score: 1 }]);
      await recapsAfter(day);
      expect(mocks.comments).toHaveLength(day);
      expect(mocks.comments[day - 1]!.startsWith(`**Day ${day}:`)).toBe(true);
    }

    // Day 5 and 6: the app has said its last word, and the post is off the cron.
    for (const day of [5, 6]) {
      mocks.setListing([{ id: 'c1', score: 50 }, { id: 'c2', score: 99 }]);
      await recapsAfter(day);
    }
    expect(mocks.comments).toHaveLength(NAMECOLOR_CONFIG.recapDays);
    expect(mocks.zsets.get(ncKeys.active)?.has(POST)).toBe(false);

    // But an on-demand sweep — someone opening the post — still counts, and the
    // day-6 overtake still takes the credit.
    mocks.setListing([{ id: 'c1', score: 50 }, { id: 'c2', score: 99 }]);
    await sweepPost(POST, true);
    expect(mocks.comments).toHaveLength(NAMECOLOR_CONFIG.recapDays);
    expect(held()).toBe('bo');
    expect(mocks.zsets.get(ncKeys.votes(POST))?.get('c2')).toBe(99);
  });

  it('evicts a post past the recap window instead of sweeping it', async () => {
    const born = Date.now() - 10 * DAY;
    await seedPost([{ id: 'c1', name: 'Rust', author: 'ann', at: born, score: 9 }], born);

    expect(await sweepActivePosts()).toBe(0);
    expect(mocks.zsets.get(ncKeys.active)?.has(POST)).toBe(false);
    expect(mocks.comments).toHaveLength(0);
  });
});

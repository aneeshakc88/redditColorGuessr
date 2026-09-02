import { Hono } from 'hono';
import { redis, settings } from '@devvit/web/server';
import { createFlagPost, createMastermindPost, createNameColorPost, createThemedCustomPost, createWirePost } from '../core/post';
import { themeForSlot } from '../core/color-themes';
import { sweepActivePosts } from '../core/namecolor';

export const cron = new Hono();

const DOW = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

// Mod-configurable gate (Reddit app settings page — changeable anytime, no
// code push or re-review needed) for whether a given scheduled slot should
// post right now: master on/off, per-slot on/off, per-weekday on/off, and an
// optional stop date. Day-of-week is evaluated in UTC.
async function shouldPostSlot(slotId: string): Promise<boolean> {
  const enabled = await settings.get<boolean>('scheduledPostsEnabled');
  if (enabled === false) return false;

  const stopDate = await settings.get<string>('scheduledStopDate');
  if (stopDate && new Date().toISOString().split('T')[0]! >= stopDate) return false;

  const activeDays = await settings.get<string[]>('scheduledDaysEnabled');
  if (activeDays && !activeDays.includes(DOW[new Date().getUTCDay()]!)) return false;

  const activeSlots = await settings.get<string[]>('scheduledSlotsEnabled');
  if (activeSlots && !activeSlots.includes(slotId)) return false;

  return true;
}

// Per-game mod-configurable on/off switch (Reddit app settings page —
// changeable anytime, no code push or re-review needed). Independent of
// shouldPostSlot's day/stop-date logic, which only applies to the custom
// ColorGuessr slots below.
async function isGameEnabled(settingKey: string): Promise<boolean> {
  const enabled = await settings.get<boolean>(settingKey);
  return enabled !== false;
}

// Two scheduled runs per day (00:30 + 03:45 UTC) each drop one Flag ColorGuessr
// post. Both fire after the UTC date rollover, so they snapshot the same day's flags.
cron.post('/flag-daily', async (c) => {
  try {
    if (!(await isGameEnabled('flagPostsEnabled'))) {
      return c.json({ status: 'skipped', reason: 'disabled by settings' }, 200);
    }
    const post = await createFlagPost();
    return c.json({ status: 'success', postId: post.id }, 200);
  } catch (e) {
    console.error('cron flag-daily failed:', e);
    return c.json({ status: 'error' }, 200);
  }
});

// Fires once daily at 23:01 UTC (12:01am CET).
cron.post('/mastermind-daily', async (c) => {
  try {
    if (!(await isGameEnabled('mastermindPostsEnabled'))) {
      return c.json({ status: 'skipped', reason: 'disabled by settings' }, 200);
    }
    const post = await createMastermindPost();
    return c.json({ status: 'success', postId: post.id }, 200);
  } catch (e) {
    console.error('cron mastermind-daily failed:', e);
    return c.json({ status: 'error' }, 200);
  }
});

// Fires once daily at 06:10 UTC.
cron.post('/wire-daily', async (c) => {
  try {
    if (!(await isGameEnabled('wirePostsEnabled'))) {
      return c.json({ status: 'skipped', reason: 'disabled by settings' }, 200);
    }
    const today = new Date().toISOString().split('T')[0]!;
    const guardKey = `wire:daily-posted:${today}`;
    if (await redis.get(guardKey)) return c.json({ status: 'skipped', reason: 'already posted today' }, 200);
    await redis.set(guardKey, '1', { expiration: new Date(Date.now() + 26 * 3600 * 1000) });

    const post = await createWirePost();
    return c.json({ status: 'success', postId: post.id }, 200);
  } catch (e) {
    console.error('cron wire-daily failed:', e);
    return c.json({ status: 'error' }, 200);
  }
});

// Fires once daily at 12:20 UTC.
cron.post('/namecolor-daily', async (c) => {
  try {
    if (!(await isGameEnabled('namecolorPostsEnabled'))) {
      return c.json({ status: 'skipped', reason: 'disabled by settings' }, 200);
    }
    const today = new Date().toISOString().split('T')[0]!;
    const guardKey = `namecolor:daily-posted:${today}`;
    if (await redis.get(guardKey)) return c.json({ status: 'skipped', reason: 'already posted today' }, 200);
    await redis.set(guardKey, '1', { expiration: new Date(Date.now() + 26 * 3600 * 1000) });

    const post = await createNameColorPost();
    return c.json({ status: 'success', postId: post.id }, 200);
  } catch (e) {
    console.error('cron namecolor-daily failed:', e);
    return c.json({ status: 'error' }, 200);
  }
});

// The only timed job Name This Color still has, and it exists for one reason:
// the daily summary comment has to go out on schedule even on a day nobody
// opened the post. So it is scoped to just that — posts inside the 4-day recap
// window. Older posts are evicted from the active set instead of swept; their
// votes are counted on demand, forever, whenever someone opens the post or taps
// through to a comment. Nothing about voting is ever frozen.
cron.post('/namecolor-sweep', async (c) => {
  try {
    const swept = await sweepActivePosts();
    return c.json({ status: 'success', swept }, 200);
  } catch (e) {
    console.error('cron namecolor-sweep failed:', e);
    return c.json({ status: 'error' }, 200);
  }
});

// Ten daily themed custom ColorGuessr drops, timed around the requested CET
// traffic windows. Devvit caps the number of registered scheduler tasks, so
// this runs off ONE every-minute cron (registered once in devvit.json) rather
// than ten separate scheduled tasks — this handler checks the clock itself
// and only acts when the current UTC time matches one of the slots below.
// Each slot's theme rotates day to day via themeForSlot (color-themes.ts), so
// the same slot never repeats a palette two days running, and no two slots
// share a theme on the same day.
const SLOTS: { hh: number; mm: number; cet: string }[] = [
  { hh: 16, mm: 15, cet: '5:15pm CET' },
  { hh: 16, mm: 25, cet: '5:25pm CET' },
  { hh: 21, mm: 30, cet: '10:30pm CET' },
  { hh: 22, mm: 30, cet: '11:30pm CET' },
  { hh: 22, mm: 59, cet: '11:59pm CET' },
  { hh: 23, mm: 15, cet: '12:15am CET' },
  { hh: 0, mm: 45, cet: '1:45am CET' },
  { hh: 1, mm: 45, cet: '2:45am CET' },
  { hh: 2, mm: 45, cet: '3:45am CET' },
  { hh: 3, mm: 45, cet: '4:45am CET' },
];

cron.post('/custom-scheduled', async (c) => {
  const now = new Date();
  const slot = SLOTS.findIndex(s => s.hh === now.getUTCHours() && s.mm === now.getUTCMinutes());
  if (slot === -1) return c.json({ status: 'no-op' }, 200);

  const slotId = `slot-${slot + 1}`;
  try {
    if (!(await shouldPostSlot(slotId))) {
      return c.json({ status: 'skipped', reason: 'disabled by settings' }, 200);
    }
    // Guard against the same minute firing twice (retries, clock jitter).
    const today = now.toISOString().split('T')[0]!;
    const guardKey = `color-guesser:custom-scheduled:${today}:${slotId}`;
    if (await redis.get(guardKey)) return c.json({ status: 'skipped', reason: 'already posted this slot today' }, 200);
    await redis.set(guardKey, '1', { expiration: new Date(Date.now() + 26 * 3600 * 1000) });

    const theme = themeForSlot(slot);
    const post = await createThemedCustomPost(theme);
    return c.json({ status: 'success', postId: post.id, theme: theme.title, slot: slotId }, 200);
  } catch (e) {
    console.error(`cron custom-scheduled (${slotId}) failed:`, e);
    return c.json({ status: 'error' }, 200);
  }
});

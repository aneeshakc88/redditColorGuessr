import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context, redis, reddit } from '@devvit/web/server';
import { createCustomPost, createFlagGauntletPost } from '../core/post';
import { applySpecialFlair } from '../core/flair';

const DEV_SUBREDDIT = 'cg_dev_2';

export const menu = new Hono();

// Every "Post Daily X" item opens this form first so a mod can set an
// announcement-friendly title; leaving it blank keeps the auto-generated one.
const titleForm = (name: string, formTitle: string): UiResponse['showForm'] => ({
  name,
  form: {
    title: formTitle,
    acceptLabel: 'Post',
    fields: [
      { type: 'string', name: 'title', label: 'Post title', helpText: 'Leave blank to use the default title.' },
    ],
  },
});

menu.post('/post-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('post-create', 'Post Daily ColorGuessr') }, 200);
});

menu.post('/custom-post-create', async (c) => {
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) throw new Error('Could not get username');
    const post = await createCustomPost(username);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating custom post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create custom post' }, 400);
  }
});

menu.post('/mastermind-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('mastermind-create', 'Post Daily Crack the Code') }, 200);
});

menu.post('/leaderboard-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('leaderboard-create', 'Post Global Leaderboard') }, 200);
});

menu.post('/flag-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('flag-create', 'Post Daily Flag ColorGuessr') }, 200);
});

menu.post('/flag-gauntlet-create', async (c) => {
  if (context.subredditName?.toLowerCase() !== DEV_SUBREDDIT) {
    return c.json<UiResponse>({ showToast: 'Gauntlet posts are dev-subreddit only' }, 400);
  }
  try {
    const post = await createFlagGauntletPost();
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating flag gauntlet post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Flag Gauntlet post' }, 400);
  }
});

menu.post('/memory-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('memory-create', 'Post Daily Run (Color Memory)') }, 200);
});

menu.post('/memory-bonus-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('memory-bonus-create', 'Post Bonus Run (Color Memory)') }, 200);
});

menu.post('/wire-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('wire-create', 'Post Daily Colorwire') }, 200);
});

menu.post('/namecolor-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('namecolor-create', 'Post Daily Name This Color') }, 200);
});

menu.post('/equinox-create', async (c) => {
  return c.json<UiResponse>({ showForm: titleForm('equinox-create', 'Post Daily Equinox') }, 200);
});

// Wipes the caller's own Equinox history so the first-run walkthrough is offered
// again. Dev subreddit only — it deletes a real streak and lifetime count.
menu.post('/equinox-reset-me', async (c) => {
  if (context.subredditName?.toLowerCase() !== DEV_SUBREDDIT) {
    return c.json<UiResponse>({ showToast: 'Equinox reset is dev-subreddit only' }, 400);
  }
  try {
    const username = await reddit.getCurrentUsername();
    if (!username) throw new Error('Could not get username');
    const day = new Date().toISOString().split('T')[0]!;

    await Promise.all([
      redis.del(`equinox:onboarded:${username}`),
      redis.del(`equinox:streak:${username}`),
      redis.del(`equinox:daily:${day}:${username}`),
      redis.del(`equinox:start:${day}:${username}`),
      redis.zRem('equinox:plays:alltime', [username]),
      redis.zRem(`equinox:lb:${day}`, [username]),
      redis.hDel(`equinox:detail:${day}`, [username]),
      redis.hDel('equinox:stats', [username]),
    ]);

    return c.json<UiResponse>({ showToast: `Equinox reset for ${username} — reopen the post` }, 200);
  } catch (error) {
    console.error(`Error resetting Equinox progress: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to reset Equinox progress' }, 400);
  }
});

// Rewire's builder UI (photo upload + wiring) only makes sense for the mod
// running it — moved off every Colorwire/Rewire splash and into mod tools,
// dev-sub only. Opens a fresh post whose entrypoint IS the builder itself;
// submitting from there posts the real Rewire board (see rewire.createCustomPuzzle).
menu.post('/rewire-creator-post', async (c) => {
  if (context.subredditName?.toLowerCase() !== DEV_SUBREDDIT) {
    return c.json<UiResponse>({ showToast: 'Rewire builder is dev-subreddit only' }, 400);
  }
  try {
    const subredditName = context.subredditName;
    const post = await reddit.submitCustomPost({
      subredditName,
      title: '[dev] Rewire board builder',
      entry: 'rewire-creator',
    });
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating Rewire builder post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to open Rewire builder' }, 400);
  }
});

menu.post('/apply-tester-flair', async (c) => {
  try {
    await applySpecialFlair('Poetress');
    return c.json<UiResponse>({ showToast: 'Tester Goddess flair applied!' }, 200);
  } catch (error) {
    console.error(`Error applying tester flair: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to apply flair' }, 400);
  }
});

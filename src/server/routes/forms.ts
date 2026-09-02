import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { createPost, createLeaderboardPost, createMastermindPost, createFlagPost, createMemoryPost, createBonusMemoryPost, createWirePost, createNameColorPost, createEquinoxPost } from '../core/post';

export const forms = new Hono();

// Post.id carries the t3_ prefix; reddit.com/comments/ wants the bare id, so a
// link built straight from post.id does not resolve. Only Name This Color
// strips it — the rest are left as they were, matching the old menu handlers.
const rawId = (id: string): string => (id.startsWith('t3_') ? id.slice(3) : id);

type TitleValues = { title?: string };

forms.post('/post-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error('Error creating post:', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});

forms.post('/mastermind-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createMastermindPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating mastermind post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Mastermind post' }, 400);
  }
});

forms.post('/leaderboard-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createLeaderboardPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating leaderboard post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create leaderboard post' }, 400);
  }
});

forms.post('/flag-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createFlagPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating flag post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Flag ColorGuessr post' }, 400);
  }
});

forms.post('/memory-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createMemoryPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating memory post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create The Run post' }, 400);
  }
});

forms.post('/memory-bonus-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createBonusMemoryPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating bonus Run post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Bonus Run post' }, 400);
  }
});

forms.post('/wire-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createWirePost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating Colorwire post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Colorwire post' }, 400);
  }
});

forms.post('/namecolor-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createNameColorPost(undefined, undefined, title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${rawId(post.id)}` }, 200);
  } catch (error) {
    console.error(`Error creating Name This Color post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Name This Color post' }, 400);
  }
});

forms.post('/equinox-create', async (c) => {
  try {
    const { title } = await c.req.json<TitleValues>();
    const post = await createEquinoxPost(title);
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating Equinox post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create Equinox post' }, 400);
  }
});

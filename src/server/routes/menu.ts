import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { reddit } from '@devvit/web/server';
import { createPost, createCustomPost, createLeaderboardPost } from '../core/post';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const post = await createPost();
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error('Error creating post:', error);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
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

menu.post('/leaderboard-create', async (c) => {
  try {
    const post = await createLeaderboardPost();
    return c.json<UiResponse>({ navigateTo: `https://reddit.com/comments/${post.id}` }, 200);
  } catch (error) {
    console.error(`Error creating leaderboard post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create leaderboard post' }, 400);
  }
});

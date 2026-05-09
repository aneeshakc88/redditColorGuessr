import { reddit, redis, context } from '@devvit/web/server';
import { getDailyColors } from './colors';

const formatPostDate = () => {
  const now = new Date();
  return now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

export const createPost = async () => {
  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: `ColorGuessr — ${formatPostDate()}`,
  });

  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  // Fire-and-forget: return early so gRPC response beats keepalive timeout
  void (async () => {
    try {
      const stickyComment = await reddit.submitComment({
        id: postFullId,
        text: '**Score Thread** — Share your Color Guessr results here! Tap "Comment My Score" in the game to post your score.',
        runAs: 'APP',
      });
      await stickyComment.distinguish(true);
      await redis.set(`color-guesser:sticky:${rawPostId}`, stickyComment.id);
    } catch (e) {
      console.error('createPost background sticky failed:', e);
    }
    try {
      const today = new Date().toISOString().split('T')[0]!;
      await getDailyColors(today);
    } catch (e) {
      console.error('createPost background getDailyColors failed:', e);
    }
  })();

  return post;
};

export const createCustomPost = async (creatorUsername: string, title?: string) => {
  const postTitle = title?.trim()
    ? `${title.trim()} — Custom ColorGuessr by u/${creatorUsername}`
    : `Custom ColorGuessr by u/${creatorUsername}`;

  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: postTitle,
  });

  const postFullId = (post.id.startsWith('t3_') ? post.id : `t3_${post.id}`) as `t3_${string}`;
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;

  await redis.set(`color-guesser:post-type:${rawPostId}`, 'custom');
  await redis.set(`color-guesser:custom-meta:${rawPostId}`, JSON.stringify({ creator: creatorUsername }));

  const stickyComment = await reddit.submitComment({
    id: postFullId,
    text: `**Custom ColorGuessr by u/${creatorUsername}** — Share your results here! Tap "Comment My Score" to post your score.`,
    runAs: 'APP',
  });
  await stickyComment.distinguish(true);
  await redis.set(`color-guesser:sticky:${rawPostId}`, stickyComment.id);

  return post;
};

export const createLeaderboardPost = async () => {
  const subredditName = context.subredditName;
  const post = await reddit.submitCustomPost({
    subredditName,
    title: 'ColorGuessr — Global Leaderboard',
  });
  const rawPostId = post.id.startsWith('t3_') ? post.id.slice(3) : post.id;
  await redis.set(`color-guesser:post-type:${rawPostId}`, 'leaderboard');
  return post;
};

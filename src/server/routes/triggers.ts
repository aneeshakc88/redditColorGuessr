import { Hono } from 'hono';
import type { TriggerResponse } from '@devvit/web/shared';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  console.log('[onAppInstall] trigger fired - returning success immediately');
  return c.json<TriggerResponse>(
    { status: 'success', message: 'app-install-ok-v2' },
    200
  );
});

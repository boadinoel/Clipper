import { Hono } from 'hono';
import { config } from '../config.js';
import { inngest } from '../inngest/client.js';
import { logger } from '../lib/logger.js';
import { captureMessage } from '../lib/sentry.js';
import { supabase } from '../lib/supabase.js';

export const adminRoute = new Hono();

adminRoute.use('/admin/*', async (c, next) => {
  if (!config.ADMIN_SECRET) {
    return c.json({ error: 'admin_disabled' }, 503);
  }
  const auth = c.req.header('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  if (token !== config.ADMIN_SECRET) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
});

function audit(action: string, ctx: Record<string, unknown>): void {
  logger.info({ action, ...ctx }, 'admin action');
  captureMessage(`admin:${action}`, { level: 'info', tags: { action }, extra: ctx });
}

adminRoute.get('/admin/health', (c) => c.json({ ok: true, uptime_s: Math.round(process.uptime()) }));

adminRoute.post('/admin/refresh-profile/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  if (!userId) return c.json({ error: 'missing_user_id' }, 400);
  await inngest.send({
    name: 'profile/ingest.requested',
    data: { user_id: userId, source: 'full', reason: 'manual' },
  });
  audit('refresh_profile', { user_id: userId });
  return c.json({ ok: true, dispatched: 'profile/ingest.requested', user_id: userId });
});

adminRoute.post('/admin/ban-user/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  if (!userId) return c.json({ error: 'missing_user_id' }, 400);
  const { error } = await supabase()
    .from('users')
    .update({ tier: 'banned' })
    .eq('id', userId);
  if (error) {
    return c.json({ error: error.message }, 500);
  }
  audit('ban_user', { user_id: userId });
  return c.json({ ok: true, user_id: userId, tier: 'banned' });
});

adminRoute.post('/admin/unban-user/:user_id', async (c) => {
  const userId = c.req.param('user_id');
  if (!userId) return c.json({ error: 'missing_user_id' }, 400);
  const { error } = await supabase()
    .from('users')
    .update({ tier: 'free' })
    .eq('id', userId);
  if (error) {
    return c.json({ error: error.message }, 500);
  }
  audit('unban_user', { user_id: userId });
  return c.json({ ok: true, user_id: userId, tier: 'free' });
});

adminRoute.post('/admin/send-event', async (c) => {
  let body: { name?: string; data?: Record<string, unknown> };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'missing_event_name' }, 400);
  }
  // Admin generic event send bypasses the registry on purpose — use with care.
  await (inngest.send as (e: unknown) => Promise<unknown>)({ name: body.name, data: body.data ?? {} });
  audit('send_event', { name: body.name, data: body.data });
  return c.json({ ok: true, sent: body.name });
});

adminRoute.get('/admin/spend', async (c) => {
  const date = c.req.query('date') ?? new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase()
    .from('service_spend')
    .select('date, service, cents_used, updated_at')
    .eq('date', date);
  if (error) return c.json({ error: error.message }, 500);
  return c.json({ date, rows: data ?? [] });
});

adminRoute.post('/admin/retry-clip/:clip_id', async (c) => {
  const clipId = c.req.param('clip_id');
  if (!clipId) return c.json({ error: 'missing_clip_id' }, 400);
  await supabase()
    .from('clips')
    .update({ status: 'pending_edit', trigger_metadata: { error: null } })
    .eq('id', clipId);
  await inngest.send({ name: 'clip/created', data: { clip_id: clipId } });
  audit('retry_clip', { clip_id: clipId });
  return c.json({ ok: true, clip_id: clipId });
});

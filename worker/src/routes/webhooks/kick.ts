import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { handleStreamOffline, handleStreamOnline } from '../../streams/handlers.js';

export const kickWebhookRoute = new Hono();

interface KickPayload {
  event: string;
  data: {
    broadcaster_user_id: string;
    livestream_id?: string;
    title?: string;
    category?: { name?: string };
  };
}

kickWebhookRoute.post('/api/webhooks/kick', async (c) => {
  if (!config.KICK_WEBHOOK_SECRET) {
    return c.json({ error: 'kick webhook not configured' }, 503);
  }
  const sig = c.req.header('Kick-Signature') ?? c.req.header('X-Kick-Signature') ?? '';
  const raw = await c.req.text();

  const expected = createHmac('sha256', config.KICK_WEBHOOK_SECRET).update(raw).digest('hex');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    logger.warn({}, 'kick webhook: invalid signature');
    return c.text('bad signature', 403);
  }

  const body = JSON.parse(raw) as KickPayload;
  const broadcasterId = String(body.data.broadcaster_user_id);

  if (body.event === 'livestream.online' || body.event === 'channel.online') {
    await handleStreamOnline({
      source: 'kick',
      broadcasterId,
      title: body.data.title ?? null,
      gameName: body.data.category?.name ?? null,
      kickStreamId: body.data.livestream_id ?? null,
    });
  } else if (body.event === 'livestream.offline' || body.event === 'channel.offline') {
    await handleStreamOffline({ source: 'kick', broadcasterId });
  } else {
    logger.info({ event: body.event }, 'kick webhook: unhandled event');
  }

  return c.text('ok');
});

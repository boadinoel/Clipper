import { createHmac, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import { handleStreamOffline, handleStreamOnline } from '../../streams/handlers.js';

export const twitchEventsubRoute = new Hono();

interface EventSubNotification {
  subscription: { id: string; type: string };
  event: Record<string, unknown> & { broadcaster_user_id?: string };
}

interface EventSubChallenge {
  challenge: string;
}

twitchEventsubRoute.post('/api/webhooks/twitch-eventsub', async (c) => {
  const messageId = c.req.header('Twitch-Eventsub-Message-Id');
  const timestamp = c.req.header('Twitch-Eventsub-Message-Timestamp');
  const signature = c.req.header('Twitch-Eventsub-Message-Signature');
  const messageType = c.req.header('Twitch-Eventsub-Message-Type');
  const raw = await c.req.text();

  if (!messageId || !timestamp || !signature || !messageType) {
    return c.json({ error: 'missing headers' }, 400);
  }

  const expected =
    'sha256=' +
    createHmac('sha256', config.TWITCH_EVENTSUB_SECRET)
      .update(messageId + timestamp + raw)
      .digest('hex');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    logger.warn({ messageId }, 'twitch eventsub: invalid signature');
    return c.text('bad signature', 403);
  }

  if (messageType === 'webhook_callback_verification') {
    const body = JSON.parse(raw) as EventSubChallenge;
    return c.text(body.challenge, 200, { 'content-type': 'text/plain' });
  }

  if (messageType === 'revocation') {
    logger.warn({ messageId, raw }, 'twitch eventsub revocation');
    return c.text('ok');
  }

  if (messageType !== 'notification') {
    return c.text('ok');
  }

  const body = JSON.parse(raw) as EventSubNotification;
  const event = body.event;
  const subType = body.subscription.type;

  if (subType === 'stream.online') {
    const broadcasterId = String(event.broadcaster_user_id ?? '');
    await handleStreamOnline({
      source: 'twitch',
      broadcasterId,
      title: (event.title as string | undefined) ?? null,
      gameName: (event.category_name as string | undefined) ?? null,
      twitchStreamId: (event.id as string | undefined) ?? null,
    });
  } else if (subType === 'stream.offline') {
    const broadcasterId = String(event.broadcaster_user_id ?? '');
    await handleStreamOffline({ source: 'twitch', broadcasterId });
  } else {
    logger.info({ subType }, 'twitch eventsub: unhandled subscription type');
  }

  return c.text('ok');
});

import webpush from 'web-push';
import { config } from '../config.js';
import { logger } from './logger.js';
import { supabase } from './supabase.js';

let configured = false;
function setup(): void {
  if (configured) return;
  webpush.setVapidDetails(
    config.VAPID_SUBJECT,
    config.VAPID_PUBLIC_KEY,
    config.VAPID_PRIVATE_KEY,
  );
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  icon?: string;
}

export async function sendPushToUser(opts: {
  userId: string;
  payload: PushPayload;
}): Promise<{ sent: number; pruned: number }> {
  setup();
  const { data, error } = await supabase()
    .from('push_subscriptions')
    .select('id, endpoint, p256dh_key, auth_key')
    .eq('user_id', opts.userId);
  if (error) {
    logger.error({ err: error.message, userId: opts.userId }, 'push: fetch subscriptions failed');
    return { sent: 0, pruned: 0 };
  }
  const subs = data ?? [];
  let sent = 0;
  let pruned = 0;
  const payloadStr = JSON.stringify({
    title: opts.payload.title,
    body: opts.payload.body,
    url: opts.payload.url,
    tag: opts.payload.tag,
    icon: opts.payload.icon ?? '/icons/icon-192.png',
  });

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
          },
          payloadStr,
          { TTL: 60 * 60 },
        );
        sent++;
      } catch (e: unknown) {
        const err = e as { statusCode?: number; message?: string };
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase().from('push_subscriptions').delete().eq('id', sub.id);
          pruned++;
        } else {
          logger.warn(
            { err: err.message, status: err.statusCode, endpoint: sub.endpoint },
            'push: send failed',
          );
        }
      }
    }),
  );

  return { sent, pruned };
}

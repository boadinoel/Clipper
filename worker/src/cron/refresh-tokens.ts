import { decryptToken, encryptToken } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { sendPushToUser } from '../lib/push.js';
import { refreshKickToken } from '../lib/kick.js';
import { refreshTwitchToken } from '../lib/twitch.js';
import { fetchWithRetry, HttpStatusError } from '../lib/retry.js';
import { supabase } from '../lib/supabase.js';
import { inngest } from '../inngest/client.js';

function rethrow(tag: string, err: unknown): never {
  if (err instanceof HttpStatusError) {
    throw new Error(`${tag}: ${err.status} ${err.body}`);
  }
  throw err instanceof Error ? err : new Error(`${tag}: ${String(err)}`);
}

interface PlatformConnRow {
  id: string;
  user_id: string;
  platform: string;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
}

export const refreshTokensCron = inngest.createFunction(
  {
    id: 'refresh-tokens-cron',
    name: 'Cron — refresh tokens',
    concurrency: { limit: 1 },
  },
  { cron: '*/30 * * * *' },
  async ({ step }) => {
    const horizonIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await step.run('refresh-twitch', async () => {
      const { data, error } = await supabase()
        .from('users')
        .select('id, twitch_refresh_token_encrypted, twitch_token_expires_at')
        .not('twitch_refresh_token_encrypted', 'is', null)
        .lte('twitch_token_expires_at', horizonIso)
        .limit(200);
      if (error) {
        logger.warn({ err: error.message }, 'refresh-twitch query failed');
        return;
      }
      for (const row of data ?? []) {
        try {
          const fresh = await refreshTwitchToken(decryptToken(row.twitch_refresh_token_encrypted!));
          await supabase()
            .from('users')
            .update({
              twitch_access_token_encrypted: encryptToken(fresh.accessToken),
              twitch_refresh_token_encrypted: encryptToken(fresh.refreshToken),
              twitch_token_expires_at: fresh.expiresAt,
            })
            .eq('id', row.id);
        } catch (err) {
          logger.warn(
            { user_id: row.id, err: err instanceof Error ? err.message : String(err) },
            'twitch refresh failed',
          );
        }
      }
    });

    await step.run('refresh-kick', async () => {
      const { data, error } = await supabase()
        .from('users')
        .select('id, kick_refresh_token_encrypted, kick_token_expires_at')
        .not('kick_refresh_token_encrypted', 'is', null)
        .lte('kick_token_expires_at', horizonIso)
        .limit(200);
      if (error) {
        logger.warn({ err: error.message }, 'refresh-kick query failed');
        return;
      }
      for (const row of data ?? []) {
        try {
          const fresh = await refreshKickToken(decryptToken(row.kick_refresh_token_encrypted!));
          await supabase()
            .from('users')
            .update({
              kick_access_token_encrypted: encryptToken(fresh.accessToken),
              kick_refresh_token_encrypted: encryptToken(fresh.refreshToken),
              kick_token_expires_at: fresh.expiresAt,
            })
            .eq('id', row.id);
        } catch (err) {
          logger.warn(
            { user_id: row.id, err: err instanceof Error ? err.message : String(err) },
            'kick refresh failed',
          );
        }
      }
    });

    await step.run('refresh-platform-connections', async () => {
      const { data, error } = await supabase()
        .from('platform_connections')
        .select('id, user_id, platform, refresh_token_encrypted, token_expires_at')
        .not('refresh_token_encrypted', 'is', null)
        .lte('token_expires_at', horizonIso)
        .limit(200);
      if (error) {
        logger.warn({ err: error.message }, 'refresh-platform query failed');
        return;
      }
      for (const conn of (data ?? []) as PlatformConnRow[]) {
        try {
          const refreshed = await refreshPlatformToken(conn);
          await supabase()
            .from('platform_connections')
            .update({
              access_token_encrypted: encryptToken(refreshed.accessToken),
              refresh_token_encrypted: refreshed.refreshToken
                ? encryptToken(refreshed.refreshToken)
                : conn.refresh_token_encrypted,
              token_expires_at: refreshed.expiresAt,
            })
            .eq('id', conn.id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn({ conn_id: conn.id, platform: conn.platform, err: message }, 'connection refresh failed');
          if (message.includes('401') || message.toLowerCase().includes('invalid')) {
            await sendPushToUser({
              userId: conn.user_id,
              payload: {
                title: `${platformLabel(conn.platform)} disconnected`,
                body: 'Reconnect from Settings to keep posting.',
                url: '/settings/platforms',
                tag: `reconnect-${conn.platform}`,
              },
            }).catch(() => undefined);
          }
        }
      }
    });

    return { ok: true };
  },
);

async function refreshPlatformToken(conn: PlatformConnRow): Promise<{
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}> {
  const refresh = decryptToken(conn.refresh_token_encrypted!);
  switch (conn.platform) {
    case 'tiktok':
      return refreshTiktok(refresh);
    case 'youtube_shorts':
      return refreshGoogle(refresh);
    case 'instagram_reels':
      return refreshFacebook(refresh);
    case 'x':
      return refreshXToken(refresh);
    default:
      throw new Error(`unknown platform: ${conn.platform}`);
  }
}

async function refreshTiktok(refresh: string) {
  const body = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
    client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  const res = await fetchWithRetry(
    'https://open.tiktokapis.com/v2/oauth/token/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
    { tag: 'tiktok.refresh' },
  ).catch((err) => rethrow('tiktok refresh', err));
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
  };
}

async function refreshGoogle(refresh: string) {
  const body = new URLSearchParams({
    client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
    client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
    grant_type: 'refresh_token',
    refresh_token: refresh,
  });
  const res = await fetchWithRetry(
    'https://oauth2.googleapis.com/token',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
    { tag: 'google.refresh' },
  ).catch((err) => rethrow('google refresh', err));
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
  };
}

async function refreshFacebook(currentToken: string) {
  const params = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.INSTAGRAM_CLIENT_ID ?? '',
    client_secret: process.env.INSTAGRAM_CLIENT_SECRET ?? '',
    fb_exchange_token: currentToken,
  });
  const res = await fetchWithRetry(
    `https://graph.facebook.com/v21.0/oauth/access_token?${params}`,
    undefined,
    { tag: 'facebook.refresh' },
  ).catch((err) => rethrow('facebook refresh', err));
  const j = (await res.json()) as { access_token: string; expires_in?: number };
  return {
    accessToken: j.access_token,
    refreshToken: null,
    expiresAt: j.expires_in
      ? new Date(Date.now() + j.expires_in * 1000).toISOString()
      : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
  };
}

async function refreshXToken(refresh: string) {
  const creds = Buffer.from(
    `${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`,
  ).toString('base64');
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refresh,
    client_id: process.env.X_CLIENT_ID ?? '',
  });
  const res = await fetchWithRetry(
    'https://api.twitter.com/2/oauth2/token',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${creds}`,
      },
      body,
    },
    { tag: 'x.refresh' },
  ).catch((err) => rethrow('x refresh', err));
  const j = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: new Date(Date.now() + j.expires_in * 1000).toISOString(),
  };
}

function platformLabel(p: string): string {
  switch (p) {
    case 'tiktok':
      return 'TikTok';
    case 'youtube_shorts':
      return 'YouTube Shorts';
    case 'instagram_reels':
      return 'Instagram Reels';
    case 'x':
      return 'X';
    default:
      return p;
  }
}

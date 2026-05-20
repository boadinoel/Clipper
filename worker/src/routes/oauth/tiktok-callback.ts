import { Hono } from 'hono';
import { config } from '../../config.js';
import { inngest } from '../../inngest/client.js';
import { logger } from '../../lib/logger.js';
import {
  buildRedirectUri,
  clearStateCookies,
  frontendRedirect,
  upsertPlatformConnection,
  verifyStateCookie,
} from './shared.js';

export const tiktokOauthRoute = new Hono();

const CALLBACK_PATH = '/api/public/oauth/tiktok/callback';

interface TiktokTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  open_id: string;
  scope: string;
}

interface TiktokUserInfo {
  data: {
    user: {
      open_id: string;
      union_id?: string;
      display_name?: string;
      username?: string;
    };
  };
}

tiktokOauthRoute.get(CALLBACK_PATH, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('missing code/state', 400);
  if (!config.TIKTOK_CLIENT_KEY || !config.TIKTOK_CLIENT_SECRET) {
    return c.text('tiktok oauth not configured', 503);
  }

  const verified = verifyStateCookie(c, state);
  if (!verified.ok || !verified.userId) return c.text('invalid state', 403);

  const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: config.TIKTOK_CLIENT_KEY,
      client_secret: config.TIKTOK_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: buildRedirectUri(CALLBACK_PATH),
    }),
  });
  if (!tokenRes.ok) {
    logger.error({ status: tokenRes.status }, 'tiktok callback: token exchange failed');
    return c.text('token exchange failed', 502);
  }
  const token = (await tokenRes.json()) as TiktokTokenResponse;

  const userRes = await fetch(
    'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,username',
    {
      headers: { Authorization: `Bearer ${token.access_token}` },
    },
  );
  const info = (await userRes.json()) as TiktokUserInfo;

  await upsertPlatformConnection({
    userId: verified.userId,
    platform: 'tiktok',
    exchange: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      accountId: token.open_id,
      accountUsername: info.data?.user?.username ?? info.data?.user?.display_name ?? token.open_id,
    },
  });

  await inngest.send({
    name: 'profile/ingest.requested',
    data: {
      user_id: verified.userId,
      source: 'social',
      platform: 'tiktok',
      reason: 'oauth_connect',
    },
  });

  clearStateCookies(c);
  return c.redirect(frontendRedirect('settings'));
});

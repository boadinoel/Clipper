import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
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

export const xOauthRoute = new Hono();

const CALLBACK_PATH = '/api/public/oauth/x/callback';

interface XTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface XUserResponse {
  data: { id: string; username: string; name: string };
}

xOauthRoute.get(CALLBACK_PATH, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('missing code/state', 400);
  if (!config.X_CLIENT_ID || !config.X_CLIENT_SECRET) {
    return c.text('x oauth not configured', 503);
  }
  const verified = verifyStateCookie(c, state);
  if (!verified.ok || !verified.userId) return c.text('invalid state', 403);

  const verifier = getCookie(c, 'clipper_oauth_pkce') ?? '';

  const creds = Buffer.from(`${config.X_CLIENT_ID}:${config.X_CLIENT_SECRET}`).toString('base64');
  const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${creds}`,
    },
    body: new URLSearchParams({
      code,
      grant_type: 'authorization_code',
      client_id: config.X_CLIENT_ID,
      redirect_uri: buildRedirectUri(CALLBACK_PATH),
      code_verifier: verifier,
    }),
  });
  if (!tokenRes.ok) {
    logger.error({ status: tokenRes.status, body: await tokenRes.text() }, 'x callback: token exchange failed');
    return c.text('token exchange failed', 502);
  }
  const token = (await tokenRes.json()) as XTokenResponse;

  const meRes = await fetch('https://api.twitter.com/2/users/me', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const me = (await meRes.json()) as XUserResponse;

  await upsertPlatformConnection({
    userId: verified.userId,
    platform: 'x',
    exchange: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      accountId: me.data?.username ?? me.data?.id,
      accountUsername: me.data?.username ?? me.data?.id,
    },
  });

  await inngest.send({
    name: 'profile/ingest.requested',
    data: {
      user_id: verified.userId,
      source: 'social',
      platform: 'x',
      reason: 'oauth_connect',
    },
  });

  clearStateCookies(c);
  return c.redirect(frontendRedirect('settings'));
});

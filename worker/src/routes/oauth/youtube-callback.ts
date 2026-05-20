import { Hono } from 'hono';
import { config } from '../../config.js';
import { logger } from '../../lib/logger.js';
import {
  buildRedirectUri,
  clearStateCookies,
  frontendRedirect,
  upsertPlatformConnection,
  verifyStateCookie,
} from './shared.js';

export const youtubeOauthRoute = new Hono();

const CALLBACK_PATH = '/api/public/oauth/youtube/callback';

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

interface YoutubeChannelResponse {
  items?: Array<{
    id: string;
    snippet: { title: string; customUrl?: string };
  }>;
}

youtubeOauthRoute.get(CALLBACK_PATH, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('missing code/state', 400);
  if (!config.YOUTUBE_CLIENT_ID || !config.YOUTUBE_CLIENT_SECRET) {
    return c.text('youtube oauth not configured', 503);
  }

  const verified = verifyStateCookie(c, state);
  if (!verified.ok || !verified.userId) return c.text('invalid state', 403);

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.YOUTUBE_CLIENT_ID,
      client_secret: config.YOUTUBE_CLIENT_SECRET,
      redirect_uri: buildRedirectUri(CALLBACK_PATH),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    logger.error({ status: tokenRes.status }, 'youtube callback: token exchange failed');
    return c.text('token exchange failed', 502);
  }
  const token = (await tokenRes.json()) as GoogleTokenResponse;

  const channelRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${token.access_token}` } },
  );
  const channelJson = (await channelRes.json()) as YoutubeChannelResponse;
  const channel = channelJson.items?.[0];
  if (!channel) return c.text('no youtube channel', 502);

  await upsertPlatformConnection({
    userId: verified.userId,
    platform: 'youtube_shorts',
    exchange: {
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? null,
      expiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      accountId: channel.id,
      accountUsername: channel.snippet.customUrl ?? channel.snippet.title,
    },
  });

  clearStateCookies(c);
  return c.redirect(frontendRedirect('settings'));
});

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

export const instagramOauthRoute = new Hono();

const CALLBACK_PATH = '/api/public/oauth/instagram/callback';

interface FbTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
}

interface FbPagesResponse {
  data?: Array<{
    id: string;
    name: string;
    instagram_business_account?: { id: string };
    access_token: string;
  }>;
}

interface IgAccountResponse {
  id: string;
  username: string;
}

instagramOauthRoute.get(CALLBACK_PATH, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('missing code/state', 400);
  if (!config.INSTAGRAM_CLIENT_ID || !config.INSTAGRAM_CLIENT_SECRET) {
    return c.text('instagram oauth not configured', 503);
  }

  const verified = verifyStateCookie(c, state);
  if (!verified.ok || !verified.userId) return c.text('invalid state', 403);

  const tokenRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      client_id: config.INSTAGRAM_CLIENT_ID,
      client_secret: config.INSTAGRAM_CLIENT_SECRET,
      redirect_uri: buildRedirectUri(CALLBACK_PATH),
      code,
    })}`,
  );
  if (!tokenRes.ok) {
    logger.error({ status: tokenRes.status }, 'instagram callback: token exchange failed');
    return c.text('token exchange failed', 502);
  }
  const shortLived = (await tokenRes.json()) as FbTokenResponse;

  const longRes = await fetch(
    `https://graph.facebook.com/v21.0/oauth/access_token?${new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: config.INSTAGRAM_CLIENT_ID,
      client_secret: config.INSTAGRAM_CLIENT_SECRET,
      fb_exchange_token: shortLived.access_token,
    })}`,
  );
  const longLived = (await longRes.json()) as FbTokenResponse;

  const pagesRes = await fetch(
    `https://graph.facebook.com/v21.0/me/accounts?access_token=${encodeURIComponent(longLived.access_token)}`,
  );
  const pages = (await pagesRes.json()) as FbPagesResponse;
  const page = (pages.data ?? []).find((p) => p.instagram_business_account);
  if (!page?.instagram_business_account) {
    return c.text('no instagram business account linked', 400);
  }

  const igAccountId = page.instagram_business_account.id;
  const igRes = await fetch(
    `https://graph.facebook.com/v21.0/${igAccountId}?fields=id,username&access_token=${encodeURIComponent(page.access_token)}`,
  );
  const igAccount = (await igRes.json()) as IgAccountResponse;

  await upsertPlatformConnection({
    userId: verified.userId,
    platform: 'instagram_reels',
    exchange: {
      accessToken: page.access_token,
      refreshToken: null,
      expiresAt: longLived.expires_in
        ? new Date(Date.now() + longLived.expires_in * 1000).toISOString()
        : new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString(),
      accountId: igAccount.id,
      accountUsername: igAccount.username,
    },
  });

  clearStateCookies(c);
  return c.redirect(frontendRedirect('settings'));
});

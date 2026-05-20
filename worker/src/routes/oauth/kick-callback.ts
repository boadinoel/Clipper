import { Hono } from 'hono';
import { config } from '../../config.js';
import { encryptToken } from '../../lib/crypto.js';
import { logger } from '../../lib/logger.js';
import { supabase } from '../../lib/supabase.js';
import { inngest } from '../../inngest/client.js';
import { clearStateCookies, frontendRedirect, verifyStateCookie } from './shared.js';

export const kickOauthRoute = new Hono();

const CALLBACK_PATH = '/api/public/oauth/kick/callback';

interface KickTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
}

interface KickUserResponse {
  data: Array<{
    user_id: string;
    name: string;
    profile_picture?: string;
  }>;
}

kickOauthRoute.get(CALLBACK_PATH, async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.text('missing code/state', 400);
  if (!config.KICK_CLIENT_ID || !config.KICK_CLIENT_SECRET) {
    return c.text('kick oauth not configured', 503);
  }

  const verified = verifyStateCookie(c, state);
  if (!verified.ok || !verified.userId) {
    return c.text('invalid state', 403);
  }

  const tokenBody = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.KICK_CLIENT_ID,
    client_secret: config.KICK_CLIENT_SECRET,
    redirect_uri: `${config.FRONTEND_URL.replace(/\/$/, '')}${CALLBACK_PATH}`,
    code_verifier: c.req.query('code_verifier') ?? '',
  });

  const tokenRes = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenBody,
  });
  if (!tokenRes.ok) {
    logger.error({ status: tokenRes.status }, 'kick callback: token exchange failed');
    return c.text('token exchange failed', 502);
  }
  const tokenJson = (await tokenRes.json()) as KickTokenResponse;

  const userRes = await fetch('https://api.kick.com/public/v1/users', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) {
    logger.error({ status: userRes.status }, 'kick callback: user fetch failed');
    return c.text('user fetch failed', 502);
  }
  const userJson = (await userRes.json()) as KickUserResponse;
  const user = userJson.data?.[0];
  if (!user) return c.text('no user returned', 502);

  const { error } = await supabase()
    .from('users')
    .update({
      kick_user_id: String(user.user_id),
      kick_login: user.name.toLowerCase(),
      kick_display_name: user.name,
      kick_access_token_encrypted: encryptToken(tokenJson.access_token),
      kick_refresh_token_encrypted: encryptToken(tokenJson.refresh_token),
      kick_token_expires_at: new Date(Date.now() + tokenJson.expires_in * 1000).toISOString(),
      kick_profile_image_url: user.profile_picture ?? null,
    })
    .eq('id', verified.userId);
  if (error) {
    logger.error({ err: error.message }, 'kick callback: users update failed');
    return c.text('save failed', 500);
  }

  await inngest.send({
    name: 'profile/ingest.requested',
    data: {
      user_id: verified.userId,
      source: 'streaming',
      platform: 'kick',
      reason: 'oauth_connect',
    },
  });

  clearStateCookies(c);
  return c.redirect(frontendRedirect('onboarding'));
});

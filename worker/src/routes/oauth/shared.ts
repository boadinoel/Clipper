import { getCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { config } from '../../config.js';
import { encryptToken } from '../../lib/crypto.js';
import { supabase } from '../../lib/supabase.js';
import type { Platform } from '../../types/db.js';
import type { OAuthExchangeResult } from '../../types/platforms.js';

export function verifyStateCookie(c: Context, paramState: string): { ok: boolean; userId?: string } {
  const cookieState = getCookie(c, 'clipper_oauth_state');
  const cookieUser = getCookie(c, 'clipper_oauth_user');
  if (!cookieState || !cookieUser) return { ok: false };
  if (cookieState !== paramState) return { ok: false };
  return { ok: true, userId: cookieUser };
}

export function clearStateCookies(c: Context): void {
  deleteCookie(c, 'clipper_oauth_state', { path: '/' });
  deleteCookie(c, 'clipper_oauth_user', { path: '/' });
  deleteCookie(c, 'clipper_oauth_platform', { path: '/' });
}

export async function upsertPlatformConnection(opts: {
  userId: string;
  platform: Platform;
  exchange: OAuthExchangeResult;
}): Promise<void> {
  const row = {
    user_id: opts.userId,
    platform: opts.platform,
    account_id: opts.exchange.accountId,
    account_username: opts.exchange.accountUsername,
    access_token_encrypted: encryptToken(opts.exchange.accessToken),
    refresh_token_encrypted: opts.exchange.refreshToken
      ? encryptToken(opts.exchange.refreshToken)
      : null,
    token_expires_at: opts.exchange.expiresAt,
    is_default: true,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase()
    .from('platform_connections')
    .upsert(row, { onConflict: 'user_id,platform' });
  if (error) throw new Error(`platform_connections upsert: ${error.message}`);
}

export function buildRedirectUri(path: string): string {
  return `${config.FRONTEND_URL.replace(/\/$/, '')}${path}`;
}

export function frontendRedirect(target: 'onboarding' | 'settings'): string {
  const path = target === 'onboarding' ? '/onboarding' : '/settings/platforms';
  return `${config.FRONTEND_URL.replace(/\/$/, '')}${path}`;
}

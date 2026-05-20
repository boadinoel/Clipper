import { config } from '../config.js';
import { decryptToken, encryptToken } from './crypto.js';
import { supabase } from './supabase.js';

const KICK_API = 'https://api.kick.com/public/v1';
const KICK_OAUTH = 'https://id.kick.com/oauth';

interface KickTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
}

export async function getKickTokens(userId: string): Promise<{
  accessToken: string;
  refreshToken: string;
  kickUserId: string;
}> {
  const { data, error } = await supabase()
    .from('users')
    .select(
      'kick_user_id, kick_access_token_encrypted, kick_refresh_token_encrypted, kick_token_expires_at',
    )
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error(`kick tokens: user not found (${userId})`);
  if (
    !data.kick_user_id ||
    !data.kick_access_token_encrypted ||
    !data.kick_refresh_token_encrypted
  ) {
    throw new Error(`kick tokens: user ${userId} has no kick connection`);
  }

  let accessToken = decryptToken(data.kick_access_token_encrypted);
  const refreshToken = decryptToken(data.kick_refresh_token_encrypted);

  const expiresAt = data.kick_token_expires_at
    ? new Date(data.kick_token_expires_at).getTime()
    : 0;
  if (Date.now() + 60_000 >= expiresAt) {
    const fresh = await refreshKickToken(refreshToken);
    accessToken = fresh.accessToken;
    await supabase()
      .from('users')
      .update({
        kick_access_token_encrypted: encryptToken(fresh.accessToken),
        kick_refresh_token_encrypted: encryptToken(fresh.refreshToken),
        kick_token_expires_at: fresh.expiresAt,
      })
      .eq('id', userId);
  }

  return { accessToken, refreshToken, kickUserId: data.kick_user_id };
}

export async function refreshKickToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}> {
  if (!config.KICK_CLIENT_ID || !config.KICK_CLIENT_SECRET) {
    throw new Error('kick refresh: KICK_CLIENT_ID / KICK_CLIENT_SECRET not configured');
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.KICK_CLIENT_ID,
    client_secret: config.KICK_CLIENT_SECRET,
  });
  const res = await fetch(`${KICK_OAUTH}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`kick refresh failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as KickTokenResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export interface KickClip {
  id: string;
  url: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
  broadcaster_user_id: string;
  title: string;
  created_at: string;
}

export async function createKickClip(opts: {
  accessToken: string;
  broadcasterUserId: string;
  durationSeconds?: number;
}): Promise<KickClip> {
  const res = await fetch(`${KICK_API}/clips`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      broadcaster_user_id: opts.broadcasterUserId,
      duration: opts.durationSeconds ?? 30,
    }),
  });
  if (!res.ok) throw new Error(`kick createClip failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: KickClip };
  return json.data;
}

export async function getKickClip(opts: {
  accessToken: string;
  clipId: string;
}): Promise<KickClip | null> {
  const res = await fetch(`${KICK_API}/clips/${opts.clipId}`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`kick getClip failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { data: KickClip };
  return json.data;
}

export async function pollUntilKickClipReady(opts: {
  accessToken: string;
  clipId: string;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<KickClip> {
  const maxAttempts = opts.maxAttempts ?? 15;
  const intervalMs = opts.intervalMs ?? 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const clip = await getKickClip({ accessToken: opts.accessToken, clipId: opts.clipId });
    if (clip?.url) return clip;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`kick clip ${opts.clipId} did not resolve in time`);
}

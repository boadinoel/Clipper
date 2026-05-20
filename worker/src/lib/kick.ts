import { config } from '../config.js';
import { decryptToken, encryptToken } from './crypto.js';
import { fetchWithRetry, HttpStatusError } from './retry.js';
import { supabase } from './supabase.js';

function describeKick(tag: string, err: unknown): Error {
  if (err instanceof HttpStatusError) {
    return new Error(`${tag} failed: ${err.status} ${err.body}`);
  }
  return err instanceof Error ? err : new Error(`${tag} failed: ${String(err)}`);
}

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
  const res = await fetchWithRetry(
    `${KICK_OAUTH}/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
    { tag: 'kick.refresh' },
  ).catch((err) => {
    throw describeKick('kick refresh', err);
  });
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
  const res = await fetchWithRetry(
    `${KICK_API}/clips`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        broadcaster_user_id: opts.broadcasterUserId,
        duration: opts.durationSeconds ?? 30,
      }),
    },
    { tag: 'kick.createClip' },
  ).catch((err) => {
    throw describeKick('kick createClip', err);
  });
  const json = (await res.json()) as { data: KickClip };
  return json.data;
}

export async function getKickClip(opts: {
  accessToken: string;
  clipId: string;
}): Promise<KickClip | null> {
  const res = await fetchWithRetry(
    `${KICK_API}/clips/${opts.clipId}`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    {
      tag: 'kick.getClip',
      acceptStatus: (s) => s < 400 || s === 404,
    },
  ).catch((err) => {
    throw describeKick('kick getClip', err);
  });
  if (res.status === 404) return null;
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

export interface KickBroadcasterClip {
  id: string;
  url: string;
  broadcasterId: string;
  title: string;
  viewCount: number;
  durationSeconds: number;
  thumbnailUrl: string;
  createdAt: string;
}

interface KickClipListItem {
  id: string;
  url: string;
  broadcaster_user_id: string;
  title: string;
  view_count?: number;
  duration: number;
  thumbnail_url?: string;
  created_at: string;
}

export async function listBroadcasterClips(opts: {
  accessToken: string;
  broadcasterUserId: string;
  mode: 'most_viewed' | 'most_recent';
  first?: number;
}): Promise<KickBroadcasterClip[]> {
  const url = new URL(`${KICK_API}/clips`);
  url.searchParams.set('broadcaster_user_id', opts.broadcasterUserId);
  url.searchParams.set('limit', String(Math.min(50, opts.first ?? 20)));
  url.searchParams.set('sort', opts.mode === 'most_viewed' ? 'view_count' : 'created_at');
  url.searchParams.set('order', 'desc');
  const res = await fetchWithRetry(
    url.toString(),
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    { tag: 'kick.listClips' },
  ).catch((err) => {
    throw describeKick('kick listClips', err);
  });
  const json = (await res.json()) as { data: KickClipListItem[] };
  return (json.data ?? []).map<KickBroadcasterClip>((c) => ({
    id: c.id,
    url: c.url,
    broadcasterId: c.broadcaster_user_id,
    title: c.title,
    viewCount: c.view_count ?? 0,
    durationSeconds: c.duration,
    thumbnailUrl: c.thumbnail_url ?? '',
    createdAt: c.created_at,
  }));
}

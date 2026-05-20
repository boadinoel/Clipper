import { config } from '../config.js';
import type { UserRow } from '../types/db.js';
import { decryptToken, encryptToken } from './crypto.js';
import { logger } from './logger.js';
import { fetchWithRetry, HttpStatusError } from './retry.js';
import { supabase } from './supabase.js';

function describe(tag: string, err: unknown): Error {
  if (err instanceof HttpStatusError) {
    return new Error(`${tag} failed: ${err.status} ${err.body}`);
  }
  return err instanceof Error ? err : new Error(`${tag} failed: ${String(err)}`);
}

const HELIX = 'https://api.twitch.tv/helix';
const OAUTH = 'https://id.twitch.tv/oauth2';

interface RefreshResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string[];
  token_type?: string;
}

export async function getTwitchTokens(userId: string): Promise<{
  accessToken: string;
  refreshToken: string;
  twitchUserId: string;
}> {
  const { data, error } = await supabase()
    .from('users')
    .select(
      'twitch_user_id, twitch_access_token_encrypted, twitch_refresh_token_encrypted, twitch_token_expires_at',
    )
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error(`twitch tokens: user not found (${userId})`);
  if (
    !data.twitch_user_id ||
    !data.twitch_access_token_encrypted ||
    !data.twitch_refresh_token_encrypted
  ) {
    throw new Error(`twitch tokens: user ${userId} has no twitch connection`);
  }

  let accessToken = decryptToken(data.twitch_access_token_encrypted);
  const refreshToken = decryptToken(data.twitch_refresh_token_encrypted);

  const expiresAt = data.twitch_token_expires_at
    ? new Date(data.twitch_token_expires_at).getTime()
    : 0;
  const skewMs = 60_000;
  if (Date.now() + skewMs >= expiresAt) {
    const fresh = await refreshTwitchToken(refreshToken);
    accessToken = fresh.accessToken;
    await supabase()
      .from('users')
      .update({
        twitch_access_token_encrypted: encryptToken(fresh.accessToken),
        twitch_refresh_token_encrypted: encryptToken(fresh.refreshToken),
        twitch_token_expires_at: fresh.expiresAt,
      })
      .eq('id', userId);
  }

  return { accessToken, refreshToken, twitchUserId: data.twitch_user_id };
}

export async function refreshTwitchToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: config.TWITCH_CLIENT_ID,
    client_secret: config.TWITCH_CLIENT_SECRET,
  });
  const res = await fetchWithRetry(
    `${OAUTH}/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
    { tag: 'twitch.refresh' },
  ).catch((err) => {
    throw describe('twitch refresh', err);
  });
  const json = (await res.json()) as RefreshResponse;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
}

export interface CreatedClip {
  id: string;
  edit_url?: string;
}

export async function createTwitchClip(opts: {
  accessToken: string;
  broadcasterId: string;
  hasDelay?: boolean;
}): Promise<CreatedClip> {
  const url = new URL(`${HELIX}/clips`);
  url.searchParams.set('broadcaster_id', opts.broadcasterId);
  if (opts.hasDelay) url.searchParams.set('has_delay', 'true');
  const res = await fetchWithRetry(
    url.toString(),
    { method: 'POST', headers: helixHeaders(opts.accessToken) },
    { tag: 'twitch.createClip' },
  ).catch((err) => {
    throw describe('twitch createClip', err);
  });
  const json = (await res.json()) as { data: CreatedClip[] };
  const clip = json.data?.[0];
  if (!clip) throw new Error('twitch createClip: empty response');
  return clip;
}

export interface ResolvedClip {
  id: string;
  url: string;
  thumbnail_url: string;
  duration: number;
  vod_offset: number | null;
  broadcaster_id: string;
  game_id: string | null;
  title: string;
  created_at: string;
}

export async function getTwitchClip(opts: {
  accessToken: string;
  clipId: string;
}): Promise<ResolvedClip | null> {
  const url = new URL(`${HELIX}/clips`);
  url.searchParams.set('id', opts.clipId);
  const res = await fetchWithRetry(
    url.toString(),
    { headers: helixHeaders(opts.accessToken) },
    { tag: 'twitch.getClip' },
  ).catch((err) => {
    throw describe('twitch getClip', err);
  });
  const json = (await res.json()) as { data: ResolvedClip[] };
  return json.data?.[0] ?? null;
}

export async function pollUntilClipReady(opts: {
  accessToken: string;
  clipId: string;
  maxAttempts?: number;
  intervalMs?: number;
}): Promise<ResolvedClip> {
  const maxAttempts = opts.maxAttempts ?? 12;
  const intervalMs = opts.intervalMs ?? 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const clip = await getTwitchClip({ accessToken: opts.accessToken, clipId: opts.clipId });
    if (clip?.url) return clip;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`twitch clip ${opts.clipId} did not resolve in time`);
}

export interface HelixStream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: 'live' | '';
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
}

export async function getStreamsByUserIds(opts: {
  accessToken: string;
  userIds: string[];
}): Promise<HelixStream[]> {
  if (opts.userIds.length === 0) return [];
  const url = new URL(`${HELIX}/streams`);
  for (const id of opts.userIds.slice(0, 100)) url.searchParams.append('user_id', id);
  const res = await fetchWithRetry(
    url.toString(),
    { headers: helixHeaders(opts.accessToken) },
    { tag: 'twitch.getStreams' },
  ).catch((err) => {
    throw describe('twitch getStreams', err);
  });
  const json = (await res.json()) as { data: HelixStream[] };
  return json.data ?? [];
}

export interface BroadcasterClip {
  id: string;
  url: string;
  embedUrl: string;
  broadcasterId: string;
  title: string;
  viewCount: number;
  durationSeconds: number;
  vodOffsetSeconds: number | null;
  thumbnailUrl: string;
  createdAt: string;
}

interface HelixClip {
  id: string;
  url: string;
  embed_url: string;
  broadcaster_id: string;
  title: string;
  view_count: number;
  duration: number;
  vod_offset: number | null;
  thumbnail_url: string;
  created_at: string;
}

export async function listBroadcasterClips(opts: {
  accessToken: string;
  broadcasterId: string;
  mode: 'most_viewed' | 'most_recent';
  first?: number;
}): Promise<BroadcasterClip[]> {
  const url = new URL(`${HELIX}/clips`);
  url.searchParams.set('broadcaster_id', opts.broadcasterId);
  url.searchParams.set('first', String(Math.min(100, opts.first ?? 20)));
  if (opts.mode === 'most_recent') {
    const startedAt = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    url.searchParams.set('started_at', startedAt);
  }
  const res = await fetchWithRetry(
    url.toString(),
    { headers: helixHeaders(opts.accessToken) },
    { tag: 'twitch.listClips' },
  ).catch((err) => {
    throw describe('twitch listClips', err);
  });
  const json = (await res.json()) as { data: HelixClip[] };
  const clips = (json.data ?? []).map<BroadcasterClip>((c) => ({
    id: c.id,
    url: c.url,
    embedUrl: c.embed_url,
    broadcasterId: c.broadcaster_id,
    title: c.title,
    viewCount: c.view_count,
    durationSeconds: c.duration,
    vodOffsetSeconds: c.vod_offset,
    thumbnailUrl: c.thumbnail_url,
    createdAt: c.created_at,
  }));
  if (opts.mode === 'most_recent') {
    clips.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return clips;
}

export async function getAppAccessToken(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.TWITCH_CLIENT_ID,
    client_secret: config.TWITCH_CLIENT_SECRET,
  });
  const res = await fetchWithRetry(
    `${OAUTH}/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
    { tag: 'twitch.appToken' },
  ).catch((err) => {
    throw describe('twitch app token', err);
  });
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

function helixHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Client-Id': config.TWITCH_CLIENT_ID,
  };
}

export async function getConnectedTwitchUsers(): Promise<UserRow[]> {
  const { data, error } = await supabase()
    .from('users')
    .select('*')
    .not('twitch_user_id', 'is', null);
  if (error) {
    logger.error({ err: error.message }, 'getConnectedTwitchUsers failed');
    return [];
  }
  return (data ?? []) as UserRow[];
}

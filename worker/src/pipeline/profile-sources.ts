import { decryptToken } from '../lib/crypto.js';
import { resolveHandle } from '../lib/handle-resolve.js';
import { listMediaForConnection } from '../lib/instagram-list.js';
import { listBroadcasterClips as listKickClips } from '../lib/kick.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { listVideosForConnection as listTikTokVideos } from '../lib/tiktok-list.js';
import {
  getAppAccessToken,
  listBroadcasterClips as listTwitchClips,
} from '../lib/twitch.js';
import { listVideosForConnection as listYouTubeVideos } from '../lib/youtube-list.js';
import { listTweetsForConnection } from '../lib/x-list.js';
import type {
  HandlePlatform,
  Platform,
  PlatformConnectionRow,
  ReferenceClassification,
  ReferencePending,
  ReferencePlatform,
  StyleProfileRow,
  UserRow,
} from '../types/db.js';

const GLOBAL_CAP = 50;

export interface RawSample {
  url: string;
  platform: ReferencePlatform;
  classification: ReferenceClassification;
  title?: string;
  viewCount?: number;
  durationSeconds?: number;
}

export interface ResolveSourcesArgs {
  userId: string;
  source: 'streaming' | 'social' | 'full';
  platform?: Platform | 'twitch' | 'kick';
}

export interface ResolveResult {
  samples: RawSample[];
  pendingConsumed: ReferencePending | null;
  styleProfile: StyleProfileRow | null;
}

export async function resolveSources(args: ResolveSourcesArgs): Promise<ResolveResult> {
  const [{ data: user }, { data: profile }, { data: connections }] = await Promise.all([
    supabase().from('users').select('*').eq('id', args.userId).single(),
    supabase().from('style_profiles').select('*').eq('user_id', args.userId).maybeSingle(),
    supabase().from('platform_connections').select('*').eq('user_id', args.userId),
  ]);

  if (!user) throw new Error(`resolveSources: user ${args.userId} not found`);

  const userRow = user as UserRow;
  const styleProfile = (profile as StyleProfileRow | null) ?? null;
  const platformConnections = (connections ?? []) as PlatformConnectionRow[];
  const pending = styleProfile?.reference_pending ?? null;

  const want = (kind: 'streaming' | 'social', plat?: Platform | 'twitch' | 'kick'): boolean => {
    if (args.source === 'full') return true;
    if (args.source !== kind) return false;
    if (!args.platform) return true;
    return args.platform === plat;
  };

  const samples: RawSample[] = [];

  if (want('streaming', 'twitch') && userRow.twitch_user_id && userRow.twitch_access_token_encrypted) {
    await safeCollect('twitch', samples, () => collectTwitch(userRow));
  }
  if (want('streaming', 'kick') && userRow.kick_user_id && userRow.kick_access_token_encrypted) {
    await safeCollect('kick', samples, () => collectKick(userRow));
  }

  for (const conn of platformConnections) {
    if (!want('social', conn.platform)) continue;
    await safeCollect(conn.platform, samples, () => collectSocial(conn));
  }

  if (pending) {
    for (const u of pending.urls ?? []) {
      samples.push({
        url: u.url,
        platform: detectPlatform(u.url),
        classification: u.classification,
      });
    }
    for (const h of pending.handles ?? []) {
      await safeCollect(`handle:${h.platform}`, samples, async () => {
        const resolved = await resolveHandle({
          platform: h.platform,
          handle: h.handle,
          limit: 30,
        });
        return resolved.map<RawSample>((r) => ({
          url: r.url,
          platform: handlePlatformToReference(h.platform),
          classification: h.classification,
          title: r.title,
          viewCount: r.viewCount,
          durationSeconds: r.durationSeconds,
        }));
      });
    }
  }

  const deduped = dedupe(samples);
  const capped = pickCapped(deduped, GLOBAL_CAP);

  return { samples: capped, pendingConsumed: pending, styleProfile };
}

async function collectTwitch(user: UserRow): Promise<RawSample[]> {
  const token = await mintTwitchAppToken();
  const broadcasterId = user.twitch_user_id!;
  const [popular, recent] = await Promise.all([
    listTwitchClips({ accessToken: token, broadcasterId, mode: 'most_viewed', first: 20 }),
    listTwitchClips({ accessToken: token, broadcasterId, mode: 'most_recent', first: 20 }),
  ]);
  return [...popular, ...recent].map<RawSample>((c) => ({
    url: c.url,
    platform: 'twitch',
    classification: 'self',
    title: c.title,
    viewCount: c.viewCount,
    durationSeconds: c.durationSeconds,
  }));
}

async function collectKick(user: UserRow): Promise<RawSample[]> {
  const token = decryptToken(user.kick_access_token_encrypted!);
  const broadcasterUserId = user.kick_user_id!;
  const [popular, recent] = await Promise.all([
    listKickClips({ accessToken: token, broadcasterUserId, mode: 'most_viewed', first: 20 }),
    listKickClips({ accessToken: token, broadcasterUserId, mode: 'most_recent', first: 20 }),
  ]);
  return [...popular, ...recent].map<RawSample>((c) => ({
    url: c.url,
    platform: 'kick',
    classification: 'self',
    title: c.title,
    viewCount: c.viewCount,
    durationSeconds: c.durationSeconds,
  }));
}

async function collectSocial(conn: PlatformConnectionRow): Promise<RawSample[]> {
  const token = decryptToken(conn.access_token_encrypted);
  switch (conn.platform) {
    case 'tiktok': {
      const videos = await listTikTokVideos({ accessToken: token, openId: conn.account_id, maxCount: 40 });
      return videos.map<RawSample>((v) => ({
        url: v.url,
        platform: 'tiktok',
        classification: 'self',
        title: v.title,
        viewCount: v.viewCount,
        durationSeconds: v.durationSeconds,
      }));
    }
    case 'youtube_shorts': {
      const [popular, recent] = await Promise.all([
        listYouTubeVideos({ accessToken: token, mode: 'most_viewed', maxResults: 20 }),
        listYouTubeVideos({ accessToken: token, mode: 'most_recent', maxResults: 20 }),
      ]);
      return [...popular, ...recent].map<RawSample>((v) => ({
        url: v.url,
        platform: 'youtube',
        classification: 'self',
        title: v.title,
        viewCount: v.viewCount,
        durationSeconds: v.durationSeconds,
      }));
    }
    case 'instagram_reels': {
      const items = await listMediaForConnection({
        accessToken: token,
        accountId: conn.account_id,
        limit: 40,
      });
      return items.map<RawSample>((m) => ({
        url: m.url,
        platform: 'instagram',
        classification: 'self',
        title: m.caption.slice(0, 200),
        viewCount: m.viewCount,
        durationSeconds: m.durationSeconds,
      }));
    }
    case 'x': {
      const tweets = await listTweetsForConnection({
        accessToken: token,
        userId: conn.account_id,
        maxResults: 40,
        handle: conn.account_username,
      });
      return tweets.map<RawSample>((t) => ({
        url: t.url,
        platform: 'x',
        classification: 'self',
        title: t.text.slice(0, 200),
        viewCount: t.viewCount,
      }));
    }
  }
}

async function safeCollect(
  label: string,
  bucket: RawSample[],
  fn: () => Promise<RawSample[]>,
): Promise<void> {
  try {
    const out = await fn();
    bucket.push(...out);
  } catch (err) {
    logger.warn(
      { source: label, err: err instanceof Error ? err.message : String(err) },
      'profile source collect failed',
    );
  }
}

async function mintTwitchAppToken(): Promise<string> {
  return getAppAccessToken();
}

function dedupe(samples: RawSample[]): RawSample[] {
  const seen = new Map<string, RawSample>();
  for (const s of samples) {
    const key = canonicalUrl(s.url);
    const existing = seen.get(key);
    if (!existing || (s.viewCount ?? 0) > (existing.viewCount ?? 0)) {
      seen.set(key, s);
    }
  }
  return Array.from(seen.values());
}

function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url.toLowerCase();
  }
}

function pickCapped(samples: RawSample[], cap: number): RawSample[] {
  if (samples.length <= cap) return samples;
  samples.sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  return samples.slice(0, cap);
}

function detectPlatform(url: string): ReferencePlatform {
  try {
    const host = new URL(url).host.toLowerCase();
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('youtube') || host.includes('youtu.be')) return 'youtube';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('twitter') || host.includes('x.com')) return 'x';
    if (host.includes('twitch')) return 'twitch';
    if (host.includes('kick')) return 'kick';
    return 'other';
  } catch {
    return 'other';
  }
}

function handlePlatformToReference(p: HandlePlatform): ReferencePlatform {
  return p === 'tiktok' ? 'tiktok' : 'youtube';
}

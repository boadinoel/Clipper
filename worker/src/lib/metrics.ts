import type { Platform, PostMetricsSnapshot } from '../types/db.js';
import { decryptToken } from './crypto.js';
import { fetchInstagramMetrics } from './instagram-metrics.js';
import { supabase } from './supabase.js';
import { fetchTikTokMetrics } from './tiktok-metrics.js';
import { fetchXMetrics } from './x-metrics.js';
import { fetchYouTubeMetrics } from './youtube-metrics.js';

export async function fetchPostMetrics(opts: {
  userId: string;
  platform: Platform;
  externalPostId: string;
}): Promise<PostMetricsSnapshot> {
  const accessToken = await loadAccessToken(opts.userId, opts.platform);
  switch (opts.platform) {
    case 'tiktok':
      return fetchTikTokMetrics({ accessToken, externalPostId: opts.externalPostId });
    case 'youtube_shorts':
      return fetchYouTubeMetrics({ accessToken, externalPostId: opts.externalPostId });
    case 'instagram_reels':
      return fetchInstagramMetrics({ accessToken, externalPostId: opts.externalPostId });
    case 'x':
      return fetchXMetrics({ accessToken, externalPostId: opts.externalPostId });
  }
}

async function loadAccessToken(userId: string, platform: Platform): Promise<string> {
  const { data, error } = await supabase()
    .from('platform_connections')
    .select('access_token_encrypted')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('is_default', true)
    .maybeSingle();
  if (error || !data) {
    const { data: fallback } = await supabase()
      .from('platform_connections')
      .select('access_token_encrypted')
      .eq('user_id', userId)
      .eq('platform', platform)
      .limit(1)
      .maybeSingle();
    if (!fallback) {
      throw new Error(`no platform_connection for user=${userId} platform=${platform}`);
    }
    return decryptToken(fallback.access_token_encrypted);
  }
  return decryptToken(data.access_token_encrypted);
}

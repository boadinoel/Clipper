import type { PostMetricsSnapshot } from '../types/db.js';
import { fetchWithRetry, HttpStatusError } from './retry.js';

const YT = 'https://www.googleapis.com/youtube/v3';

interface VideosResponse {
  items?: Array<{
    id: string;
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
      favoriteCount?: string;
    };
  }>;
}

export async function fetchYouTubeMetrics(opts: {
  accessToken: string;
  externalPostId: string;
}): Promise<PostMetricsSnapshot> {
  const url =
    `${YT}/videos?` +
    new URLSearchParams({ id: opts.externalPostId, part: 'statistics' });
  const res = await fetchWithRetry(
    url,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    { tag: 'youtube.metrics' },
  ).catch((err) => {
    if (err instanceof HttpStatusError) {
      throw new Error(`youtube metrics: ${err.status} ${err.body}`);
    }
    throw err;
  });
  const json = (await res.json()) as VideosResponse;
  const item = json.items?.[0];
  const stats = item?.statistics ?? {};
  return {
    views: Number(stats.viewCount ?? 0),
    likes: stats.likeCount != null ? Number(stats.likeCount) : undefined,
    comments: stats.commentCount != null ? Number(stats.commentCount) : undefined,
    saves: stats.favoriteCount != null ? Number(stats.favoriteCount) : undefined,
    raw: stats as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
  };
}

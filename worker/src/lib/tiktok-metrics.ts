import type { PostMetricsSnapshot } from '../types/db.js';
import { fetchWithRetry, HttpStatusError } from './retry.js';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

interface VideoQueryResponse {
  data?: {
    videos?: Array<{
      id?: string;
      view_count?: number;
      like_count?: number;
      comment_count?: number;
      share_count?: number;
    }>;
  };
  error?: { code?: string; message?: string };
}

export async function fetchTikTokMetrics(opts: {
  accessToken: string;
  externalPostId: string;
}): Promise<PostMetricsSnapshot> {
  const res = await fetchWithRetry(
    `${TIKTOK_API}/video/query/?fields=id,view_count,like_count,comment_count,share_count`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ filters: { video_ids: [opts.externalPostId] } }),
    },
    { tag: 'tiktok.metrics' },
  ).catch((err) => {
    if (err instanceof HttpStatusError) {
      throw new Error(`tiktok metrics: ${err.status} ${err.body}`);
    }
    throw err;
  });
  const json = (await res.json()) as VideoQueryResponse;
  if (json.error?.code && json.error.code !== 'ok') {
    throw new Error(`tiktok metrics error: ${json.error.message ?? json.error.code}`);
  }
  const v = json.data?.videos?.[0] ?? {};
  return {
    views: v.view_count ?? 0,
    likes: v.like_count,
    comments: v.comment_count,
    shares: v.share_count,
    raw: v as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
  };
}

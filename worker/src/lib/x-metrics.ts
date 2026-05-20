import type { PostMetricsSnapshot } from '../types/db.js';
import { fetchWithRetry, HttpStatusError } from './retry.js';

const X_API = 'https://api.twitter.com/2';

interface TweetResponse {
  data?: {
    id: string;
    public_metrics?: {
      impression_count?: number;
      like_count?: number;
      reply_count?: number;
      retweet_count?: number;
      quote_count?: number;
      bookmark_count?: number;
    };
    non_public_metrics?: { impression_count?: number };
    organic_metrics?: { impression_count?: number };
  };
}

export async function fetchXMetrics(opts: {
  accessToken: string;
  externalPostId: string;
}): Promise<PostMetricsSnapshot> {
  const params = new URLSearchParams({
    'tweet.fields': 'public_metrics,non_public_metrics,organic_metrics',
  });
  const res = await fetchWithRetry(
    `${X_API}/tweets/${opts.externalPostId}?${params}`,
    { headers: { Authorization: `Bearer ${opts.accessToken}` } },
    { tag: 'x.metrics' },
  ).catch((err) => {
    if (err instanceof HttpStatusError) {
      throw new Error(`x metrics: ${err.status} ${err.body}`);
    }
    throw err;
  });
  const json = (await res.json()) as TweetResponse;
  const pm = json.data?.public_metrics ?? {};
  const impressions =
    json.data?.organic_metrics?.impression_count ??
    json.data?.non_public_metrics?.impression_count ??
    pm.impression_count ??
    0;
  return {
    views: impressions,
    likes: pm.like_count,
    comments: pm.reply_count,
    shares: pm.retweet_count,
    saves: pm.bookmark_count,
    raw: pm as Record<string, unknown>,
    fetched_at: new Date().toISOString(),
  };
}

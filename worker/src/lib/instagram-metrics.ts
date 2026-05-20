import type { PostMetricsSnapshot } from '../types/db.js';
import { fetchWithRetry, HttpStatusError } from './retry.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

interface InsightsResponse {
  data?: Array<{ name: string; values?: Array<{ value?: number }> }>;
}

export async function fetchInstagramMetrics(opts: {
  accessToken: string;
  externalPostId: string;
}): Promise<PostMetricsSnapshot> {
  const url =
    `${GRAPH}/${opts.externalPostId}/insights?` +
    new URLSearchParams({
      metric: 'reach,plays,likes,comments,shares,saved',
      access_token: opts.accessToken,
    });
  const res = await fetchWithRetry(url, undefined, { tag: 'instagram.metrics' }).catch((err) => {
    if (err instanceof HttpStatusError) {
      throw new Error(`instagram metrics: ${err.status} ${err.body}`);
    }
    throw err;
  });
  const json = (await res.json()) as InsightsResponse;
  const valueOf = (name: string): number => {
    const entry = json.data?.find((d) => d.name === name);
    return entry?.values?.[0]?.value ?? 0;
  };
  const plays = valueOf('plays');
  const reach = valueOf('reach');
  return {
    views: plays > 0 ? plays : reach,
    likes: valueOf('likes'),
    comments: valueOf('comments'),
    shares: valueOf('shares'),
    saves: valueOf('saved'),
    raw: { plays, reach, likes: valueOf('likes'), comments: valueOf('comments') },
    fetched_at: new Date().toISOString(),
  };
}

const GRAPH = 'https://graph.facebook.com/v21.0';

export interface InstagramMedia {
  id: string;
  url: string;
  caption: string;
  viewCount: number;
  durationSeconds: number;
  createdAt: string;
}

interface MediaResponse {
  data?: Array<{
    id: string;
    media_type: string;
    media_url?: string;
    permalink?: string;
    timestamp?: string;
    caption?: string;
    like_count?: number;
    comments_count?: number;
  }>;
  paging?: { next?: string };
}

export async function listMediaForConnection(opts: {
  accessToken: string;
  accountId: string;
  limit?: number;
}): Promise<InstagramMedia[]> {
  const limit = Math.min(50, opts.limit ?? 40);
  const url =
    `${GRAPH}/${opts.accountId}/media?` +
    new URLSearchParams({
      fields:
        'id,media_type,media_url,permalink,timestamp,caption,like_count,comments_count',
      limit: String(limit),
      access_token: opts.accessToken,
    });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`instagram media: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as MediaResponse;
  return (json.data ?? [])
    .filter((m) => m.media_type === 'VIDEO' || m.media_type === 'REELS')
    .map<InstagramMedia>((m) => ({
      id: m.id,
      url: m.permalink ?? m.media_url ?? '',
      caption: m.caption ?? '',
      viewCount: (m.like_count ?? 0) + (m.comments_count ?? 0),
      durationSeconds: 0,
      createdAt: m.timestamp ?? '',
    }))
    .filter((m) => m.url.length > 0);
}

const X_API = 'https://api.twitter.com/2';

export interface XPost {
  id: string;
  url: string;
  text: string;
  viewCount: number;
  createdAt: string;
}

interface TimelineResponse {
  data?: Array<{
    id: string;
    text: string;
    created_at?: string;
    public_metrics?: {
      impression_count?: number;
      like_count?: number;
      reply_count?: number;
      retweet_count?: number;
    };
    attachments?: { media_keys?: string[] };
  }>;
  includes?: {
    media?: Array<{ media_key: string; type: string }>;
  };
}

export async function listTweetsForConnection(opts: {
  accessToken: string;
  userId: string;
  maxResults?: number;
  handle?: string;
}): Promise<XPost[]> {
  const maxResults = Math.min(100, Math.max(5, opts.maxResults ?? 40));
  const params = new URLSearchParams({
    max_results: String(maxResults),
    'tweet.fields': 'public_metrics,created_at,attachments',
    expansions: 'attachments.media_keys',
    'media.fields': 'type',
    exclude: 'retweets,replies',
  });
  const res = await fetch(`${X_API}/users/${opts.userId}/tweets?${params}`, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!res.ok) throw new Error(`x timeline: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as TimelineResponse;

  const videoMediaKeys = new Set(
    (json.includes?.media ?? []).filter((m) => m.type === 'video').map((m) => m.media_key),
  );
  const handlePath = opts.handle ?? 'i';
  return (json.data ?? [])
    .filter((t) => (t.attachments?.media_keys ?? []).some((k) => videoMediaKeys.has(k)))
    .map<XPost>((t) => ({
      id: t.id,
      url: `https://x.com/${handlePath}/status/${t.id}`,
      text: t.text,
      viewCount:
        t.public_metrics?.impression_count ??
        (t.public_metrics?.like_count ?? 0) + (t.public_metrics?.retweet_count ?? 0),
      createdAt: t.created_at ?? '',
    }));
}

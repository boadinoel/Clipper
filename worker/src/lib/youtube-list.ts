const YT = 'https://www.googleapis.com/youtube/v3';

export interface YouTubeVideo {
  id: string;
  url: string;
  title: string;
  viewCount: number;
  durationSeconds: number;
  createdAt: string;
}

interface SearchResponse {
  items?: Array<{
    id: { videoId?: string };
    snippet?: { title: string; publishedAt: string };
  }>;
}

interface VideosResponse {
  items?: Array<{
    id: string;
    snippet?: { title: string; publishedAt: string };
    statistics?: { viewCount?: string };
    contentDetails?: { duration?: string };
  }>;
}

export async function listVideosForConnection(opts: {
  accessToken: string;
  mode: 'most_viewed' | 'most_recent';
  maxResults?: number;
}): Promise<YouTubeVideo[]> {
  const order = opts.mode === 'most_viewed' ? 'viewCount' : 'date';
  const maxResults = Math.min(50, opts.maxResults ?? 20);

  const searchUrl = `${YT}/search?` +
    new URLSearchParams({
      forMine: 'true',
      type: 'video',
      order,
      maxResults: String(maxResults),
      part: 'id,snippet',
    });
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!searchRes.ok) {
    throw new Error(`youtube search: ${searchRes.status} ${await searchRes.text()}`);
  }
  const searchJson = (await searchRes.json()) as SearchResponse;
  const videoIds = (searchJson.items ?? [])
    .map((i) => i.id?.videoId)
    .filter((v): v is string => Boolean(v));
  if (videoIds.length === 0) return [];

  const videosUrl = `${YT}/videos?` +
    new URLSearchParams({
      id: videoIds.join(','),
      part: 'snippet,statistics,contentDetails',
    });
  const videosRes = await fetch(videosUrl, {
    headers: { Authorization: `Bearer ${opts.accessToken}` },
  });
  if (!videosRes.ok) {
    throw new Error(`youtube videos: ${videosRes.status} ${await videosRes.text()}`);
  }
  const videosJson = (await videosRes.json()) as VideosResponse;
  return (videosJson.items ?? []).map<YouTubeVideo>((v) => ({
    id: v.id,
    url: `https://www.youtube.com/watch?v=${v.id}`,
    title: v.snippet?.title ?? '',
    viewCount: Number(v.statistics?.viewCount ?? 0),
    durationSeconds: parseIsoDuration(v.contentDetails?.duration ?? 'PT0S'),
    createdAt: v.snippet?.publishedAt ?? '',
  }));
}

function parseIsoDuration(s: string): number {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(s);
  if (!m) return 0;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2] ?? 0);
  const sec = Number(m[3] ?? 0);
  return h * 3600 + min * 60 + sec;
}

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

export interface TikTokVideo {
  id: string;
  url: string;
  title: string;
  viewCount: number;
  durationSeconds: number;
  createdAt: string;
}

interface VideoListResponse {
  data: {
    videos?: Array<{
      id: string;
      share_url?: string;
      embed_link?: string;
      video_description?: string;
      title?: string;
      view_count?: number;
      duration?: number;
      create_time?: number;
    }>;
    cursor?: number;
    has_more?: boolean;
  };
  error: { code: string; message: string };
}

export async function listVideosForConnection(opts: {
  accessToken: string;
  openId: string;
  maxCount?: number;
}): Promise<TikTokVideo[]> {
  const collected: TikTokVideo[] = [];
  let cursor = 0;
  const want = Math.min(40, opts.maxCount ?? 20);
  while (collected.length < want) {
    const res = await fetch(`${TIKTOK_API}/video/list/?fields=id,title,video_description,share_url,embed_link,view_count,duration,create_time`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cursor, max_count: Math.min(20, want - collected.length) }),
    });
    if (!res.ok) throw new Error(`tiktok video.list: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as VideoListResponse;
    if (json.error?.code && json.error.code !== 'ok') {
      throw new Error(`tiktok video.list error: ${json.error.message}`);
    }
    const videos = json.data.videos ?? [];
    for (const v of videos) {
      const url = v.share_url ?? v.embed_link;
      if (!url) continue;
      collected.push({
        id: v.id,
        url,
        title: v.title ?? v.video_description ?? '',
        viewCount: v.view_count ?? 0,
        durationSeconds: v.duration ?? 0,
        createdAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : '',
      });
    }
    if (!json.data.has_more || videos.length === 0) break;
    cursor = json.data.cursor ?? cursor + videos.length;
  }
  return collected;
}

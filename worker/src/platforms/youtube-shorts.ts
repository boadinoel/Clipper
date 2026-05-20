import type { PlatformAdapter, PostVideoOpts, PostVideoResult } from '../types/platforms.js';

const UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

export const youtubeShortsAdapter: PlatformAdapter = {
  platform: 'youtube_shorts',
  async postVideo(opts: PostVideoOpts): Promise<PostVideoResult> {
    const metadata = {
      snippet: {
        title: titleFromCaption(opts.caption),
        description: `${opts.caption}\n\n#Shorts`,
        categoryId: '24',
      },
      status: {
        privacyStatus: 'public',
        selfDeclaredMadeForKids: false,
      },
    };

    const initRes = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'X-Upload-Content-Type': 'video/*',
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(metadata),
    });
    if (!initRes.ok) {
      throw new Error(`youtube init failed: ${initRes.status} ${await initRes.text()}`);
    }
    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) throw new Error('youtube init: missing Location header');

    const videoRes = await fetch(opts.videoUrl);
    if (!videoRes.ok || !videoRes.body) {
      throw new Error(`youtube source fetch failed: ${videoRes.status}`);
    }
    const buffer = Buffer.from(await videoRes.arrayBuffer());

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/*' },
      body: buffer,
    });
    if (!putRes.ok) {
      throw new Error(`youtube upload failed: ${putRes.status} ${await putRes.text()}`);
    }
    const uploaded = (await putRes.json()) as { id: string };
    return {
      externalPostId: uploaded.id,
      externalUrl: `https://www.youtube.com/shorts/${uploaded.id}`,
    };
  },
};

function titleFromCaption(caption: string): string {
  const first = caption.split('\n')[0]?.trim() ?? '';
  const stripped = first.replace(/#\w+/g, '').trim();
  const candidate = stripped.length > 0 ? stripped : 'New short';
  return candidate.slice(0, 95);
}

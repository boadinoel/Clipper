import type { PlatformAdapter, PostVideoOpts, PostVideoResult } from '../types/platforms.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

export const instagramReelsAdapter: PlatformAdapter = {
  platform: 'instagram_reels',
  async postVideo(opts: PostVideoOpts): Promise<PostVideoResult> {
    const createRes = await fetch(
      `${GRAPH}/${opts.accountId}/media?` +
        new URLSearchParams({
          media_type: 'REELS',
          video_url: opts.videoUrl,
          caption: opts.caption.slice(0, 2200),
          access_token: opts.accessToken,
        }).toString(),
      { method: 'POST' },
    );
    if (!createRes.ok) {
      throw new Error(`instagram create: ${createRes.status} ${await createRes.text()}`);
    }
    const { id: containerId } = (await createRes.json()) as { id: string };

    await waitForContainerReady(opts.accessToken, containerId);

    const publishRes = await fetch(
      `${GRAPH}/${opts.accountId}/media_publish?` +
        new URLSearchParams({
          creation_id: containerId,
          access_token: opts.accessToken,
        }).toString(),
      { method: 'POST' },
    );
    if (!publishRes.ok) {
      throw new Error(`instagram publish: ${publishRes.status} ${await publishRes.text()}`);
    }
    const { id: mediaId } = (await publishRes.json()) as { id: string };

    const permalink = await fetchPermalink(opts.accessToken, mediaId);
    return { externalPostId: mediaId, externalUrl: permalink };
  },
};

async function waitForContainerReady(token: string, containerId: string): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status_code&access_token=${encodeURIComponent(token)}`,
    );
    const json = (await res.json()) as { status_code?: string };
    if (json.status_code === 'FINISHED') return;
    if (json.status_code === 'ERROR' || json.status_code === 'EXPIRED') {
      throw new Error(`instagram container ${containerId} failed: ${json.status_code}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error('instagram container polling exhausted');
}

async function fetchPermalink(token: string, mediaId: string): Promise<string> {
  const res = await fetch(
    `${GRAPH}/${mediaId}?fields=permalink&access_token=${encodeURIComponent(token)}`,
  );
  if (!res.ok) return `https://www.instagram.com/reel/${mediaId}`;
  const { permalink } = (await res.json()) as { permalink?: string };
  return permalink ?? `https://www.instagram.com/reel/${mediaId}`;
}

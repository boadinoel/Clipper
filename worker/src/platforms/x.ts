import type { PlatformAdapter, PostVideoOpts, PostVideoResult } from '../types/platforms.js';

const UPLOAD = 'https://upload.twitter.com/1.1/media/upload.json';
const TWEET = 'https://api.twitter.com/2/tweets';
const CHUNK_BYTES = 4 * 1024 * 1024;

export const xAdapter: PlatformAdapter = {
  platform: 'x',
  async postVideo(opts: PostVideoOpts): Promise<PostVideoResult> {
    const videoBuffer = await fetchBuffer(opts.videoUrl);

    const initParams = new URLSearchParams({
      command: 'INIT',
      total_bytes: String(videoBuffer.byteLength),
      media_type: 'video/mp4',
      media_category: 'tweet_video',
    });
    const initRes = await fetch(UPLOAD, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: initParams.toString(),
    });
    if (!initRes.ok) throw new Error(`x init: ${initRes.status} ${await initRes.text()}`);
    const { media_id_string: mediaId } = (await initRes.json()) as { media_id_string: string };

    let segment = 0;
    for (let off = 0; off < videoBuffer.byteLength; off += CHUNK_BYTES, segment++) {
      const slice = videoBuffer.subarray(off, Math.min(off + CHUNK_BYTES, videoBuffer.byteLength));
      const form = new FormData();
      form.append('command', 'APPEND');
      form.append('media_id', mediaId);
      form.append('segment_index', String(segment));
      form.append(
        'media',
        new Blob([new Uint8Array(slice)], { type: 'application/octet-stream' }),
      );
      const appendRes = await fetch(UPLOAD, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.accessToken}` },
        body: form,
      });
      if (!appendRes.ok) {
        throw new Error(`x append seg ${segment}: ${appendRes.status} ${await appendRes.text()}`);
      }
    }

    const finalizeRes = await fetch(UPLOAD, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }).toString(),
    });
    if (!finalizeRes.ok) {
      throw new Error(`x finalize: ${finalizeRes.status} ${await finalizeRes.text()}`);
    }
    const finalizeJson = (await finalizeRes.json()) as {
      processing_info?: { state: string; check_after_secs?: number; error?: { message: string } };
    };
    if (finalizeJson.processing_info) {
      await pollProcessing(opts.accessToken, mediaId, finalizeJson.processing_info);
    }

    const tweetRes = await fetch(TWEET, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: opts.caption.slice(0, 280),
        media: { media_ids: [mediaId] },
      }),
    });
    if (!tweetRes.ok) {
      throw new Error(`x create tweet: ${tweetRes.status} ${await tweetRes.text()}`);
    }
    const { data } = (await tweetRes.json()) as { data: { id: string } };
    return {
      externalPostId: data.id,
      externalUrl: `https://x.com/${opts.accountId}/status/${data.id}`,
    };
  },
};

async function pollProcessing(
  token: string,
  mediaId: string,
  initial: { state: string; check_after_secs?: number; error?: { message: string } },
): Promise<void> {
  let info = initial;
  for (let i = 0; i < 30; i++) {
    if (info.state === 'succeeded') return;
    if (info.state === 'failed') throw new Error(`x media failed: ${info.error?.message}`);
    await new Promise((r) => setTimeout(r, Math.max(1, info.check_after_secs ?? 2) * 1000));
    const res = await fetch(
      `${UPLOAD}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`x status: ${res.status}`);
    const json = (await res.json()) as { processing_info?: typeof info };
    if (!json.processing_info) return;
    info = json.processing_info;
  }
  throw new Error('x media processing polling exhausted');
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch video: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

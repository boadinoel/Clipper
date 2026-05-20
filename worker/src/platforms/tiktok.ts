import type { PlatformAdapter, PostVideoOpts, PostVideoResult } from '../types/platforms.js';

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

interface InitResponse {
  data: {
    publish_id: string;
    upload_url?: string;
  };
  error: { code: string; message: string };
}

interface StatusResponse {
  data: {
    status: 'PROCESSING_UPLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED' | string;
    publicaly_available_post_id?: string[];
    fail_reason?: string;
  };
  error: { code: string; message: string };
}

export const tiktokAdapter: PlatformAdapter = {
  platform: 'tiktok',
  async postVideo(opts: PostVideoOpts): Promise<PostVideoResult> {
    const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
      method: 'POST',
      headers: bearer(opts.accessToken),
      body: JSON.stringify({
        post_info: {
          title: opts.caption.slice(0, 150),
          privacy_level: 'SELF_ONLY',
          disable_duet: false,
          disable_comment: false,
          disable_stitch: false,
        },
        source_info: {
          source: 'PULL_FROM_URL',
          video_url: opts.videoUrl,
        },
      }),
    });
    const init = (await initRes.json()) as InitResponse;
    if (!initRes.ok || init.error?.code !== 'ok') {
      throw new Error(`tiktok init failed: ${init.error?.message ?? initRes.status}`);
    }
    const publishId = init.data.publish_id;

    const status = await pollStatus(opts.accessToken, publishId);
    const externalPostId = status.data.publicaly_available_post_id?.[0] ?? publishId;
    return {
      externalPostId,
      externalUrl: `https://www.tiktok.com/@${opts.accountId}/video/${externalPostId}`,
    };
  },
};

async function pollStatus(accessToken: string, publishId: string): Promise<StatusResponse> {
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
      method: 'POST',
      headers: bearer(accessToken),
      body: JSON.stringify({ publish_id: publishId }),
    });
    const json = (await res.json()) as StatusResponse;
    if (!res.ok) throw new Error(`tiktok status: ${res.status}`);
    if (json.data.status === 'PUBLISH_COMPLETE' || json.data.status === 'SEND_TO_USER_INBOX') {
      return json;
    }
    if (json.data.status === 'FAILED') {
      throw new Error(`tiktok publish failed: ${json.data.fail_reason ?? 'unknown'}`);
    }
    await sleep(2000);
  }
  throw new Error('tiktok publish polling exhausted');
}

function bearer(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

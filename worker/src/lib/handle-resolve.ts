import { spawn } from 'node:child_process';

export interface HandleClip {
  url: string;
  title: string;
  viewCount: number;
  durationSeconds: number;
  createdAt: string;
}

type Platform = 'tiktok' | 'youtube';

export async function resolveHandle(opts: {
  platform: Platform;
  handle: string;
  limit?: number;
}): Promise<HandleClip[]> {
  const cleanHandle = opts.handle.trim().replace(/^@/, '');
  const url = buildListUrl(opts.platform, cleanHandle);
  const limit = Math.min(50, opts.limit ?? 30);

  const args = [
    '--flat-playlist',
    '--no-warnings',
    '--skip-download',
    '--playlist-end',
    String(limit),
    '-J',
    url,
  ];

  const raw = await runCapture('yt-dlp', args);
  const parsed = JSON.parse(raw) as {
    entries?: Array<{
      url?: string;
      webpage_url?: string;
      title?: string;
      view_count?: number;
      duration?: number;
      timestamp?: number;
      upload_date?: string;
    }>;
  };
  const entries = parsed.entries ?? [];
  return entries
    .map<HandleClip>((e) => ({
      url: e.webpage_url ?? e.url ?? '',
      title: e.title ?? '',
      viewCount: e.view_count ?? 0,
      durationSeconds: e.duration ?? 0,
      createdAt: e.timestamp
        ? new Date(e.timestamp * 1000).toISOString()
        : parseUploadDate(e.upload_date),
    }))
    .filter((c) => c.url.length > 0);
}

function buildListUrl(platform: Platform, handle: string): string {
  switch (platform) {
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'youtube':
      return `https://www.youtube.com/@${handle}/videos`;
  }
}

function parseUploadDate(s: string | undefined): string {
  if (!s || !/^\d{8}$/.test(s)) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`;
}

function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => (stdout += b.toString()));
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

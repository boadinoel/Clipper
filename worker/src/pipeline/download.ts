import { spawn } from 'node:child_process';

export async function downloadClipMp4(opts: { url: string; outPath: string }): Promise<void> {
  const args = [
    '-f',
    'best[ext=mp4]/best',
    '--no-warnings',
    '--no-progress',
    '--extractor-retries',
    '3',
    '--retries',
    '3',
    '--no-playlist',
    '-o',
    opts.outPath,
    opts.url,
  ];

  await run('yt-dlp', args);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (b: Buffer) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

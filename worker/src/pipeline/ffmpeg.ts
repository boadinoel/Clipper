import { spawn } from 'node:child_process';

export interface ProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
}

export async function ffprobe(inputPath: string): Promise<ProbeResult> {
  const stdout = await runCapture('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,r_frame_rate,duration',
    '-show_entries',
    'format=duration',
    '-of',
    'json',
    inputPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number; r_frame_rate?: string; duration?: string }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0] ?? {};
  const fpsParts = (stream.r_frame_rate ?? '30/1').split('/').map(Number);
  const fps = fpsParts[1] ? (fpsParts[0] ?? 0) / fpsParts[1] : 30;
  const durationSeconds = Number(stream.duration ?? parsed.format?.duration ?? '0');
  return {
    width: stream.width ?? 0,
    height: stream.height ?? 0,
    durationSeconds,
    fps,
  };
}

export function ffmpeg(args: string[]): Promise<void> {
  return runQuiet('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
}

function runQuiet(cmd: string, args: string[]): Promise<void> {
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

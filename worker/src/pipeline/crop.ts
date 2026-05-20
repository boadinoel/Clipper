import { writeFile } from 'node:fs/promises';
import type { FaceTrackResult } from './face-track.js';
import { ffmpeg, ffprobe } from './ffmpeg.js';

export async function generateThumbnail(opts: {
  inputPath: string;
  outputPath: string;
  atSeconds?: number;
}): Promise<void> {
  await ffmpeg([
    '-ss',
    String(opts.atSeconds ?? 2),
    '-i',
    opts.inputPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=720:-2',
    '-q:v',
    '3',
    opts.outputPath,
  ]);
}

export interface CropOptions {
  inputPath: string;
  outputPath: string;
  trimStart: number;
  trimEnd: number;
  faceTrack?: FaceTrackResult | null;
  sendcmdPath?: string;
}

export async function cropTo9by16(opts: CropOptions): Promise<void> {
  const probe = await ffprobe(opts.inputPath);
  const srcW = probe.width || 1920;
  const srcH = probe.height || 1080;

  const targetH = srcH;
  const targetW = Math.floor((targetH * 9) / 16);
  const cropW = Math.min(targetW, srcW);
  const maxX = Math.max(0, srcW - cropW);

  const duration = Math.max(0.5, opts.trimEnd - opts.trimStart);

  let vf: string;
  if (opts.faceTrack?.usable && opts.faceTrack.centerXPerSecond.length > 0 && opts.sendcmdPath) {
    const sendcmd = buildSendcmd({
      points: opts.faceTrack.centerXPerSecond,
      trimStart: opts.trimStart,
      trimEnd: opts.trimEnd,
      srcW,
      cropW,
      maxX,
    });
    await writeFile(opts.sendcmdPath, sendcmd, 'utf8');
    vf = `crop=${cropW}:${targetH}:0:0:enable=1,sendcmd=f=${escapeFilterPath(opts.sendcmdPath)},scale=1080:1920:flags=lanczos`;
  } else {
    const cropX = Math.floor(maxX / 2);
    vf = `crop=${cropW}:${targetH}:${cropX}:0,scale=1080:1920:flags=lanczos`;
  }

  await ffmpeg([
    '-ss',
    String(opts.trimStart),
    '-i',
    opts.inputPath,
    '-t',
    String(duration),
    '-vf',
    vf,
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    opts.outputPath,
  ]);
}

function buildSendcmd(opts: {
  points: Array<{ t: number; cx: number }>;
  trimStart: number;
  trimEnd: number;
  srcW: number;
  cropW: number;
  maxX: number;
}): string {
  const lines: string[] = [];
  for (const p of opts.points) {
    if (p.t < opts.trimStart || p.t > opts.trimEnd) continue;
    const localT = Math.max(0, p.t - opts.trimStart);
    const xCenter = p.cx * opts.srcW;
    const targetX = Math.max(0, Math.min(opts.maxX, Math.round(xCenter - opts.cropW / 2)));
    lines.push(`${localT.toFixed(3)} crop x ${targetX};`);
  }
  if (lines.length === 0) {
    lines.push(`0 crop x ${Math.floor(opts.maxX / 2)};`);
  }
  return lines.join('\n') + '\n';
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

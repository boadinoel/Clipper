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
}

export async function cropTo9by16(opts: CropOptions): Promise<void> {
  const probe = await ffprobe(opts.inputPath);
  const srcW = probe.width || 1920;
  const srcH = probe.height || 1080;

  const targetH = srcH;
  const targetW = Math.floor((targetH * 9) / 16);
  const cropW = Math.min(targetW, srcW);
  const cropX = Math.max(0, Math.floor((srcW - cropW) / 2));

  const duration = Math.max(0.5, opts.trimEnd - opts.trimStart);

  await ffmpeg([
    '-ss',
    String(opts.trimStart),
    '-i',
    opts.inputPath,
    '-t',
    String(duration),
    '-vf',
    `crop=${cropW}:${targetH}:${cropX}:0,scale=1080:1920:flags=lanczos`,
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

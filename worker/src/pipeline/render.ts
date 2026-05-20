import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { bundle } from '@remotion/bundler';
import type { EditConfig, StyleProfileRow } from '../types/db.js';
import { ffmpeg, ffprobe } from './ffmpeg.js';

interface RenderInput {
  croppedMp4Path: string;
  outputMp4Path: string;
  template: EditConfig['template'];
  hookText: string;
  captionSegments: EditConfig['caption_segments'];
  zoomMoments: EditConfig['zoom_moments'];
  styleProfile: StyleProfileRow | null;
}

let bundledServeUrl: string | null = null;

async function getBundledServeUrl(): Promise<string> {
  if (bundledServeUrl) return bundledServeUrl;
  const here = dirname(fileURLToPath(import.meta.url));
  const entry = resolve(here, '../remotion/index.ts');
  bundledServeUrl = await bundle({
    entryPoint: entry,
    onProgress: () => undefined,
  });
  return bundledServeUrl;
}

export async function renderRemotionVariant(input: RenderInput): Promise<void> {
  const probe = await ffprobe(input.croppedMp4Path);
  const fps = Math.round(probe.fps || 30);
  const durationInFrames = Math.max(1, Math.round(probe.durationSeconds * fps));

  const inputProps = {
    videoUrl: `file://${resolve(input.croppedMp4Path)}`,
    durationInFrames,
    captionSegments: input.captionSegments,
    hookText: input.hookText,
    brandPrimaryColor: input.styleProfile?.brand_primary_color ?? '#7c3aed',
    brandAccentColor: input.styleProfile?.brand_accent_color ?? '#22d3ee',
    brandFont: input.styleProfile?.brand_font ?? 'Inter',
    zoomMoments: input.zoomMoments,
  };

  const serveUrl = await getBundledServeUrl();
  const composition = await selectComposition({
    serveUrl,
    id: input.template,
    inputProps,
  });

  await renderMedia({
    composition: { ...composition, durationInFrames, fps, width: 1080, height: 1920 },
    serveUrl,
    codec: 'h264',
    outputLocation: input.outputMp4Path,
    inputProps,
    chromiumOptions: {
      enableMultiProcessOnLinux: true,
    },
  });
}

export async function renderBurnInCaptions(input: {
  croppedMp4Path: string;
  outputMp4Path: string;
  captionSegments: EditConfig['caption_segments'];
  hookText: string;
  trimStart: number;
}): Promise<void> {
  const lines = input.captionSegments.map((seg, idx) => ({
    text: seg.text.replace(/['"\\]/g, ''),
    start: Math.max(0, seg.start - input.trimStart),
    end: Math.max(0.1, seg.end - input.trimStart),
    idx,
  }));

  const filters: string[] = [];
  filters.push(
    `drawtext=text='${input.hookText.replace(/['"\\]/g, '')}':fontcolor=white:fontsize=64:` +
      `borderw=4:bordercolor=black:x=(w-text_w)/2:y=180:enable='between(t,0,1.5)'`,
  );

  for (const line of lines) {
    filters.push(
      `drawtext=text='${line.text}':fontcolor=white:fontsize=72:` +
        `borderw=6:bordercolor=black:x=(w-text_w)/2:y=h-300:` +
        `enable='between(t,${line.start},${line.end})'`,
    );
  }

  await ffmpeg([
    '-i',
    input.croppedMp4Path,
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    input.outputMp4Path,
  ]);
}

export function shouldUseRemotion(): boolean {
  return process.env.RENDERER === 'remotion';
}

export { join };

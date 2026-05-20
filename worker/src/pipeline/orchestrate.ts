import { writeFile } from 'node:fs/promises';
import { config } from '../config.js';
import { captureMessage } from '../lib/sentry.js';
import {
  clipRawPath,
  downloadToBuffer,
  draftMp4Path,
  draftThumbnailPath,
  getPublicUrl,
  uploadFile,
} from '../lib/storage.js';
import { supabase } from '../lib/supabase.js';
import type {
  CaptionSegment,
  ChatContextEntry,
  ClipRow,
  DraftRow,
  EditConfig,
  StyleProfileRow,
  TranscriptSegment,
  VariantLabel,
  ZoomMoment,
} from '../types/db.js';
import { cropTo9by16, generateThumbnail } from './crop.js';
import { detectFaces, type FaceTrackResult } from './face-track.js';
import { ffprobe } from './ffmpeg.js';
import { renderBurnInCaptions, renderRemotionVariant, shouldUseRemotion } from './render.js';
import { planVariants } from './score.js';
import { withTempDir, unlinkQuiet } from './tempdir.js';
import { transcribeClip } from './transcribe.js';

export interface PipelineDeps {
  logger: { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
}

export interface PipelineResult {
  clipId: string;
  draftIds: string[];
}

export async function runEditPipeline(
  clipId: string,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const { clip, styleProfile } = await loadContext(clipId);
  const result = await withTempDir(async (dir) => {
    const rawLocal = `${dir}/${clipId}.mp4`;
    await downloadRawToLocal(clip, rawLocal);

    const transcription = await transcribeClip({ localMp4Path: rawLocal });

    await supabase()
      .from('clips')
      .update({
        transcript: transcription.text,
        transcript_segments: transcription.segments,
      })
      .eq('id', clipId);

    const durationSeconds = transcription.duration || clip.duration_seconds || 30;

    const scoring = await planVariants({
      transcript: transcription.text,
      transcriptSegments: transcription.segments,
      chatContext: (clip.chat_context ?? []) as ChatContextEntry[],
      styleProfile,
      durationSeconds,
    });

    const placeholderDrafts = await insertRenderingDrafts(clipId, clip.user_id, scoring.variants);

    const faceTrack = await detectFaces({
      inputPath: rawLocal,
      outputJsonPath: `${dir}/${clipId}-face.json`,
    });
    deps.logger.info(
      { clip_id: clipId, face_usable: faceTrack.usable, face_reason: faceTrack.reason, samples: faceTrack.samples.length },
      'face-track result',
    );

    const draftIds: string[] = [];
    for (const [idx, variant] of scoring.variants.entries()) {
      const placeholder = placeholderDrafts[idx];
      if (!placeholder) continue;

      try {
        const result = await renderVariant({
          clipId,
          userId: clip.user_id,
          rawLocal,
          variant,
          styleProfile,
          dir,
          faceTrack,
        });
        await supabase()
          .from('drafts')
          .update({
            status: 'ready',
            output_mp4_url: result.outputMp4Url,
            output_thumbnail_url: result.outputThumbUrl,
            output_duration_seconds: result.durationSeconds,
            caption_data: variant.caption_segments,
            hook_text: variant.hook_text,
            edit_config: buildEditConfig(variant),
          })
          .eq('id', placeholder.id);
        draftIds.push(placeholder.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        deps.logger.warn({ clip_id: clipId, variant: variant.label, err: message }, 'variant render failed');
        await supabase()
          .from('drafts')
          .update({ status: 'failed', reject_reason: `render_error:${message.slice(0, 200)}` })
          .eq('id', placeholder.id);
      }
    }

    if (draftIds.length === 0) {
      throw new Error('all variants failed to render');
    }

    await supabase().from('clips').update({ status: 'ready' }).eq('id', clipId);

    return { clipId, draftIds };
  });

  const runtimeSeconds = Math.round((Date.now() - startedAt) / 1000);
  if (runtimeSeconds > config.SLOW_PIPELINE_THRESHOLD_SECONDS) {
    captureMessage('slow_pipeline', {
      level: 'warning',
      tags: { clip_id: clipId },
      extra: { runtime_seconds: runtimeSeconds, threshold: config.SLOW_PIPELINE_THRESHOLD_SECONDS },
    });
    deps.logger.warn({ clip_id: clipId, runtime_seconds: runtimeSeconds }, 'slow pipeline');
  }
  return result;
}

async function loadContext(clipId: string): Promise<{
  clip: ClipRow;
  styleProfile: StyleProfileRow | null;
}> {
  const { data: clip, error } = await supabase()
    .from('clips')
    .select('*')
    .eq('id', clipId)
    .single();
  if (error || !clip) throw new Error(`clip ${clipId} not found`);

  const { data: style } = await supabase()
    .from('style_profiles')
    .select('*')
    .eq('user_id', clip.user_id)
    .maybeSingle();

  return { clip: clip as ClipRow, styleProfile: (style as StyleProfileRow | null) ?? null };
}

async function downloadRawToLocal(clip: ClipRow, outPath: string): Promise<void> {
  const dest = clipRawPath(clip.user_id, clip.id);
  const buf = await downloadToBuffer(dest);
  await writeFile(outPath, buf);
}

async function insertRenderingDrafts(
  clipId: string,
  userId: string,
  variants: Array<{ label: VariantLabel }>,
): Promise<DraftRow[]> {
  const rows = variants.map((v) => ({
    clip_id: clipId,
    user_id: userId,
    variant_label: v.label,
    status: 'rendering' as const,
  }));
  const { data, error } = await supabase().from('drafts').insert(rows).select();
  if (error || !data) throw new Error(`insert drafts: ${error?.message ?? 'no rows returned'}`);
  return data as DraftRow[];
}

interface VariantRenderInput {
  clipId: string;
  userId: string;
  rawLocal: string;
  variant: {
    label: VariantLabel;
    hook_text: string;
    caption_segments: CaptionSegment[];
    zoom_moments: ZoomMoment[];
    template: EditConfig['template'];
    trim_start: number;
    trim_end: number;
  };
  styleProfile: StyleProfileRow | null;
  dir: string;
  faceTrack: FaceTrackResult;
}

async function renderVariant(input: VariantRenderInput): Promise<{
  outputMp4Url: string;
  outputThumbUrl: string;
  durationSeconds: number;
}> {
  const croppedPath = `${input.dir}/${input.clipId}-${input.variant.label}-cropped.mp4`;
  const finalPath = `${input.dir}/${input.clipId}-${input.variant.label}.mp4`;
  const thumbPath = `${input.dir}/${input.clipId}-${input.variant.label}.jpg`;
  const sendcmdPath = `${input.dir}/${input.clipId}-${input.variant.label}.sendcmd`;

  await cropTo9by16({
    inputPath: input.rawLocal,
    outputPath: croppedPath,
    trimStart: input.variant.trim_start,
    trimEnd: input.variant.trim_end,
    faceTrack: input.faceTrack,
    sendcmdPath,
  });

  if (shouldUseRemotion()) {
    await renderRemotionVariant({
      croppedMp4Path: croppedPath,
      outputMp4Path: finalPath,
      template: input.variant.template,
      hookText: input.variant.hook_text,
      captionSegments: input.variant.caption_segments,
      zoomMoments: input.variant.zoom_moments,
      styleProfile: input.styleProfile,
    });
  } else {
    await renderBurnInCaptions({
      croppedMp4Path: croppedPath,
      outputMp4Path: finalPath,
      captionSegments: input.variant.caption_segments,
      hookText: input.variant.hook_text,
      trimStart: input.variant.trim_start,
    });
  }

  await generateThumbnail({
    inputPath: finalPath,
    outputPath: thumbPath,
    atSeconds: Math.max(0, Math.min(2, input.variant.trim_end - input.variant.trim_start - 0.2)),
  });

  const mp4Dest = draftMp4Path(input.userId, input.clipId, input.variant.label);
  const thumbDest = draftThumbnailPath(input.userId, input.clipId, input.variant.label);
  await uploadFile({
    bucket: mp4Dest.bucket,
    path: mp4Dest.path,
    localPath: finalPath,
    contentType: 'video/mp4',
    upsert: true,
  });
  await uploadFile({
    bucket: thumbDest.bucket,
    path: thumbDest.path,
    localPath: thumbPath,
    contentType: 'image/jpeg',
    upsert: true,
  });

  const probe = await ffprobe(finalPath);
  await Promise.all([
    unlinkQuiet(croppedPath),
    unlinkQuiet(finalPath),
    unlinkQuiet(thumbPath),
    unlinkQuiet(sendcmdPath),
  ]);

  return {
    outputMp4Url: await getPublicUrl(mp4Dest),
    outputThumbUrl: await getPublicUrl(thumbDest),
    durationSeconds: probe.durationSeconds,
  };
}

function buildEditConfig(variant: {
  template: EditConfig['template'];
  caption_segments: CaptionSegment[];
  zoom_moments: ZoomMoment[];
  trim_start: number;
  trim_end: number;
  reasoning?: string;
}): EditConfig {
  return {
    template: variant.template,
    trim_start: variant.trim_start,
    trim_end: variant.trim_end,
    zoom_moments: variant.zoom_moments,
    caption_segments: variant.caption_segments,
    reasoning: variant.reasoning,
  };
}

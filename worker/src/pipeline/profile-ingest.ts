import { synthesizeReferenceProfile, type SynthesisInputSample } from '../lib/anthropic.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { transcribeFile } from '../lib/whisper.js';
import type { Platform, ReferenceClipAnalysis } from '../types/db.js';
import { downloadClipMp4 } from './download.js';
import { resolveSources, type RawSample } from './profile-sources.js';
import { unlinkQuiet, withTempDir } from './tempdir.js';

const TRANSCRIBE_CONCURRENCY = 4;
const TRANSCRIPT_EXCERPT_CHARS = 800;
const GATE_MS = 24 * 3600 * 1000;

export interface IngestArgs {
  userId: string;
  source: 'streaming' | 'social' | 'full';
  platform?: Platform | 'twitch' | 'kick';
  reason: 'oauth_connect' | 'weekly_cron' | 'manual';
}

export interface IngestResult {
  skipped: boolean;
  reason?: 'gated' | 'no_samples';
  sampleCount?: number;
}

export async function runProfileIngest(args: IngestArgs): Promise<IngestResult> {
  const resolved = await resolveSources({
    userId: args.userId,
    source: args.source,
    platform: args.platform,
  });

  const hasPending = Boolean(
    (resolved.pendingConsumed?.urls?.length ?? 0) > 0 ||
      (resolved.pendingConsumed?.handles?.length ?? 0) > 0,
  );

  if (args.reason !== 'manual' && !hasPending && isWithinGate(resolved.styleProfile?.reference_clip_analysis ?? null)) {
    logger.info({ userId: args.userId, args }, 'profile ingest skipped (gated)');
    return { skipped: true, reason: 'gated' };
  }

  if (resolved.samples.length === 0) {
    logger.warn({ userId: args.userId, args }, 'profile ingest: no samples resolved');
    return { skipped: true, reason: 'no_samples' };
  }

  return await withTempDir(async (dir) => {
    const transcribed: SynthesisInputSample[] = [];

    await runPool(resolved.samples, TRANSCRIBE_CONCURRENCY, async (sample, idx) => {
      const localPath = `${dir}/${idx}-${safeFileSlug(sample.url)}.mp4`;
      try {
        await downloadClipMp4({ url: sample.url, outPath: localPath });
      } catch (err) {
        logger.warn(
          { url: sample.url, err: err instanceof Error ? err.message : String(err) },
          'profile ingest: download failed, skipping sample',
        );
        return;
      }
      try {
        const { text, duration } = await transcribeFile({ localPath });
        transcribed.push(toSynthesisInput(sample, text, duration));
      } catch (err) {
        logger.warn(
          { url: sample.url, err: err instanceof Error ? err.message : String(err) },
          'profile ingest: transcription failed',
        );
      } finally {
        await unlinkQuiet(localPath);
      }
    });

    if (transcribed.length === 0) {
      logger.warn({ userId: args.userId }, 'profile ingest: all transcriptions failed');
      return { skipped: true, reason: 'no_samples' };
    }

    const analysis = await synthesizeReferenceProfile({
      samples: transcribed,
      styleProfile: resolved.styleProfile,
    });

    await writeAnalysis({
      userId: args.userId,
      analysis,
      hasExistingProfile: Boolean(resolved.styleProfile),
    });

    logger.info(
      { userId: args.userId, sampleCount: transcribed.length, reason: args.reason },
      'profile ingest complete',
    );
    return { skipped: false, sampleCount: transcribed.length };
  });
}

function isWithinGate(analysis: ReferenceClipAnalysis | null): boolean {
  if (!analysis?.last_synthesized_at) return false;
  const last = Date.parse(analysis.last_synthesized_at);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < GATE_MS;
}

function toSynthesisInput(
  sample: RawSample,
  transcript: string,
  whisperDuration: number,
): SynthesisInputSample {
  return {
    url: sample.url,
    platform: sample.platform,
    classification: sample.classification,
    title: sample.title,
    viewCount: sample.viewCount,
    durationSeconds: sample.durationSeconds ?? whisperDuration,
    transcript,
    transcriptExcerpt: transcript.slice(0, TRANSCRIPT_EXCERPT_CHARS),
  };
}

async function writeAnalysis(opts: {
  userId: string;
  analysis: ReferenceClipAnalysis;
  hasExistingProfile: boolean;
}): Promise<void> {
  const update: Record<string, unknown> = {
    reference_clip_urls: opts.analysis.samples.map((s) => s.url),
    reference_clip_analysis: opts.analysis,
    reference_pending: null,
  };

  if (opts.hasExistingProfile) {
    const { data: existing } = await supabase()
      .from('style_profiles')
      .select('voice_descriptor')
      .eq('user_id', opts.userId)
      .single();
    if (!existing?.voice_descriptor) {
      update.voice_descriptor = opts.analysis.voice_descriptor;
    }
    const { error } = await supabase()
      .from('style_profiles')
      .update(update)
      .eq('user_id', opts.userId);
    if (error) throw new Error(`style_profiles update: ${error.message}`);
  } else {
    update.user_id = opts.userId;
    update.voice_descriptor = opts.analysis.voice_descriptor;
    const { error } = await supabase().from('style_profiles').insert(update);
    if (error) throw new Error(`style_profiles insert: ${error.message}`);
  }
}

function safeFileSlug(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .slice(0, 60);
}

async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const next = async (): Promise<void> => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      await worker(items[idx]!, idx);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => next()));
}

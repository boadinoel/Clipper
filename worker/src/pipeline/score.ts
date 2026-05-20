import { config } from '../config.js';
import { inngest } from '../inngest/client.js';
import { scoreClipAndPlanVariants, type ScoringResult } from '../lib/anthropic.js';
import { logger } from '../lib/logger.js';
import type {
  ChatContextEntry,
  StyleProfileRow,
  TranscriptSegment,
} from '../types/db.js';

export interface ScoreInput {
  transcript: string;
  transcriptSegments: TranscriptSegment[];
  chatContext: ChatContextEntry[];
  styleProfile: StyleProfileRow | null;
  durationSeconds: number;
}

export interface PlanVariantsOptions {
  clipId?: string;
  userId?: string;
}

export async function planVariants(
  input: ScoreInput,
  opts?: PlanVariantsOptions,
): Promise<ScoringResult> {
  const result = await scoreClipAndPlanVariants(input);
  void maybeSampleForEval(input, result, opts).catch((err) => {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'eval sample dispatch failed',
    );
  });
  return result;
}

async function maybeSampleForEval(
  input: ScoreInput,
  result: ScoringResult,
  opts?: PlanVariantsOptions,
): Promise<void> {
  if (!opts?.clipId || !opts?.userId) return;
  if (config.EVAL_SAMPLE_RATE <= 0) return;
  if (Math.random() > config.EVAL_SAMPLE_RATE) return;
  await inngest.send({
    name: 'eval/sample.recorded',
    data: {
      clip_id: opts.clipId,
      user_id: opts.userId,
      golden_set_version: config.EVAL_GOLDEN_SET_VERSION,
      scoring_input: {
        transcript: input.transcript.slice(0, 2000),
        duration_seconds: input.durationSeconds,
        chat_context_count: input.chatContext.length,
        style_profile_present: input.styleProfile != null,
      },
      variants: result.variants,
    },
  });
}

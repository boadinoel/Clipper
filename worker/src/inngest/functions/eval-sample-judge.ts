import { judgeVariants } from '../../lib/eval-judge.js';
import { captureException } from '../../lib/sentry.js';
import { supabase } from '../../lib/supabase.js';
import type { StyleProfileRow } from '../../types/db.js';
import { inngest } from '../client.js';

export const evalSampleJudge = inngest.createFunction(
  {
    id: 'eval-sample-judge',
    name: 'Eval — judge a sampled production run',
    retries: 1,
    concurrency: { limit: 2 },
  },
  { event: 'eval/sample.recorded' },
  async ({ event, step, logger }) => {
    const { clip_id, user_id, golden_set_version, scoring_input, variants } = event.data;

    const styleProfile = await step.run('load-profile', async () => {
      const { data } = await supabase()
        .from('style_profiles')
        .select('voice_descriptor, humor_quiz, learned_preferences, reference_clip_analysis')
        .eq('user_id', user_id)
        .maybeSingle();
      return (data ?? null) as Pick<
        StyleProfileRow,
        'voice_descriptor' | 'humor_quiz' | 'learned_preferences' | 'reference_clip_analysis'
      > | null;
    });

    try {
      const result = await step.run('judge', () =>
        judgeVariants({
          transcript: scoring_input.transcript,
          durationSeconds: scoring_input.duration_seconds,
          styleProfile,
          variants: variants as Parameters<typeof judgeVariants>[0]['variants'],
        }),
      );

      await step.run('persist', async () => {
        const { error } = await supabase()
          .from('eval_runs')
          .insert({
            kind: 'sample',
            golden_set_version,
            clip_id,
            user_id,
            scoring_input,
            variants,
            median_scores: result.median_scores,
            per_variant_scores: result.variant_scores,
            notes: result.notes ?? null,
          });
        if (error) throw new Error(`eval_runs insert: ${error.message}`);
      });

      return { ok: true, scores: result.median_scores };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ clip_id, err: message }, 'eval sample judge failed');
      captureException(err, { tags: { fn: 'eval-sample-judge' }, extra: { clip_id } });
      throw err;
    }
  },
);

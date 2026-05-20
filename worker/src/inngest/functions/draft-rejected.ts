import { extractRejectionSignal } from '../../lib/anthropic.js';
import { supabase } from '../../lib/supabase.js';
import type { DraftRow, LearnedPreferences, StyleProfileRow } from '../../types/db.js';
import { inngest } from '../client.js';

export const draftRejected = inngest.createFunction(
  { id: 'draft-rejected', name: 'Draft — rejected (style learning)', retries: 2 },
  { event: 'draft/rejected' },
  async ({ event, step, logger }) => {
    const { draft_id, clip_id, reject_reason } = event.data;
    const userId = event.user.id;

    const draft = await step.run('load-draft', async () => {
      const { data, error } = await supabase()
        .from('drafts')
        .select('*')
        .eq('id', draft_id)
        .single();
      if (error || !data) throw new Error(`draft ${draft_id} not found`);
      return data as DraftRow;
    });

    const signal = await step.run('extract-signal', async () => {
      if (!reject_reason || reject_reason.trim().length < 3) return null;
      try {
        return await extractRejectionSignal({
          reason: reject_reason,
          template: draft.edit_config?.template ?? 'BoldCaption',
          hookText: draft.hook_text ?? '',
          captionExcerpt: (draft.caption_data ?? [])
            .slice(0, 4)
            .map((s) => s.text)
            .join(' '),
        });
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'extractRejectionSignal failed',
        );
        return null;
      }
    });

    await step.run('update-style-profile', async () => {
      const { data: profile } = await supabase()
        .from('style_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      const learned = ((profile as StyleProfileRow | null)?.learned_preferences ??
        {}) as LearnedPreferences;
      const weights = { ...(learned.template_weights ?? {}) };
      const template = draft.edit_config?.template ?? 'BoldCaption';
      weights[template] = clampWeight((weights[template] ?? 1.0) - 0.15);

      if (signal?.template_penalty) {
        const t = signal.template_penalty.template;
        weights[t] = clampWeight((weights[t] ?? 1.0) + signal.template_penalty.delta);
      }

      const disliked = new Set(learned.hook_patterns_disliked ?? []);
      for (const h of signal?.hook_patterns_disliked ?? []) disliked.add(h);

      const next: LearnedPreferences = {
        ...learned,
        template_weights: weights,
        caption_length_preference:
          signal?.caption_length_preference ?? learned.caption_length_preference,
        hook_patterns_disliked: Array.from(disliked).slice(-50),
        updated_at: new Date().toISOString(),
      };

      const upsert = profile
        ? supabase()
            .from('style_profiles')
            .update({ learned_preferences: next })
            .eq('user_id', userId)
        : supabase()
            .from('style_profiles')
            .insert({ user_id: userId, learned_preferences: next });
      const { error } = await upsert;
      if (error) throw new Error(`style_profiles upsert: ${error.message}`);
    });

    logger.info({ draft_id, clip_id, reject_reason }, 'rejection signal learned');
    return { ok: true };
  },
);

function clampWeight(w: number): number {
  return Math.max(0.1, Math.min(3.0, w));
}

import { supabase } from '../../lib/supabase.js';
import type { DraftRow, LearnedPreferences, StyleProfileRow } from '../../types/db.js';
import { inngest } from '../client.js';

export const draftApproved = inngest.createFunction(
  { id: 'draft-approved', name: 'Draft — approved (style learning)', retries: 2 },
  { event: 'draft/approved' },
  async ({ event, step, logger }) => {
    const { draft_id, clip_id } = event.data;
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
      weights[template] = clampWeight((weights[template] ?? 1.0) + 0.1);

      const hookLiked = new Set(learned.hook_patterns_liked ?? []);
      if (draft.hook_text) hookLiked.add(truncate(draft.hook_text, 120));

      const next: LearnedPreferences = {
        ...learned,
        template_weights: weights,
        hook_patterns_liked: Array.from(hookLiked).slice(-50),
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

    logger.info({ draft_id, clip_id, userId }, 'approval signal learned');
    return { ok: true };
  },
);

function clampWeight(w: number): number {
  return Math.max(0.1, Math.min(3.0, w));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

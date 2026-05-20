import { captureException } from '../../lib/sentry.js';
import { supabase } from '../../lib/supabase.js';
import type { DraftRow, LearnedPreferences, PostRow, StyleProfileRow } from '../../types/db.js';
import { inngest } from '../client.js';

const PROMOTE_THRESHOLD = 0.9;
const DEMOTE_THRESHOLD = 0.1;
const PROMOTE_WEIGHT_DELTA = 0.15;
const DEMOTE_WEIGHT_DELTA = -0.2;
const HOOK_CAP = 50;

export const metricsPostScored = inngest.createFunction(
  {
    id: 'metrics-post-scored',
    name: 'Metrics — 7-day learning loop',
    retries: 2,
    concurrency: { limit: 3, key: 'event.data.user_id' },
  },
  { event: 'metrics/post.scored' },
  async ({ event, step, logger }) => {
    const { post_id, user_id, draft_id, platform } = event.data;

    const post = await step.run('load-post', async () => {
      const { data, error } = await supabase()
        .from('posts')
        .select('*')
        .eq('id', post_id)
        .single();
      if (error || !data) throw new Error(`post ${post_id} not found`);
      return data as PostRow;
    });

    const views = (post.metrics_at_7d as { views?: number } | null)?.views ?? event.data.views ?? 0;

    const percentile = await step.run('compute-percentile', async () => {
      return computePercentile({ userId: user_id, platform, views });
    });

    await step.run('write-percentile', async () => {
      const { error } = await supabase()
        .from('posts')
        .update({ performance_percentile: percentile })
        .eq('id', post_id);
      if (error) throw new Error(`posts update percentile: ${error.message}`);
    });

    if (percentile > DEMOTE_THRESHOLD && percentile < PROMOTE_THRESHOLD) {
      logger.info({ post_id, percentile }, 'metrics-post-scored: middle band, no learning signal');
      return { ok: true, percentile, action: 'noop' as const };
    }

    const action = percentile >= PROMOTE_THRESHOLD ? ('promote' as const) : ('demote' as const);

    try {
      await step.run('apply-learning', async () => {
        await applyLearning({ userId: user_id, draftId: draft_id, action });
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ post_id, action, err: message }, 'apply-learning failed');
      captureException(err, { tags: { fn: 'metrics-post-scored', action } });
      throw err;
    }

    return { ok: true, percentile, action };
  },
);

async function computePercentile(opts: {
  userId: string;
  platform: PostRow['platform'];
  views: number;
}): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const { data } = await supabase()
    .from('posts')
    .select('metrics_at_7d')
    .eq('user_id', opts.userId)
    .eq('platform', opts.platform)
    .gte('posted_at', since)
    .not('metrics_at_7d', 'is', null);
  const samples = ((data ?? []) as Array<{ metrics_at_7d: { views?: number } | null }>)
    .map((r) => r.metrics_at_7d?.views ?? 0)
    .filter((v) => v > 0);
  return percentileFromSamples(opts.views, samples);
}

export function percentileFromSamples(views: number, samples: number[]): number {
  if (samples.length < 3) return 0.5;
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  if (median === 0) return 0.5;
  return clamp01(views / median / 2);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

async function applyLearning(opts: {
  userId: string;
  draftId: string;
  action: 'promote' | 'demote';
}): Promise<void> {
  const { data: draftData, error: draftErr } = await supabase()
    .from('drafts')
    .select('*')
    .eq('id', opts.draftId)
    .maybeSingle();
  if (draftErr) throw new Error(`load draft: ${draftErr.message}`);
  const draft = (draftData ?? null) as DraftRow | null;
  if (!draft) return;
  const template = draft.edit_config?.template ?? 'BoldCaption';
  const hookText = draft.hook_text ? truncate(draft.hook_text, 120) : null;

  const { data: profileData } = await supabase()
    .from('style_profiles')
    .select('*')
    .eq('user_id', opts.userId)
    .maybeSingle();
  const profile = (profileData ?? null) as StyleProfileRow | null;
  const learned = (profile?.learned_preferences ?? {}) as LearnedPreferences;

  const weights = { ...(learned.template_weights ?? {}) };
  const delta = opts.action === 'promote' ? PROMOTE_WEIGHT_DELTA : DEMOTE_WEIGHT_DELTA;
  weights[template] = clampWeight((weights[template] ?? 1.0) + delta);

  const liked = new Set(learned.hook_patterns_liked ?? []);
  const disliked = new Set(learned.hook_patterns_disliked ?? []);
  if (hookText) {
    if (opts.action === 'promote') {
      liked.add(hookText);
      disliked.delete(hookText);
    } else {
      disliked.add(hookText);
      liked.delete(hookText);
    }
  }

  const next: LearnedPreferences = {
    ...learned,
    template_weights: weights,
    hook_patterns_liked: Array.from(liked).slice(-HOOK_CAP),
    hook_patterns_disliked: Array.from(disliked).slice(-HOOK_CAP),
    updated_at: new Date().toISOString(),
  };

  const upsert = profile
    ? supabase().from('style_profiles').update({ learned_preferences: next }).eq('user_id', opts.userId)
    : supabase().from('style_profiles').insert({ user_id: opts.userId, learned_preferences: next });
  const { error } = await upsert;
  if (error) throw new Error(`style_profiles upsert: ${error.message}`);
}

function clampWeight(w: number): number {
  return Math.max(0.1, Math.min(3.0, w));
}
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n);
}

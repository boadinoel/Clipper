import { fetchPostMetrics } from '../../lib/metrics.js';
import { captureException } from '../../lib/sentry.js';
import { supabase } from '../../lib/supabase.js';
import type { PostMetricsSnapshot, PostRow } from '../../types/db.js';
import { inngest } from '../client.js';

const DAY_MS = 24 * 3600 * 1000;

export const metricsPostCheck = inngest.createFunction(
  {
    id: 'metrics-post-check',
    name: 'Metrics — per-post check',
    retries: 2,
    concurrency: { limit: 6 },
  },
  { event: 'metrics/post.check' },
  async ({ event, step, logger }) => {
    const { post_id } = event.data;

    const post = await step.run('load-post', async () => {
      const { data, error } = await supabase()
        .from('posts')
        .select('*')
        .eq('id', post_id)
        .single();
      if (error || !data) throw new Error(`post ${post_id} not found`);
      return data as PostRow;
    });

    if (post.status !== 'posted' || !post.posted_at || !post.external_post_id) {
      logger.info({ post_id, status: post.status }, 'metrics-post-check: skipped (not posted)');
      return { skipped: 'not_posted' as const };
    }

    let snapshot: PostMetricsSnapshot;
    try {
      snapshot = await step.run('fetch-metrics', () =>
        fetchPostMetrics({
          userId: post.user_id,
          platform: post.platform,
          externalPostId: post.external_post_id!,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ post_id, platform: post.platform, err: message }, 'metrics fetch failed');
      captureException(err, { tags: { fn: 'metrics-post-check' }, extra: { post_id, platform: post.platform } });
      await supabase()
        .from('posts')
        .update({ last_metrics_check_at: new Date().toISOString() })
        .eq('id', post_id);
      return { error: message } as const;
    }

    const ageMs = Date.now() - new Date(post.posted_at).getTime();
    const update: Partial<PostRow> = {
      metrics: snapshot,
      last_metrics_check_at: new Date().toISOString(),
    };
    let scoredFire = false;
    if (ageMs >= DAY_MS && !post.metrics_at_24h) {
      update.metrics_at_24h = snapshot;
    }
    if (ageMs >= 7 * DAY_MS && !post.metrics_at_7d) {
      update.metrics_at_7d = snapshot;
      scoredFire = true;
    }

    await step.run('write-snapshot', async () => {
      const { error } = await supabase().from('posts').update(update).eq('id', post_id);
      if (error) throw new Error(`posts update: ${error.message}`);
    });

    if (scoredFire) {
      await step.sendEvent('emit-scored', {
        name: 'metrics/post.scored',
        data: {
          post_id,
          user_id: post.user_id,
          draft_id: post.draft_id,
          platform: post.platform,
          views: snapshot.views,
          performance_percentile: 0,
        },
      });
    }

    return { ok: true, views: snapshot.views, scored: scoredFire };
  },
);

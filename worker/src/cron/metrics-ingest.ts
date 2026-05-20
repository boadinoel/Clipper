import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import type { PostRow } from '../types/db.js';
import { inngest } from '../inngest/client.js';

const RUN_LIMIT = 50;
const DAY_MS = 24 * 3600 * 1000;
const RECHECK_INTERVAL_MS = 6 * 3600 * 1000;
const MAX_AGE_MS = 8 * DAY_MS;

export const metricsIngestCron = inngest.createFunction(
  {
    id: 'metrics-ingest-cron',
    name: 'Cron — metrics ingest (15 min)',
    concurrency: { limit: 1 },
  },
  { cron: '*/15 * * * *' },
  async ({ step }) => {
    const eligible = await step.run('query-eligible', async () => {
      const horizon = new Date(Date.now() - MAX_AGE_MS).toISOString();
      const { data, error } = await supabase()
        .from('posts')
        .select('id, posted_at, last_metrics_check_at, metrics_at_24h, metrics_at_7d')
        .eq('status', 'posted')
        .gte('posted_at', horizon)
        .order('posted_at', { ascending: true })
        .limit(RUN_LIMIT * 4);
      if (error) {
        logger.warn({ err: error.message }, 'metrics-ingest-cron: query failed');
        return [];
      }
      const now = Date.now();
      const rows = (data ?? []) as Array<Pick<PostRow, 'id' | 'posted_at' | 'last_metrics_check_at' | 'metrics_at_24h' | 'metrics_at_7d'>>;
      const picked: string[] = [];
      for (const row of rows) {
        if (!row.posted_at) continue;
        if (row.metrics_at_7d) continue;
        const age = now - new Date(row.posted_at).getTime();
        const lastCheck = row.last_metrics_check_at
          ? new Date(row.last_metrics_check_at).getTime()
          : 0;
        const sinceCheck = now - lastCheck;
        const needs24h = age >= DAY_MS && !row.metrics_at_24h;
        const needs7d = age >= 7 * DAY_MS && !row.metrics_at_7d;
        const dueForRecheck = sinceCheck >= RECHECK_INTERVAL_MS;
        if (needs24h || needs7d || (lastCheck === 0 && age >= 30 * 60 * 1000) || dueForRecheck) {
          picked.push(row.id);
        }
        if (picked.length >= RUN_LIMIT) break;
      }
      return picked;
    });

    if (eligible.length === 0) {
      return { dispatched: 0 };
    }

    await step.sendEvent(
      'dispatch-checks',
      eligible.map((post_id) => ({
        name: 'metrics/post.check' as const,
        data: { post_id },
      })),
    );

    return { dispatched: eligible.length };
  },
);

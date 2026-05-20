import { logger } from '../lib/logger.js';
import { captureMessage } from '../lib/sentry.js';
import { supabase } from '../lib/supabase.js';
import { EVAL_DIMENSIONS, type DimensionScores } from '../lib/eval-judge.js';
import { inngest } from '../inngest/client.js';

const REGRESSION_DELTA = 0.5;
const WEEK_MS = 7 * 24 * 3600 * 1000;

export const evalRollupCron = inngest.createFunction(
  {
    id: 'eval-rollup-cron',
    name: 'Cron — eval rollup (weekly)',
    concurrency: { limit: 1 },
  },
  { cron: '0 6 * * 1' },
  async ({ step }) => {
    const now = Date.now();
    const lastWeek = new Date(now - WEEK_MS).toISOString();
    const priorWeek = new Date(now - 2 * WEEK_MS).toISOString();

    const [recent, prior] = await Promise.all([
      step.run('load-recent', () => loadWindowMedians(lastWeek, new Date(now).toISOString())),
      step.run('load-prior', () => loadWindowMedians(priorWeek, lastWeek)),
    ]);

    if (recent.count === 0) {
      logger.info({}, 'eval-rollup: no recent samples');
      return { recent_count: 0 };
    }

    const regressions: Array<{ dimension: string; recent: number; prior: number; delta: number }> = [];
    for (const dim of EVAL_DIMENSIONS) {
      const r = recent.medians[dim];
      const p = prior.medians[dim];
      if (!Number.isFinite(r) || !Number.isFinite(p)) continue;
      const delta = r - p;
      if (delta <= -REGRESSION_DELTA) {
        regressions.push({ dimension: dim, recent: r, prior: p, delta });
      }
    }

    if (regressions.length > 0) {
      captureMessage('eval_regression', {
        level: 'warning',
        tags: { fn: 'eval-rollup' },
        extra: { regressions, recent_count: recent.count, prior_count: prior.count },
      });
      logger.warn({ regressions }, 'eval-rollup: regressions detected');
    }

    return {
      recent_count: recent.count,
      prior_count: prior.count,
      recent_medians: recent.medians,
      prior_medians: prior.medians,
      regressions,
    };
  },
);

async function loadWindowMedians(
  fromIso: string,
  toIso: string,
): Promise<{ count: number; medians: DimensionScores }> {
  const { data, error } = await supabase()
    .from('eval_runs')
    .select('median_scores')
    .eq('kind', 'sample')
    .gte('run_at', fromIso)
    .lt('run_at', toIso)
    .limit(500);
  if (error) {
    logger.warn({ err: error.message }, 'eval-rollup: query failed');
    return { count: 0, medians: emptyMedians() };
  }
  const rows = (data ?? []) as Array<{ median_scores: DimensionScores | null }>;
  if (rows.length === 0) return { count: 0, medians: emptyMedians() };

  const acc: Record<string, number[]> = {};
  for (const dim of EVAL_DIMENSIONS) acc[dim] = [];
  for (const row of rows) {
    const m = row.median_scores;
    if (!m) continue;
    for (const dim of EVAL_DIMENSIONS) {
      const v = m[dim];
      if (typeof v === 'number' && Number.isFinite(v)) acc[dim]!.push(v);
    }
  }
  const medians = emptyMedians();
  for (const dim of EVAL_DIMENSIONS) {
    const arr = acc[dim]!;
    arr.sort((a, b) => a - b);
    medians[dim] = arr.length ? arr[Math.floor(arr.length / 2)]! : 0;
  }
  return { count: rows.length, medians };
}

function emptyMedians(): DimensionScores {
  return {
    hook_strength: 0,
    caption_timing: 0,
    variant_diversity: 0,
    style_alignment: 0,
    trim_quality: 0,
  };
}

// Reference so unused-import lint doesn't strip; the cron is registered via serve.ts.
void inngest;

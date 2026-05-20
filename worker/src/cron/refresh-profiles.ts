import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { inngest } from '../inngest/client.js';

const PAGE_SIZE = 200;
const ACTIVE_WINDOW_DAYS = 14;

export const refreshProfilesCron = inngest.createFunction(
  {
    id: 'refresh-profiles-cron',
    name: 'Cron — weekly profile refresh',
    concurrency: { limit: 1 },
  },
  { cron: '0 7 * * 1' },
  async ({ step }) => {
    const userIds = await step.run('collect-active-users', async () => {
      const since = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 3600 * 1000).toISOString();
      const ids = new Set<string>();

      let offset = 0;
      while (true) {
        const { data, error } = await supabase()
          .from('streams')
          .select('user_id')
          .gte('started_at', since)
          .order('started_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) {
          logger.warn({ err: error.message }, 'refresh-profiles: stream query failed');
          break;
        }
        const page = (data ?? []) as Array<{ user_id: string }>;
        for (const row of page) ids.add(row.user_id);
        if (page.length < PAGE_SIZE) break;
        offset += PAGE_SIZE;
      }
      return Array.from(ids);
    });

    if (userIds.length === 0) {
      logger.info({}, 'refresh-profiles: no active users');
      return { fired: 0 };
    }

    let fired = 0;
    for (const userId of userIds) {
      await step.sendEvent(`fire-${userId}`, {
        name: 'profile/ingest.requested',
        data: { user_id: userId, source: 'full', reason: 'weekly_cron' },
      });
      fired++;
    }

    logger.info({ fired }, 'refresh-profiles cron fired ingest events');
    return { fired };
  },
);

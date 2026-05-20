import { supabase } from '../../lib/supabase.js';
import { inngest } from '../client.js';
import type { PostRow } from '../../types/db.js';

export const postScheduledAck = inngest.createFunction(
  { id: 'post-scheduled-ack', name: 'Post — scheduled ack' },
  { event: 'post/scheduled' },
  async ({ event, logger }) => {
    logger.info(
      {
        draft_id: event.data.draft_id,
        schedule_for: event.data.schedule_for,
        platforms: event.data.platforms,
      },
      'post scheduled — cron will publish',
    );
    return { acknowledged: true };
  },
);

export const postScheduledCron = inngest.createFunction(
  {
    id: 'post-scheduled-cron',
    name: 'Post — scheduled publisher (cron)',
    concurrency: { limit: 1 },
  },
  { cron: '* * * * *' },
  async ({ step, logger }) => {
    const due = await step.run('find-due-posts', async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase()
        .from('posts')
        .select('*')
        .eq('status', 'scheduled')
        .lte('scheduled_for', nowIso)
        .limit(100);
      if (error) throw new Error(`find scheduled posts: ${error.message}`);
      return (data ?? []) as PostRow[];
    });

    if (due.length === 0) {
      return { fired: 0 };
    }

    const byDraft = new Map<string, { userId: string; platforms: Set<string> }>();
    for (const post of due) {
      const entry = byDraft.get(post.draft_id) ?? { userId: post.user_id, platforms: new Set() };
      entry.platforms.add(post.platform);
      byDraft.set(post.draft_id, entry);
    }

    let fired = 0;
    for (const [draftId, info] of byDraft) {
      await step.sendEvent(`fire-${draftId}`, {
        name: 'post/publish.now',
        data: {
          draft_id: draftId,
          platforms: Array.from(info.platforms) as PostRow['platform'][],
        },
        user: { id: info.userId },
      });
      fired++;
    }
    logger.info({ fired, totalRows: due.length }, 'scheduled publisher fired publish.now events');
    return { fired };
  },
);

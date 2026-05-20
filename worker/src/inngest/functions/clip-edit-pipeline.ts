import { isSpendCapError } from '../../lib/cost-rails.js';
import { sendPushToUser } from '../../lib/push.js';
import { captureException } from '../../lib/sentry.js';
import { supabase } from '../../lib/supabase.js';
import { runEditPipeline } from '../../pipeline/orchestrate.js';
import { inngest } from '../client.js';

export const clipEditPipeline = inngest.createFunction(
  {
    id: 'clip-edit-pipeline',
    name: 'Clip — edit pipeline',
    retries: 2,
    concurrency: { limit: 5 },
  },
  { event: 'clip/created' },
  async ({ event, step, logger }) => {
    const { clip_id } = event.data;

    try {
      const result = await step.run('run-pipeline', async () => {
        return runEditPipeline(clip_id, { logger });
      });

      await step.sendEvent('emit-clip-edit-complete', {
        name: 'clip/edit.complete',
        data: { clip_id, draft_ids: result.draftIds },
      });

      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const capHit = isSpendCapError(err);
      logger.error({ clip_id, err: message, cap_hit: capHit }, 'edit pipeline failed');
      captureException(err, {
        tags: { fn: 'clip-edit-pipeline', cap_hit: capHit },
        extra: { clip_id },
      });

      const { data: clip } = await supabase()
        .from('clips')
        .select('user_id')
        .eq('id', clip_id)
        .single();

      await supabase()
        .from('clips')
        .update({
          status: 'failed',
          trigger_metadata: capHit
            ? { error: 'spend_cap_reached', detail: message }
            : { error: message },
        })
        .eq('id', clip_id);

      if (clip?.user_id) {
        const payload = capHit
          ? {
              title: 'Clipper is taking a breather',
              body: 'Daily AI budget hit — we’ll be back at UTC midnight.',
              url: `/clip/${clip_id}`,
              tag: `clip-cap-${clip_id}`,
            }
          : {
              title: "Couldn't edit that clip",
              body: 'The clip is saved but we hit a snag rendering it. Try again later.',
              url: `/clip/${clip_id}`,
              tag: `clip-failed-${clip_id}`,
            };
        await sendPushToUser({ userId: clip.user_id, payload }).catch(() => undefined);
      }
      throw err;
    }
  },
);

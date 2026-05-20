import { sendPushToUser } from '../../lib/push.js';
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
      logger.error({ clip_id, err: message }, 'edit pipeline failed');

      const { data: clip } = await supabase()
        .from('clips')
        .select('user_id')
        .eq('id', clip_id)
        .single();

      await supabase()
        .from('clips')
        .update({ status: 'failed', trigger_metadata: { error: message } })
        .eq('id', clip_id);

      if (clip?.user_id) {
        await sendPushToUser({
          userId: clip.user_id,
          payload: {
            title: "Couldn't edit that clip",
            body: 'The clip is saved but we hit a snag rendering it. Try again later.',
            url: `/clip/${clip_id}`,
            tag: `clip-failed-${clip_id}`,
          },
        }).catch(() => undefined);
      }
      throw err;
    }
  },
);

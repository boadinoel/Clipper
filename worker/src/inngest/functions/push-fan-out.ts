import { sendPushToUser } from '../../lib/push.js';
import { supabase } from '../../lib/supabase.js';
import { inngest } from '../client.js';

export const pushFanOutOnEditComplete = inngest.createFunction(
  { id: 'push-fan-out-edit-complete', name: 'Push — clip edit complete', retries: 2 },
  { event: 'clip/edit.complete' },
  async ({ event, step, logger }) => {
    const { clip_id, draft_ids } = event.data;

    const userId = await step.run('lookup-user', async () => {
      const { data, error } = await supabase()
        .from('clips')
        .select('user_id')
        .eq('id', clip_id)
        .single();
      if (error || !data) throw new Error(`lookup user for clip ${clip_id}: ${error?.message}`);
      return data.user_id;
    });

    const result = await step.run('send-push', async () =>
      sendPushToUser({
        userId,
        payload: {
          title: 'Your clip is ready 🎬',
          body: `${draft_ids.length} drafts waiting for review`,
          url: `/clip/${clip_id}`,
          tag: `clip-${clip_id}`,
          icon: '/icons/icon-192.png',
        },
      }),
    );

    logger.info({ clip_id, ...result }, 'push fan-out done');
    return result;
  },
);

import { runProfileIngest } from '../../pipeline/profile-ingest.js';
import { inngest } from '../client.js';

export const profileIngest = inngest.createFunction(
  {
    id: 'profile-ingest',
    name: 'Profile — ingest reference clips',
    retries: 2,
    concurrency: { limit: 3, key: 'event.data.user_id' },
  },
  { event: 'profile/ingest.requested' },
  async ({ event, step, logger }) => {
    const { user_id, source, platform, reason } = event.data;

    const result = await step.run('run-ingest', async () =>
      runProfileIngest({ userId: user_id, source, platform, reason }),
    );

    if (!result.skipped) {
      await step.sendEvent('emit-style-profile-updated', {
        name: 'style_profile/updated',
        data: {
          user_id,
          fields_changed: ['reference_clip_urls', 'reference_clip_analysis'],
        },
      });
    }

    logger.info({ user_id, source, platform, reason, ...result }, 'profile ingest event done');
    return result;
  },
);

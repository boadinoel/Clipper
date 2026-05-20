import { logger } from '../lib/logger.js';
import { deleteFile } from '../lib/storage.js';
import { supabase } from '../lib/supabase.js';
import { inngest } from '../inngest/client.js';

export const cleanupStorageCron = inngest.createFunction(
  { id: 'cleanup-storage-cron', name: 'Cron — storage cleanup', concurrency: { limit: 1 } },
  { cron: '15 3 * * *' },
  async ({ step }) => {
    const rawCutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const draftCutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    const rawDeleted = await step.run('delete-raw-old', async () => {
      const { data, error } = await supabase()
        .from('clips')
        .select('id, user_id')
        .lt('created_at', rawCutoff)
        .not('raw_mp4_url', 'is', null)
        .limit(500);
      if (error) {
        logger.warn({ err: error.message }, 'cleanup: raw query failed');
        return 0;
      }
      let count = 0;
      for (const row of data ?? []) {
        try {
          await deleteFile({ bucket: 'clips', path: `${row.user_id}/${row.id}/raw.mp4` });
          await supabase().from('clips').update({ raw_mp4_url: null }).eq('id', row.id);
          count++;
        } catch (err) {
          logger.warn(
            { clip_id: row.id, err: err instanceof Error ? err.message : String(err) },
            'cleanup: raw delete failed',
          );
        }
      }
      return count;
    });

    const draftsDeleted = await step.run('delete-rejected-drafts', async () => {
      const { data, error } = await supabase()
        .from('drafts')
        .select('id, user_id, clip_id, variant_label')
        .eq('status', 'rejected')
        .lt('created_at', draftCutoff)
        .limit(500);
      if (error) {
        logger.warn({ err: error.message }, 'cleanup: drafts query failed');
        return 0;
      }
      let count = 0;
      for (const row of data ?? []) {
        try {
          await deleteFile({
            bucket: 'drafts',
            path: `${row.user_id}/${row.clip_id}/draft-${row.variant_label}.mp4`,
          });
          await deleteFile({
            bucket: 'drafts',
            path: `${row.user_id}/${row.clip_id}/draft-${row.variant_label}.jpg`,
          }).catch(() => undefined);
          count++;
        } catch (err) {
          logger.warn(
            { draft_id: row.id, err: err instanceof Error ? err.message : String(err) },
            'cleanup: draft delete failed',
          );
        }
      }
      return count;
    });

    logger.info({ rawDeleted, draftsDeleted }, 'cleanup complete');
    return { rawDeleted, draftsDeleted };
  },
);

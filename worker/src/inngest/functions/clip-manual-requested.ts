import { config } from '../../config.js';
import { downloadClipMp4 } from '../../pipeline/download.js';
import { generateThumbnail } from '../../pipeline/crop.js';
import { unlinkQuiet, withTempDir } from '../../pipeline/tempdir.js';
import {
  clipRawPath,
  clipThumbnailPath,
  uploadFile,
  getPublicUrl,
} from '../../lib/storage.js';
import { sendPushToUser } from '../../lib/push.js';
import { supabase } from '../../lib/supabase.js';
import {
  createKickClip,
  getKickTokens,
  pollUntilKickClipReady,
} from '../../lib/kick.js';
import {
  createTwitchClip,
  getTwitchTokens,
  pollUntilClipReady,
} from '../../lib/twitch.js';
import type { ChatContextEntry } from '../../types/db.js';
import { inngest } from '../client.js';

export const clipManualRequested = inngest.createFunction(
  {
    id: 'clip-manual-requested',
    name: 'Clip — manual requested',
    retries: 3,
    concurrency: { limit: 20, key: 'event.user.id' },
  },
  { event: 'clip/manual.requested' },
  async ({ event, step, logger }) => {
    const { clip_id, source, stream_id } = event.data;
    const userId = event.user.id;

    const clip = await step.run('load-clip', async () => {
      const { data, error } = await supabase()
        .from('clips')
        .select('id, user_id, status, created_at')
        .eq('id', clip_id)
        .single();
      if (error || !data) throw new Error(`clip ${clip_id} not found`);
      if (data.user_id !== userId) throw new Error(`clip ${clip_id} user_id mismatch`);
      return data;
    });

    if (clip.status !== 'pending_edit') {
      logger.info({ clip_id, status: clip.status }, 'clip already past pending_edit, skipping');
      return { skipped: true };
    }

    try {
      const platformClip = await step.run('create-platform-clip', async () => {
        if (source === 'twitch') {
          const tokens = await getTwitchTokens(userId);
          const created = await createTwitchClip({
            accessToken: tokens.accessToken,
            broadcasterId: tokens.twitchUserId,
          });
          const resolved = await pollUntilClipReady({
            accessToken: tokens.accessToken,
            clipId: created.id,
          });
          return {
            externalId: resolved.id,
            externalUrl: resolved.url,
            durationSeconds: resolved.duration,
            vodOffsetSeconds: resolved.vod_offset,
          };
        }
        const tokens = await getKickTokens(userId);
        const created = await createKickClip({
          accessToken: tokens.accessToken,
          broadcasterUserId: tokens.kickUserId,
          durationSeconds: config.CLIP_DEFAULT_DURATION_SECONDS,
        });
        const resolved = await pollUntilKickClipReady({
          accessToken: tokens.accessToken,
          clipId: created.id,
        });
        return {
          externalId: resolved.id,
          externalUrl: resolved.url,
          durationSeconds: resolved.duration,
          vodOffsetSeconds: resolved.vod_offset,
        };
      });

      const uploaded = await step.run('download-and-upload', async () => {
        return withTempDir(async (dir) => {
          const localMp4 = `${dir}/${clip_id}.mp4`;
          const localThumb = `${dir}/${clip_id}.jpg`;
          await downloadClipMp4({ url: platformClip.externalUrl, outPath: localMp4 });
          await generateThumbnail({ inputPath: localMp4, outputPath: localThumb, atSeconds: 2 });

          const rawDest = clipRawPath(userId, clip_id);
          await uploadFile({
            bucket: rawDest.bucket,
            path: rawDest.path,
            localPath: localMp4,
            contentType: 'video/mp4',
            upsert: true,
          });

          const thumbDest = clipThumbnailPath(userId, clip_id);
          await uploadFile({
            bucket: thumbDest.bucket,
            path: thumbDest.path,
            localPath: localThumb,
            contentType: 'image/jpeg',
            upsert: true,
          });

          await Promise.all([unlinkQuiet(localMp4), unlinkQuiet(localThumb)]);

          return {
            rawUrl: await getPublicUrl(rawDest),
            thumbnailUrl: await getPublicUrl(thumbDest),
          };
        });
      });

      const chatContext = await step.run('fetch-chat-context', async () => {
        const center = new Date(clip.created_at).getTime();
        const from = new Date(center - 30_000).toISOString();
        const to = new Date(center + 30_000).toISOString();
        const query = supabase()
          .from('chat_events')
          .select('sent_at, sender, message, emotes')
          .eq('user_id', userId)
          .gte('sent_at', from)
          .lte('sent_at', to)
          .order('sent_at', { ascending: true });
        if (stream_id) query.eq('stream_id', stream_id);
        const { data, error } = await query;
        if (error) {
          logger.warn({ err: error.message, clip_id }, 'chat context fetch failed');
          return [] as ChatContextEntry[];
        }
        return (data ?? []).map<ChatContextEntry>((row) => ({
          ts: row.sent_at,
          user: row.sender,
          message: row.message,
          emotes: row.emotes ?? [],
        }));
      });

      await step.run('update-clips-row', async () => {
        const update: Record<string, unknown> = {
          status: 'editing',
          twitch_clip_id: source === 'twitch' ? platformClip.externalId : null,
          twitch_clip_url: platformClip.externalUrl,
          raw_mp4_url: uploaded.rawUrl,
          thumbnail_url: uploaded.thumbnailUrl,
          duration_seconds: platformClip.durationSeconds,
          vod_offset_seconds: platformClip.vodOffsetSeconds,
          chat_context: chatContext,
        };
        const { error } = await supabase().from('clips').update(update).eq('id', clip_id);
        if (error) throw new Error(`update clips row: ${error.message}`);
      });

      await step.sendEvent('emit-clip-created', {
        name: 'clip/created',
        data: { clip_id },
      });

      return { clip_id, source };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err: message, clip_id }, 'manual clip pipeline failed');
      await supabase()
        .from('clips')
        .update({ status: 'failed', trigger_metadata: { error: message } })
        .eq('id', clip_id);
      await sendPushToUser({
        userId,
        payload: {
          title: "Couldn't capture that moment",
          body: 'Try the button again in a few seconds.',
          url: '/app',
          tag: `clip-failed-${clip_id}`,
        },
      }).catch(() => undefined);
      throw err;
    }
  },
);

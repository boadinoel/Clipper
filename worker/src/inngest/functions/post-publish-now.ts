import { decryptToken, encryptToken } from '../../lib/crypto.js';
import { sendPushToUser } from '../../lib/push.js';
import { getSignedUrl } from '../../lib/storage.js';
import { supabase } from '../../lib/supabase.js';
import { getAdapter } from '../../platforms/index.js';
import type {
  DraftRow,
  Platform,
  PlatformConnectionRow,
  PostRow,
} from '../../types/db.js';
import { inngest } from '../client.js';

export const postPublishNow = inngest.createFunction(
  {
    id: 'post-publish-now',
    name: 'Post — publish now',
    retries: 2,
    concurrency: { limit: 10, key: 'event.user.id' },
  },
  { event: 'post/publish.now' },
  async ({ event, step, logger }) => {
    const { draft_id, platforms } = event.data;
    const userId = event.user.id;

    const draft = await step.run('load-draft', async () => {
      const { data, error } = await supabase()
        .from('drafts')
        .select('*')
        .eq('id', draft_id)
        .eq('user_id', userId)
        .single();
      if (error || !data) throw new Error(`draft ${draft_id} not found`);
      return data as DraftRow;
    });

    if (!draft.output_mp4_url) {
      throw new Error(`draft ${draft_id} has no output_mp4_url`);
    }

    const signedVideoUrl = await step.run('sign-video-url', async () => {
      const path = mp4PathFromUrl(draft.output_mp4_url!, userId, draft.clip_id, draft.variant_label);
      return getSignedUrl({ bucket: 'drafts', path, expiresInSeconds: 60 * 60 });
    });

    const platformResults: Record<Platform, 'posted' | 'failed'> = {} as Record<
      Platform,
      'posted' | 'failed'
    >;

    for (const platform of platforms) {
      await step.run(`publish-${platform}`, async () => {
        const { data: postRow } = await supabase()
          .from('posts')
          .select('*')
          .eq('draft_id', draft_id)
          .eq('platform', platform)
          .eq('user_id', userId)
          .maybeSingle();
        const post = postRow as PostRow | null;
        if (!post) {
          logger.warn({ draft_id, platform }, 'no posts row for platform, skipping');
          return;
        }

        await supabase()
          .from('posts')
          .update({ status: 'posting', error_message: null })
          .eq('id', post.id);

        const connection = await loadConnection(userId, platform);
        if (!connection) {
          await supabase()
            .from('posts')
            .update({ status: 'failed', error_message: 'no platform connection' })
            .eq('id', post.id);
          platformResults[platform] = 'failed';
          return;
        }

        try {
          const accessToken = decryptToken(connection.access_token_encrypted);
          const adapter = getAdapter(platform);
          const result = await adapter.postVideo({
            videoUrl: signedVideoUrl,
            caption: post.caption ?? draft.hook_text ?? '',
            accessToken,
            accountId: connection.account_id,
            refreshToken: connection.refresh_token_encrypted
              ? decryptToken(connection.refresh_token_encrypted)
              : null,
          });

          await supabase()
            .from('posts')
            .update({
              status: 'posted',
              external_post_id: result.externalPostId,
              external_url: result.externalUrl,
              posted_at: new Date().toISOString(),
              error_message: null,
            })
            .eq('id', post.id);
          platformResults[platform] = 'posted';
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ post_id: post.id, platform, err: message }, 'platform publish failed');
          await supabase()
            .from('posts')
            .update({ status: 'failed', error_message: message.slice(0, 500) })
            .eq('id', post.id);
          platformResults[platform] = 'failed';
        }
      });
    }

    await step.run('approve-draft-row', async () => {
      await supabase()
        .from('drafts')
        .update({ status: 'approved', approved_at: new Date().toISOString() })
        .eq('id', draft_id);
    });

    await step.run('notify-user', async () => {
      const posted = Object.entries(platformResults)
        .filter(([, v]) => v === 'posted')
        .map(([p]) => platformLabel(p as Platform));
      const failed = Object.entries(platformResults)
        .filter(([, v]) => v === 'failed')
        .map(([p]) => platformLabel(p as Platform));

      if (posted.length > 0) {
        await sendPushToUser({
          userId,
          payload: {
            title: `Posted to ${posted.join(', ')}`,
            body:
              failed.length > 0
                ? `${posted.length} posted, ${failed.length} failed — open to retry.`
                : 'Tap to see your post live.',
            url: `/clip/${draft.clip_id}`,
            tag: `posted-${draft.clip_id}`,
          },
        }).catch(() => undefined);
      } else if (failed.length > 0) {
        await sendPushToUser({
          userId,
          payload: {
            title: `Couldn't post to ${failed.join(', ')}`,
            body: 'Tap to check the queue and retry.',
            url: `/clip/${draft.clip_id}`,
            tag: `posted-${draft.clip_id}`,
          },
        }).catch(() => undefined);
      }
    });

    return { draft_id, results: platformResults };
  },
);

async function loadConnection(
  userId: string,
  platform: Platform,
): Promise<PlatformConnectionRow | null> {
  const { data, error } = await supabase()
    .from('platform_connections')
    .select('*')
    .eq('user_id', userId)
    .eq('platform', platform)
    .eq('is_default', true)
    .maybeSingle();
  if (error) return null;
  return (data as PlatformConnectionRow | null) ?? null;
}

function mp4PathFromUrl(
  _publicUrl: string,
  userId: string,
  clipId: string,
  variant: string,
): string {
  return `${userId}/${clipId}/draft-${variant}.mp4`;
}

function platformLabel(p: Platform): string {
  switch (p) {
    case 'tiktok':
      return 'TikTok';
    case 'youtube_shorts':
      return 'Shorts';
    case 'instagram_reels':
      return 'Reels';
    case 'x':
      return 'X';
  }
}

import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { chatManager } from '../chat/manager.js';
import type { StreamSource } from '../types/db.js';

interface OnlineArgs {
  source: StreamSource;
  broadcasterId: string;
  title?: string | null;
  gameName?: string | null;
  twitchStreamId?: string | null;
  kickStreamId?: string | null;
}

export async function handleStreamOnline(args: OnlineArgs): Promise<void> {
  const user = await findUserByBroadcaster(args.source, args.broadcasterId);
  if (!user) {
    logger.warn(args, 'stream.online: no user matched');
    return;
  }

  const insert = {
    user_id: user.id,
    source: args.source,
    title: args.title ?? null,
    game_name: args.gameName ?? null,
    started_at: new Date().toISOString(),
    ended_at: null,
    twitch_stream_id: args.source === 'twitch' ? args.twitchStreamId ?? null : null,
    kick_stream_id: args.source === 'kick' ? args.kickStreamId ?? null : null,
  };

  const { data, error } = await supabase().from('streams').insert(insert).select('id').single();
  if (error) {
    logger.error({ err: error.message, ...args }, 'stream.online insert failed');
    return;
  }

  await chatManager.joinFor({
    userId: user.id,
    source: args.source,
    broadcasterId: args.broadcasterId,
    streamId: data.id,
    twitchLogin: user.twitch_login ?? null,
    kickLogin: user.kick_login ?? null,
  });
}

interface OfflineArgs {
  source: StreamSource;
  broadcasterId: string;
}

export async function handleStreamOffline(args: OfflineArgs): Promise<void> {
  const user = await findUserByBroadcaster(args.source, args.broadcasterId);
  if (!user) return;

  const { error } = await supabase()
    .from('streams')
    .update({ ended_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .eq('source', args.source)
    .is('ended_at', null);
  if (error) {
    logger.warn({ err: error.message, ...args }, 'stream.offline update failed');
  }

  await chatManager.leaveFor({ userId: user.id, source: args.source });
}

async function findUserByBroadcaster(
  source: StreamSource,
  broadcasterId: string,
): Promise<{ id: string; twitch_login: string | null; kick_login: string | null } | null> {
  const column = source === 'twitch' ? 'twitch_user_id' : 'kick_user_id';
  const { data, error } = await supabase()
    .from('users')
    .select('id, twitch_login, kick_login')
    .eq(column, broadcasterId)
    .maybeSingle();
  if (error) {
    logger.warn({ err: error.message, source, broadcasterId }, 'find user by broadcaster failed');
    return null;
  }
  return data ?? null;
}

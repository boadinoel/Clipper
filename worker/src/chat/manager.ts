import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import type { StreamSource } from '../types/db.js';
import { KickChatSession } from './kick-chat.js';
import { TwitchIrcSession } from './twitch-irc.js';

interface JoinArgs {
  userId: string;
  source: StreamSource;
  broadcasterId: string;
  streamId: string;
  twitchLogin: string | null;
  kickLogin: string | null;
}

interface LeaveArgs {
  userId: string;
  source: StreamSource;
}

interface ActiveSession {
  twitch?: TwitchIrcSession;
  kick?: KickChatSession;
}

class ChatManager {
  private byUser = new Map<string, ActiveSession>();

  async joinFor(args: JoinArgs): Promise<void> {
    const existing = this.byUser.get(args.userId) ?? {};
    if (args.source === 'twitch') {
      if (existing.twitch) return;
      if (!args.twitchLogin) {
        logger.warn({ userId: args.userId }, 'chat manager: no twitch login');
        return;
      }
      const session = new TwitchIrcSession({
        userId: args.userId,
        channel: args.twitchLogin,
        streamId: args.streamId,
      });
      await session.start();
      existing.twitch = session;
    } else {
      if (existing.kick) return;
      if (!args.kickLogin) return;
      const chatroomId = await fetchKickChatroomId(args.kickLogin);
      if (!chatroomId) {
        logger.warn({ userId: args.userId, kickLogin: args.kickLogin }, 'chat manager: kick chatroom not found');
        return;
      }
      const session = new KickChatSession({
        userId: args.userId,
        chatroomId,
        streamId: args.streamId,
        channelLogin: args.kickLogin,
      });
      session.start();
      existing.kick = session;
    }
    this.byUser.set(args.userId, existing);
  }

  async leaveFor(args: LeaveArgs): Promise<void> {
    const existing = this.byUser.get(args.userId);
    if (!existing) return;
    if (args.source === 'twitch' && existing.twitch) {
      await existing.twitch.stop();
      existing.twitch = undefined;
    } else if (args.source === 'kick' && existing.kick) {
      existing.kick.stop();
      existing.kick = undefined;
    }
    if (!existing.twitch && !existing.kick) {
      this.byUser.delete(args.userId);
    } else {
      this.byUser.set(args.userId, existing);
    }
  }

  async resumeFromOpenStreams(): Promise<void> {
    const { data, error } = await supabase()
      .from('streams')
      .select('id, user_id, source')
      .is('ended_at', null);
    if (error) {
      logger.warn({ err: error.message }, 'chat manager: resume query failed');
      return;
    }
    for (const stream of data ?? []) {
      const { data: user } = await supabase()
        .from('users')
        .select('twitch_user_id, twitch_login, kick_user_id, kick_login')
        .eq('id', stream.user_id)
        .single();
      if (!user) continue;
      const broadcasterId =
        stream.source === 'twitch' ? user.twitch_user_id : user.kick_user_id;
      if (!broadcasterId) continue;
      await this.joinFor({
        userId: stream.user_id,
        source: stream.source,
        broadcasterId,
        streamId: stream.id,
        twitchLogin: user.twitch_login,
        kickLogin: user.kick_login,
      });
    }
  }
}

async function fetchKickChatroomId(login: string): Promise<string | null> {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(login)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { chatroom?: { id?: number } };
  return json.chatroom?.id ? String(json.chatroom.id) : null;
}

export const chatManager = new ChatManager();

import WebSocket from 'ws';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { inngest } from '../inngest/client.js';
import { SpikeDetector } from './spike-detector.js';

const PUSHER_APP_KEY = '32cbd69e4b950bf97679';
const PUSHER_CLUSTER = 'us2';
const WS_URL = `wss://ws-${PUSHER_CLUSTER}.pusher.com/app/${PUSHER_APP_KEY}?protocol=7&client=clipper&version=1.0.0&flash=false`;

export interface KickChatOpts {
  userId: string;
  chatroomId: string;
  streamId: string;
  channelLogin: string;
}

interface PusherEnvelope {
  event: string;
  channel?: string;
  data?: string;
}

interface KickChatMessage {
  id: string;
  content: string;
  sender: { id: number; username: string; slug: string };
  type?: string;
  created_at?: string;
}

export class KickChatSession {
  private ws: WebSocket | null = null;
  private detector = new SpikeDetector();
  private active = false;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private opts: KickChatOpts) {}

  start(): void {
    this.active = true;
    this.connect();
  }

  stop(): void {
    this.active = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    if (!this.active) return;
    this.ws = new WebSocket(WS_URL);
    this.ws.on('open', () => this.subscribe());
    this.ws.on('message', (raw) => this.onMessage(raw.toString()));
    this.ws.on('close', () => {
      this.ws = null;
      if (this.active) this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    });
    this.ws.on('error', (err) =>
      logger.warn({ err: err.message, channel: this.opts.channelLogin }, 'kick chat: error'),
    );
  }

  private subscribe(): void {
    this.ws?.send(
      JSON.stringify({
        event: 'pusher:subscribe',
        data: { auth: '', channel: `chatrooms.${this.opts.chatroomId}.v2` },
      }),
    );
  }

  private async onMessage(raw: string): Promise<void> {
    let env: PusherEnvelope;
    try {
      env = JSON.parse(raw) as PusherEnvelope;
    } catch {
      return;
    }
    if (env.event === 'pusher:ping') {
      this.ws?.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
      return;
    }
    if (env.event !== 'App\\Events\\ChatMessageEvent' || !env.data) return;

    let payload: KickChatMessage;
    try {
      payload = JSON.parse(env.data) as KickChatMessage;
    } catch {
      return;
    }

    const emotes = extractEmotes(payload.content);
    const sentAt = payload.created_at ?? new Date().toISOString();

    await supabase()
      .from('chat_events')
      .insert({
        user_id: this.opts.userId,
        stream_id: this.opts.streamId,
        source: 'kick',
        channel: this.opts.channelLogin,
        sender: payload.sender?.username ?? 'anon',
        message: payload.content,
        emotes,
        sent_at: sentAt,
      });

    const spike = this.detector.ingest({
      ts: Date.now(),
      message: payload.content,
      emotes,
    });
    if (spike) await this.triggerAutoClip(spike);
  }

  private async triggerAutoClip(spike: { reason: string; samples: string[]; count: number }): Promise<void> {
    const { data, error } = await supabase()
      .from('clips')
      .insert({
        user_id: this.opts.userId,
        stream_id: this.opts.streamId,
        source: 'kick',
        trigger_type: 'auto',
        trigger_metadata: { kind: 'chat_spike', reason: spike.reason, count: spike.count, samples: spike.samples },
        status: 'pending_edit',
      })
      .select('id')
      .single();
    if (error || !data) {
      logger.warn({ err: error?.message }, 'kick auto-clip insert failed');
      return;
    }
    await inngest.send({
      name: 'clip/manual.requested',
      data: {
        clip_id: data.id,
        source: 'kick',
        stream_id: this.opts.streamId,
        requested_at: new Date().toISOString(),
        trigger_metadata: { kind: 'chat_spike', reason: spike.reason, count: spike.count },
      },
      user: { id: this.opts.userId },
    });
  }
}

function extractEmotes(content: string): string[] {
  const matches = Array.from(content.matchAll(/\[emote:(\d+):([^\]]+)\]/g));
  return matches.map((m) => m[2]!);
}

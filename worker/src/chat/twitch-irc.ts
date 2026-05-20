import tmi from 'tmi.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../lib/supabase.js';
import { inngest } from '../inngest/client.js';
import { SpikeDetector } from './spike-detector.js';

export interface TwitchIrcOpts {
  userId: string;
  channel: string;
  streamId: string;
}

export class TwitchIrcSession {
  private client: tmi.Client;
  private detector = new SpikeDetector();
  private opts: TwitchIrcOpts;
  private active = false;

  constructor(opts: TwitchIrcOpts) {
    this.opts = opts;
    this.client = new tmi.Client({
      options: { skipUpdatingEmotesets: true },
      connection: { reconnect: true, secure: true },
      channels: [opts.channel],
    });

    this.client.on('message', (channel, tags, message, self) => {
      if (self) return;
      void this.onMessage(tags, message);
    });
    this.client.on('disconnected', (reason) => {
      logger.warn({ reason, channel: opts.channel }, 'twitch IRC disconnected');
    });
  }

  async start(): Promise<void> {
    this.active = true;
    await this.client.connect();
  }

  async stop(): Promise<void> {
    this.active = false;
    try {
      await this.client.disconnect();
    } catch {
      /* ignore */
    }
  }

  private async onMessage(tags: tmi.ChatUserstate, message: string): Promise<void> {
    if (!this.active) return;
    const emotes = parseEmotes(tags.emotes ?? null);
    const sender = tags['display-name'] ?? tags.username ?? 'anon';
    const sentAt = new Date(Number(tags['tmi-sent-ts'] ?? Date.now())).toISOString();

    await supabase()
      .from('chat_events')
      .insert({
        user_id: this.opts.userId,
        stream_id: this.opts.streamId,
        source: 'twitch',
        channel: this.opts.channel,
        sender,
        message,
        emotes,
        sent_at: sentAt,
      });

    const spike = this.detector.ingest({
      ts: Date.now(),
      message,
      emotes,
    });
    if (spike) {
      await this.triggerAutoClip(spike);
    }
  }

  private async triggerAutoClip(spike: { reason: string; samples: string[]; count: number }): Promise<void> {
    const { data: clipRow, error } = await supabase()
      .from('clips')
      .insert({
        user_id: this.opts.userId,
        stream_id: this.opts.streamId,
        source: 'twitch',
        trigger_type: 'auto',
        trigger_metadata: { kind: 'chat_spike', reason: spike.reason, count: spike.count, samples: spike.samples },
        status: 'pending_edit',
      })
      .select('id')
      .single();
    if (error || !clipRow) {
      logger.warn({ err: error?.message, channel: this.opts.channel }, 'auto-clip insert failed');
      return;
    }
    await inngest.send({
      name: 'clip/manual.requested',
      data: {
        clip_id: clipRow.id,
        source: 'twitch',
        stream_id: this.opts.streamId,
        requested_at: new Date().toISOString(),
        trigger_metadata: { kind: 'chat_spike', reason: spike.reason, count: spike.count },
      },
      user: { id: this.opts.userId },
    });
  }
}

function parseEmotes(emotes: { [emoteid: string]: string[] } | null): string[] {
  if (!emotes) return [];
  return Object.keys(emotes);
}

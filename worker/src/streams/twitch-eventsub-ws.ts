import WebSocket from 'ws';
import { config } from '../config.js';
import { getAppAccessToken, getConnectedTwitchUsers } from '../lib/twitch.js';
import { logger } from '../lib/logger.js';
import { fetchWithRetry, HttpStatusError } from '../lib/retry.js';
import { captureException } from '../lib/sentry.js';
import { handleStreamOffline, handleStreamOnline } from './handlers.js';

const HUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
const HELIX_SUB = 'https://api.twitch.tv/helix/eventsub/subscriptions';

interface SessionWelcomePayload {
  metadata: { message_type: 'session_welcome' };
  payload: { session: { id: string; keepalive_timeout_seconds: number } };
}

interface NotificationPayload {
  metadata: { message_type: 'notification'; subscription_type: string };
  payload: {
    subscription: { id: string; type: string };
    event: Record<string, unknown> & { broadcaster_user_id: string };
  };
}

interface ReconnectPayload {
  metadata: { message_type: 'session_reconnect' };
  payload: { session: { reconnect_url: string } };
}

type IncomingMessage = SessionWelcomePayload | NotificationPayload | ReconnectPayload | { metadata: { message_type: string } };

export class TwitchEventSubClient {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private url = HUB_URL;
  private active = false;
  private appToken: string | null = null;
  private subscribedBroadcasters = new Set<string>();

  start(): void {
    this.active = true;
    void this.connect();
  }

  stop(): void {
    this.active = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  async subscribeBroadcaster(broadcasterUserId: string): Promise<void> {
    if (!this.sessionId) {
      this.subscribedBroadcasters.add(broadcasterUserId);
      return;
    }
    await this.subscribe(broadcasterUserId, 'stream.online');
    await this.subscribe(broadcasterUserId, 'stream.offline');
    this.subscribedBroadcasters.add(broadcasterUserId);
  }

  private async connect(): Promise<void> {
    if (!this.active) return;
    try {
      this.ws = new WebSocket(this.url);
      this.ws.on('open', () => logger.info({}, 'twitch eventsub: websocket open'));
      this.ws.on('error', (err) => {
        logger.warn({ err: err.message }, 'twitch eventsub: ws error');
        captureException(err, { tags: { component: 'twitch_eventsub_ws' } });
      });
      this.ws.on('close', (code, reason) => {
        logger.warn({ code, reason: reason.toString() }, 'twitch eventsub: ws closed');
        this.sessionId = null;
        if (this.active) {
          this.reconnectTimer = setTimeout(() => this.connect(), 3000);
        }
      });
      this.ws.on('message', (raw) => this.onMessage(raw.toString()));
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, 'twitch eventsub: connect failed');
      captureException(err, { tags: { component: 'twitch_eventsub_ws', phase: 'connect' } });
      this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    }
  }

  private async onMessage(raw: string): Promise<void> {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(raw) as IncomingMessage;
    } catch {
      return;
    }

    switch (msg.metadata.message_type) {
      case 'session_welcome': {
        const welcome = msg as SessionWelcomePayload;
        this.sessionId = welcome.payload.session.id;
        logger.info({ sessionId: this.sessionId }, 'twitch eventsub: session welcome');
        await this.resubscribeAll();
        break;
      }
      case 'session_reconnect': {
        const r = msg as ReconnectPayload;
        this.url = r.payload.session.reconnect_url;
        this.ws?.close();
        break;
      }
      case 'notification': {
        const n = msg as NotificationPayload;
        await this.dispatch(n);
        break;
      }
      case 'session_keepalive':
      case 'revocation':
      default:
        break;
    }
  }

  private async resubscribeAll(): Promise<void> {
    const users = await getConnectedTwitchUsers();
    for (const user of users) {
      if (!user.twitch_user_id) continue;
      await this.subscribeBroadcaster(user.twitch_user_id).catch((err) =>
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), broadcaster: user.twitch_user_id },
          'twitch eventsub: subscribe failed',
        ),
      );
    }
  }

  private async subscribe(broadcasterId: string, type: 'stream.online' | 'stream.offline'): Promise<void> {
    if (!this.sessionId) return;
    if (!this.appToken) this.appToken = await getAppAccessToken();
    try {
      const res = await fetchWithRetry(
        HELIX_SUB,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.appToken}`,
            'Client-Id': config.TWITCH_CLIENT_ID,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            type,
            version: '1',
            condition: { broadcaster_user_id: broadcasterId },
            transport: { method: 'websocket', session_id: this.sessionId },
          }),
        },
        { tag: 'eventsub.subscribe', acceptStatus: (s) => s < 400 || s === 409 },
      );
      if (res.status === 409) return;
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 401) {
        this.appToken = null;
      }
      throw err;
    }
  }

  private async dispatch(n: NotificationPayload): Promise<void> {
    const event = n.payload.event;
    const broadcasterId = String(event.broadcaster_user_id);
    if (n.payload.subscription.type === 'stream.online') {
      await handleStreamOnline({
        source: 'twitch',
        broadcasterId,
        title: (event.title as string | undefined) ?? null,
        gameName: (event.category_name as string | undefined) ?? null,
        twitchStreamId: (event.id as string | undefined) ?? null,
      });
    } else if (n.payload.subscription.type === 'stream.offline') {
      await handleStreamOffline({ source: 'twitch', broadcasterId });
    }
  }
}

export const twitchEventSubClient = new TwitchEventSubClient();

import { serve as honoServe } from '@hono/node-server';
import { Hono } from 'hono';
import { logger as honoLogger } from 'hono/logger';
import { loadConfig } from './config.js';
import { chatManager } from './chat/manager.js';
import { logger } from './lib/logger.js';
import { healthRoute } from './routes/health.js';
import { inngestRoute } from './routes/inngest.js';
import { instagramOauthRoute } from './routes/oauth/instagram-callback.js';
import { kickOauthRoute } from './routes/oauth/kick-callback.js';
import { tiktokOauthRoute } from './routes/oauth/tiktok-callback.js';
import { xOauthRoute } from './routes/oauth/x-callback.js';
import { youtubeOauthRoute } from './routes/oauth/youtube-callback.js';
import { kickWebhookRoute } from './routes/webhooks/kick.js';
import { twitchEventsubRoute } from './routes/webhooks/twitch-eventsub.js';
import { twitchEventSubClient } from './streams/twitch-eventsub-ws.js';

const cfg = loadConfig();

const app = new Hono();
app.use('*', honoLogger((msg) => logger.info({ msg }, 'http')));

app.route('/', healthRoute);
app.route('/', inngestRoute);
app.route('/', twitchEventsubRoute);
app.route('/', kickWebhookRoute);
app.route('/', kickOauthRoute);
app.route('/', tiktokOauthRoute);
app.route('/', youtubeOauthRoute);
app.route('/', instagramOauthRoute);
app.route('/', xOauthRoute);

app.notFound((c) => c.json({ error: 'not_found' }, 404));
app.onError((err, c) => {
  logger.error({ err: err.message, stack: err.stack }, 'unhandled error');
  return c.json({ error: 'internal_error' }, 500);
});

const server = honoServe({ fetch: app.fetch, port: cfg.PORT, hostname: '0.0.0.0' }, (info) => {
  logger.info({ port: info.port }, 'clipper worker listening');
});

twitchEventSubClient.start();
void chatManager.resumeFromOpenStreams().catch((err: unknown) => {
  logger.warn({ err: err instanceof Error ? err.message : String(err) }, 'chat resume failed');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  twitchEventSubClient.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  logger.error({ err: err.message, stack: err.stack }, 'uncaughtException');
});
process.on('unhandledRejection', (reason) => {
  logger.error({ reason: String(reason) }, 'unhandledRejection');
});

import { Hono } from 'hono';

export const healthRoute = new Hono();

healthRoute.get('/health', (c) =>
  c.json({ status: 'ok', uptime_s: Math.round(process.uptime()) }),
);

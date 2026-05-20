import { Hono } from 'hono';
import { serve } from 'inngest/hono';
import { config } from '../config.js';
import { inngest } from '../inngest/client.js';
import { inngestFunctions } from '../inngest/serve.js';

export const inngestRoute = new Hono();

const handler = serve({
  client: inngest,
  functions: inngestFunctions,
  signingKey: config.INNGEST_SIGNING_KEY,
});

inngestRoute.all('/api/inngest', (c) => handler(c));

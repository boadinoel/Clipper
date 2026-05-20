import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(8080),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),
  INNGEST_APP_ID: z.string().default('clipper-worker'),

  TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'TOKEN_ENCRYPTION_KEY must be 32-byte hex (64 chars)'),

  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_EVENTSUB_SECRET: z.string().min(10),

  KICK_CLIENT_ID: z.string().min(1).optional(),
  KICK_CLIENT_SECRET: z.string().min(1).optional(),
  KICK_WEBHOOK_SECRET: z.string().min(10).optional(),

  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_CLIENT_ID: z.string().optional(),
  YOUTUBE_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),

  GROQ_API_KEY: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),

  VAPID_PUBLIC_KEY: z.string().min(1),
  VAPID_PRIVATE_KEY: z.string().min(1),
  VAPID_SUBJECT: z.string().regex(/^mailto:/),

  FRONTEND_URL: z.string().url(),
  CLIP_DEFAULT_DURATION_SECONDS: z.coerce.number().int().positive().default(30),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function loadConfig(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export const config = new Proxy({} as Config, {
  get(_t, prop: string) {
    return loadConfig()[prop as keyof Config];
  },
});

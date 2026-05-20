# Deploy the worker to Railway

End-to-end first-deploy guide. Target time: ~30 minutes if everything's
ready; longer the first time because of secret generation + dashboard
sign-ups.

The worker runs on Railway. The database stays on Supabase. Inngest
hosts the workflow orchestration as a separate managed service.

```
┌──────────┐         ┌───────────┐         ┌──────────────┐
│  Inngest │ ───────▶│  Railway  │ ───────▶│   Supabase   │
│  (events │  POST   │  (worker) │  service│  (Postgres + │
│  + cron) │ /inngest│           │   role  │   storage)   │
└──────────┘         └───────────┘         └──────────────┘
```

## 0. Prerequisites

- [ ] Supabase project exists, with `auth`, `users`, `streams`, `clips`,
      `drafts`, `posts`, `platform_connections`, `push_subscriptions`,
      `chat_events`, `style_profiles` tables (per the Frontend Handoff).
- [ ] You have the Supabase **service-role** key + DB connection string.
- [ ] You have a Railway account (sign up at https://railway.com).
- [ ] You have an Inngest account (sign up at https://www.inngest.com).
- [ ] You have a Twitch developer app with `clips:edit` and EventSub
      scopes registered. Same for Kick if you stream there.
- [ ] (Optional, for posting) You have Meta / TikTok / YouTube / X
      developer apps — see `docs/platform-applications.md`.
- [ ] `psql` installed locally (`brew install libpq` or
      `apt-get install postgresql-client`).
- [ ] `node` >= 20 installed locally.

## 1. Generate the secrets you'll paste into Railway

Run these locally once and save the outputs to a password manager:

```bash
# 32-byte hex token encryption key (used for AES-256-GCM)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Long admin secret (>=20 chars)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

# Twitch EventSub secret (any random string, >=10 chars — used to verify webhooks)
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"

# VAPID key pair for web push (must match what the frontend uses)
npx web-push generate-vapid-keys
```

If the frontend already uses VAPID keys, reuse them — they must be
identical on both sides.

## 2. Apply Supabase migrations

Three migrations need to land in your Supabase project before the
worker can start writing to the new tables:

- `migrations/20260520_service_spend.sql` — cost rails ledger + RPCs
- `migrations/20260521_posts_metrics.sql` — 24h/7d snapshots + percentile
- `migrations/20260521_eval_runs.sql` — LLM eval trend log

Run them all in order:

```bash
cd worker

# Get this from Supabase dashboard → Project Settings → Database →
# Connection string → URI (use the "Session pooler" string).
export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres'

./scripts/apply-migrations.sh
```

The script is idempotent — re-running is safe.

The frontend also needs to apply one column:

```sql
alter table public.style_profiles
  add column if not exists reference_pending jsonb;
```

Either run that yourself or hand it to whoever ships the frontend
migration. See `docs/frontend-contract.md`.

## 3. Provision Inngest

1. Go to https://app.inngest.com → create an app called `clipper-worker`.
2. From the app's **Manage → Event Keys** page, create a production
   event key. Copy it → that's your `INNGEST_EVENT_KEY`.
3. From **Manage → Signing Keys**, copy the signing key → that's your
   `INNGEST_SIGNING_KEY`.
4. Note the app's URL pattern: Inngest will POST to
   `https://<your-railway-domain>/inngest` once Railway is up. You'll
   configure this in step 6.

## 4. Create the Railway project

1. https://railway.com/new → **Deploy from GitHub repo** → pick this
   repo (`boadinoel/Clipper`).
2. After import, Railway creates one service. Open it.
3. **Settings → Source**:
   - Branch: `claude/frontend-state-documentation-vm0WN` (the dev
     branch this work landed on), or whichever branch you've merged
     it into.
   - **Root Directory: `worker`** — this is critical; the repo root
     has only docs and the worker lives in the subdirectory.
4. **Settings → Networking → Generate Domain**. Copy the URL Railway
   gives you (looks like `https://clipper-worker-<hash>.up.railway.app`).
   That's `FRONTEND_URL`'s OAuth callback domain — keep it handy.

Don't deploy yet — the build will fail without env vars.

## 5. Set env vars on Railway

In your Railway service: **Variables → Raw Editor**, paste this and
fill in the blanks. Required = will fail to start without it.

```bash
# --- Required: Supabase ---
SUPABASE_URL=https://<your-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key-from-supabase-settings-api>

# --- Required: Inngest ---
INNGEST_EVENT_KEY=<from-step-3>
INNGEST_SIGNING_KEY=<from-step-3>
INNGEST_APP_ID=clipper-worker

# --- Required: encryption + Twitch ---
TOKEN_ENCRYPTION_KEY=<32-byte-hex-from-step-1>
TWITCH_CLIENT_ID=<from-dev.twitch.tv-console>
TWITCH_CLIENT_SECRET=<from-dev.twitch.tv-console>
TWITCH_EVENTSUB_SECRET=<random-from-step-1>

# --- Required: AI ---
GROQ_API_KEY=<from-console.groq.com>
ANTHROPIC_API_KEY=<from-console.anthropic.com>

# --- Required: web push (must match frontend) ---
VAPID_PUBLIC_KEY=<from-step-1>
VAPID_PRIVATE_KEY=<from-step-1>
VAPID_SUBJECT=mailto:you@yourdomain.com

# --- Required: misc ---
FRONTEND_URL=https://<your-frontend-domain>
NODE_ENV=production
PORT=8080
CLIP_DEFAULT_DURATION_SECONDS=30

# --- Cost rails (defaults are fine for pilot) ---
ANTHROPIC_DAILY_CAP_CENTS=500
GROQ_DAILY_CAP_CENTS=200
COST_RAILS_ENFORCEMENT=true

# --- Observability ---
SENTRY_DSN=<from-sentry.io-project; leave blank for no-op>
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SLOW_PIPELINE_THRESHOLD_SECONDS=180

# --- Admin endpoints (>= 20 chars) ---
ADMIN_SECRET=<long-random-from-step-1>

# --- Face tracking (in-container paths from the Dockerfile) ---
FACE_TRACK_PYTHON=/opt/cv-venv/bin/python3
FACE_TRACK_SCRIPT=./scripts/face-track.py
FACE_TRACK_ENABLED=true
FACE_TRACK_SAMPLE_EVERY=5

# --- Eval ---
EVAL_GOLDEN_SET_VERSION=v1
EVAL_SAMPLE_RATE=0.1

# --- Optional: Kick (only if you stream there) ---
KICK_CLIENT_ID=
KICK_CLIENT_SECRET=
KICK_WEBHOOK_SECRET=

# --- Optional: posting platforms (only after API approval) ---
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
INSTAGRAM_CLIENT_ID=
INSTAGRAM_CLIENT_SECRET=
X_CLIENT_ID=
X_CLIENT_SECRET=
```

The complete reference is in `worker/.env.example`.

## 6. Trigger the first deploy

1. **Deployments → Deploy** (or push a commit; Railway watches your
   branch).
2. Watch the build log. The Docker image pulls ffmpeg, yt-dlp,
   mediapipe + opencv into two Python venvs. Expect ~6–8 min for the
   first build; subsequent builds reuse layers and are ~90s.
3. Once green: `curl https://<your-railway-domain>/health`. Should
   return `{"status":"ok","uptime_s":N}`.

If the build fails on the mediapipe install, set `FACE_TRACK_ENABLED=false`
in env vars and redeploy — the worker falls back to center crop.

## 7. Wire Inngest to the Railway URL

1. Back in https://app.inngest.com → your app → **Apps** tab → **Add app**.
2. Enter the URL `https://<your-railway-domain>/inngest` and click
   **Sync app**.
3. Inngest fetches the function manifest. You should see 18 functions
   register, including `clip-edit-pipeline`, `metrics-ingest-cron`,
   `eval-rollup-cron`, etc.
4. Send a test event from Inngest's dashboard (any of the registered
   events). Confirm it lands in Railway's logs.

## 8. Configure OAuth redirect URIs

Wherever you registered your OAuth apps (Twitch, Kick, TikTok, YouTube,
Meta, X), set the redirect URI to the corresponding worker route:

| Platform   | Redirect URI                                              |
|------------|-----------------------------------------------------------|
| Kick       | `https://<railway>/oauth/kick/callback`                   |
| TikTok     | `https://<railway>/oauth/tiktok/callback`                 |
| YouTube    | `https://<railway>/oauth/youtube/callback`                |
| Instagram  | `https://<railway>/oauth/instagram/callback`              |
| X          | `https://<railway>/oauth/x/callback`                      |

Twitch OAuth runs through Supabase Auth, not the worker.

For Twitch EventSub, point the webhook at:
`https://<railway>/webhooks/twitch-eventsub`

## 9. Post-deploy smoke

```bash
# Health
curl https://<railway>/health

# Admin auth gate
curl -i -H "Authorization: Bearer $ADMIN_SECRET" https://<railway>/admin/health

# Spend ledger (should return empty until first AI call)
curl -H "Authorization: Bearer $ADMIN_SECRET" "https://<railway>/admin/spend"

# Force a profile refresh for your own user id
curl -X POST -H "Authorization: Bearer $ADMIN_SECRET" \
  "https://<railway>/admin/refresh-profile/<your-supabase-user-id>"
```

You should see the corresponding Inngest event fire in the dashboard
and a log line in Railway's stream.

## 10. Optional: seed the eval baseline

After the first deploy, run the eval harness from your laptop against
the live Supabase (so the trend log starts populating):

```bash
cd worker
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export ANTHROPIC_API_KEY=...
# ... and the rest from your .env

npm run eval
```

It runs `planVariants` + the judge on each golden clip, prints a
Markdown summary, and inserts a row per clip into `eval_runs` tagged
with your current git sha.

## Things that commonly trip people up

- **Forgot to set Root Directory to `worker/`** — Railway tries to build
  from the repo root, fails because there's no Dockerfile.
- **Inngest signing key from staging env** — events register but
  signature verification fails. Make sure prod keys go to prod.
- **VAPID keys don't match frontend** — push notifications go nowhere.
  Double-check both halves are identical.
- **Supabase IP allowlist** — if you've enabled it on the DB, you must
  add Railway's egress IPs (Settings → Network in Railway).
- **OAuth callback host mismatch** — provider's registered URL must
  exactly match the worker's deployed host, including https://.
- **Mediapipe wheel fails on ARM** — Railway uses x86_64 by default,
  but if you change the architecture, mediapipe may not have a wheel.
  Stay on amd64.

## Rolling back

Railway → Deployments → pick a previous successful deployment →
**Redeploy**. Migrations are idempotent so they don't need to roll
back unless a NEW migration in the rolled-back commit added a column
the older code can't tolerate (none of the current three do).

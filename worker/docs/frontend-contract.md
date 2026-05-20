# Frontend ↔ Worker contract

This is the surface area the frontend must mirror. Worker side is
shipped on branch `claude/frontend-state-documentation-vm0WN`.

## 1. Events the frontend may fire

Both events are Inngest events. The frontend should use whatever
mechanism it already uses to send events (today: a Supabase Edge
Function or server function that calls Inngest's REST `/e/<key>`
endpoint with the `INNGEST_EVENT_KEY`).

### `profile/references.added`

Fired when a user pastes URLs or enters platform handles on Settings.

```ts
{
  name: 'profile/references.added',
  data: {
    user_id: string;                  // Supabase auth user id
    urls?: string[];                  // optional, max 50 per fire
    handles?: Array<{
      platform: 'tiktok' | 'youtube';
      handle: string;                 // without leading "@"
    }>;
    classification: 'self' | 'reference' | 'aspirational';
    // - 'self': user confirms it's their own content
    // - 'reference': probably theirs (public handle, not OAuth-verified)
    // - 'aspirational': someone else they want to emulate
  }
}
```

The worker queues these into `style_profiles.reference_pending` and
chain-emits `profile/ingest.requested { reason: 'manual' }` which
runs the full synthesis pipeline.

### `profile/ingest.requested` (Twitch bridge)

Fired when a user finishes Twitch OAuth (handled by Supabase Auth, not
this worker). Recommend wiring this in a frontend server function
that runs on Supabase Auth's post-login webhook.

```ts
{
  name: 'profile/ingest.requested',
  data: {
    user_id: string;
    source: 'streaming',
    platform: 'twitch',
    reason: 'oauth_connect',
  }
}
```

The worker handles Kick/TikTok/YouTube/IG/X OAuth itself, so the
frontend only needs to fire this event for the Twitch flow.

## 2. Required schema migration

Add to a frontend Supabase migration:

```sql
alter table public.style_profiles
  add column if not exists reference_pending jsonb;
```

The worker tolerates absence (defensive `select` + null check), but
the column must exist for the references-added flow to do anything.

## 3. Recommended Twitch-bridge snippet (frontend server function)

```ts
// e.g. supabase/functions/twitch-connected/index.ts
import { serve } from 'std/server';

serve(async (req) => {
  const { user_id } = await req.json();
  const r = await fetch(
    `https://inn.gs/e/${Deno.env.get('INNGEST_EVENT_KEY')}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'profile/ingest.requested',
        data: { user_id, source: 'streaming', platform: 'twitch', reason: 'oauth_connect' },
      }),
    },
  );
  return new Response(JSON.stringify({ ok: r.ok }), {
    headers: { 'content-type': 'application/json' },
  });
});
```

## 4. Verification

After applying the migration and wiring the frontend send:

1. From the frontend Settings page, paste a TikTok URL and choose
   *aspirational*.
2. Inspect Inngest dashboard — `profile/references.added` event
   should appear within a second.
3. After it processes, `select reference_pending from style_profiles
   where user_id=<you>` should be null (cleared) and
   `reference_clip_analysis` populated.

If `reference_pending` is non-null and `reference_clip_analysis` is
still null after 60s, check Inngest dashboard for a failed run on
`profile-ingest`.

## 5. Other worker events the FE doesn't fire (FYI)

The worker also emits these — the FE may want to subscribe to them
via Supabase Realtime on `clips` / `drafts` / `posts` (existing
pattern):

- `clip/edit.complete` — pipeline finished, drafts are ready.
- `style_profile/updated` — reference analysis refreshed.

No FE action required for these; just observe the row changes.

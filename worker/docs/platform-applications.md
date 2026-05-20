# Platform API applications — checklist

Owner: founder. Engineering blocked on **none** of these — but every
one needs to be in flight before pilot day 14 or posting will fall back
to manual/clipboard exports.

## Pre-application prep (do these first, in parallel)

- [ ] Public landing page live with `/privacy` and `/terms` URLs
      (Termly or similar generator is fine for v1).
- [ ] 60–90s screencast: stream → button tap → push → approve → posted
      clip on TikTok. Record against current Lovable frontend.
- [ ] Business verification docs ready (tax doc + ID). Meta is the
      slowest; start here.
- [ ] Worker deployed to public hostname (Railway) — application forms
      require a callable redirect URI matching the OAuth callback
      routes (`/oauth/<platform>/callback`).

## Per-platform

### TikTok Content Posting API

- Apply at https://developers.tiktok.com → My Apps → request
  *Content Posting API* scope.
- Required: privacy URL, demo video, scope justification (~200 words
  on why personal accounts need this beyond TikTok's own editor).
- Lead time: 1–2 weeks.
- Status: **not started**.

### Meta App Review (Instagram Reels)

- Apply at https://developers.facebook.com → your app → App Review.
- Required: business verification (DUNS or tax ID), screencast, server
  IP whitelist for production traffic.
- Lead time: 3–4 weeks. **Start here.**
- Status: **not started**.

### YouTube Data API quota raise + OAuth verification

- OAuth verification: https://support.google.com/cloud/answer/9110914
- Quota raise: https://support.google.com/youtube/contact/yt_api_form
- Required: homepage + privacy policy ownership proof, justification
  for >10k units/day (each Shorts upload costs 1600 units, so 6+ users
  exceeds the default).
- Lead time: 2–3 weeks.
- Status: **not started**.

### X (Twitter) API Basic tier

- Upgrade at https://developer.x.com/portal.
- Required: credit card, ToS acceptance.
- Cost: $200/month.
- Lead time: immediate.
- Status: **not started**.

## Tracking

| Platform   | Submitted | Approved | Notes |
|------------|-----------|----------|-------|
| TikTok     |           |          |       |
| Meta (IG)  |           |          |       |
| YouTube    |           |          |       |
| X          |           |          |       |

## What to do if a platform isn't approved by pilot day

Posting falls back to draft-only: the worker renders the variants and
stores them in Supabase Storage, but the user copy-pastes the link to
upload manually. The frontend already has the post status enum
(`pending_external_approval`), so wire the UI to surface that state
instead of "posted."

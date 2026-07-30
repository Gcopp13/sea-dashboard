# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**S.E.A. Dashboard** (Getting Results Inc.) — a live, multi-user coaching **SaaS** with paid
subscriptions. "S.E.A." = Strategic · Executable · Accountable. Users track a 120-day vision,
goals, a daily "Anvil" keystone habit, and weekly reviews; coaches connect to advisors and
message them; there's an AI coach, transactional + reminder emails, and push notifications.

- **Live:** https://sea-dashboard.netlify.app
- **This repo is the source of truth.** Deploys to the Netlify site "sea-dashboard".
- Note: a folder `~/Desktop/Sea-dashboard ` (trailing space) on this machine is a STALE,
  unrelated old snapshot — ignore it. All real work happens here.

## Architecture

Single self-contained frontend + Netlify Functions backend + Supabase data. No bundler/build.

### Frontend — `index.html` (~400 KB, the deployed file)
- **React 18 (UMD) + Babel Standalone + Tailwind, all via CDN.** JSX is transpiled **in the
  browser** at load time — there is no build step. Edit `index.html` directly and reload.
- Other `S.E.A. Dashboard*.html` files are historical versions; **`index.html` is live.**
- Also loaded from CDN: `@supabase/supabase-js` (UMD), the Sentry browser SDK, and
  Cloudflare Turnstile.
- Talks to the backend at `/.netlify/functions/*`. The Supabase **JS client is used for auth
  only** (`supabase.auth.*`); all data access goes through the REST API directly
  (`/rest/v1/profiles`, `/rest/v1/planner_data`, `/rest/v1/coach_conversations`).
- `sw.js` (mirrored to `public/sw.js`) is a service worker: versioned cache, network-first
  for HTML so returning users get the latest deploy. **Bump `SW_VERSION` in `sw.js` on any
  user-facing change** or returning users may get a stale cached page.

### Backend — `netlify/functions/*.js` (16 functions, Node 20)
Called from the client at `/.netlify/functions/<name>`. What they do / what they use:
- **Payments:** `stripe-checkout`, `stripe-webhook` — Stripe.
- **AI coach:** `ai-coach` — proxies the Anthropic API (key stays server-side); requires a
  valid Supabase user JWT, or it's an open unmetered Claude proxy billed to us.
- **Email (Resend):** `welcome-email`, `send-summary`, `weekly-summary`, `send-daily-brief`,
  `re-engagement`, `reset-password`, `cycle-heads-up`, `cycle-recap-email`.
  `cycle-heads-up` emails users entering the final week of a 120-day cycle;
  `cycle-recap-email` is the 120-day recap sent when a user chooses "Start Fresh".
- **Push (web-push / VAPID):** `save-push-subscription`, `coach-nudge-push`,
  `evening-reminder`, `weekly-ritual-reminder`. `send-push` is a **shared helper** required
  by the others — not a client-callable endpoint.
- Most functions read/write Supabase over its REST API with the service key.

Coach↔advisor messaging has **no backend function** — the client reads and writes
`coach_conversations` through Supabase REST directly. `coach-nudge-push` is the only
coach-related function left.

Supporting files under `netlify/functions/`:
- `_lib/sentry.js` — zero-dependency Sentry error reporting (posts envelopes with native
  `fetch`); called from 14 of the 16 functions, and a no-op unless `SENTRY_DSN` is set.
- `data/*.afm` — vendored pdfkit font metrics. esbuild inlines pdfkit's JS but not these,
  so `netlify.toml` ships them via `included_files` for `send-daily-brief`'s PDF path.

### Scheduled functions (crons in `netlify.toml`, times in UTC)
Netlify triggers these directly — no HTTP request — so handlers must not depend on the body.
- `evening-reminder` — `0 23 * * *` (daily, 7 PM EDT) — evening review push
- `re-engagement` — `0 13 * * *` (daily, 9 AM EDT) — re-engagement email
- `coach-nudge-push` — `17 * * * *` (hourly at :17) — coach nudge push
- `weekly-ritual-reminder` — `0 12 * * 0` (Sundays, 8 AM EDT) — weekly ritual push
- `weekly-summary` — `0 12 * * 0` (Sundays, 8 AM EDT) — weekly summary email
- `cycle-heads-up` — `0 13 * * 1` (Mondays, 9 AM EDT) — 120-day final-week heads-up

`netlify.toml` also pins `/sw.js` with a 200 redirect so the SPA catch-all (`/*` →
`/index.html`) doesn't swallow the service worker.

### Data + auth — Supabase project "sea-planner" (ref `vilsfabrovxwgdrhkvso`)
- Supabase Auth (email/password + magic link) for accounts.
- Tables: `planner_data` (per-user planner JSON), `profiles`, `coach_conversations`.
- `profiles` columns the code touches: `full_name`, `email`, `role`, `subscription_status`,
  `coach_id`, `re_engagement_sent_at`. `coach_code` is no longer referenced anywhere in this
  repo — it may still exist in the live schema; check Supabase before relying on it.
- Functions use the **service key** (`SUPABASE_SERVICE_KEY`); the client uses the anon key
  embedded in `index.html`.

## Environment variables (set in Netlify, never commit)
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `APP_URL`,
`SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`.
`COMMIT_REF` is also read (Sentry release tagging), but Netlify supplies it — don't set it
by hand.

## Commands (`package.json`)
- `npm run dev` → `netlify dev` — runs site + functions locally on port 8888. Needed for any
  `/.netlify/functions/*` call or Supabase-authed flow to work locally.
- `npm run deploy` → `netlify deploy --prod`.
- `npm run build` → no-op (static site).
- Runtime deps actually `require`d by the functions: `resend`, `web-push`, `pdfkit`.
  `@supabase/supabase-js` and `@anthropic-ai/sdk` are listed in `package.json` but no
  function imports them — Supabase and Anthropic are called with native `fetch`. (The
  client does load supabase-js, from CDN.)

## Deploying updates
Git remote `origin` = `github.com/Gcopp13/sea-dashboard` (branch `main`). Standard flow:
edit → commit → push to `main` → Netlify builds & deploys (`command = "npm install"`,
publish `.`). **Before the first production deploy of a session, confirm whether pushing to
`main` auto-deploys or whether `netlify deploy --prod` is used** — then bump `SW_VERSION`.

## Conventions & gotchas
- **This is a production app with paying users** — no downtime. Test locally with `netlify dev`;
  for risky changes, use a Netlify deploy preview / the `sea-preview-review` site, not prod.
- Edit `index.html` in place; match its terse, dense inline-JSX + Tailwind style. Don't add a
  build step or split files — the in-browser Babel setup depends on the single-file structure.
- Bump `SW_VERSION` in `sw.js` (and keep `public/sw.js` in sync) on user-facing changes.
- Keep secrets in Netlify env only. The Anthropic key must stay in `ai-coach` server-side —
  never move it into `index.html`.
- No test suite/linter/CI. Validate by running the app and exercising the changed flow.
- When debugging production issues, the connected tools can read Netlify function logs,
  Supabase (data/auth/logs), and Resend (email delivery) directly — start there.

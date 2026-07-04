# ApartmentBuddy.ai — Claude Code Context

## What this is
AI-powered apartment finder SaaS. Users chat with AI to define preferences, then the app scrapes listings from multiple sources, scores them with Claude Haiku, and surfaces the best matches. Pro users get continuous monitoring every 6 hours via Vercel Cron.

## Stack
- **Next.js 15 App Router** + TypeScript + Tailwind
- **Supabase** — auth (magic link) + PostgreSQL (RLS enabled)
- **Apify** — web scraping (Zillow, Apartments.com, Craigslist, Trulia)
- **Anthropic Claude API** — chat (`claude-sonnet-4-6`) + listing scoring (`claude-haiku-4-5-20251001`)
- **Stripe** — subscriptions (Free / Pro $29/mo)
- **Vercel** — hosting + cron jobs (6-hour monitor for Pro users)

## Repo
https://github.com/mhaveles/apartmentbuddy.ai

## Production URL
https://apartmentbuddy-ai-iyim.vercel.app

## Business model
- **Free**: 1 one-time search
- **Pro**: $29/mo — continuous monitoring, searches every 6 hours via cron

## Key files
- `src/lib/apify.ts` — all Apify scraping logic (`start*Scrape()` + `fetchScrapedListings()`)
- `src/lib/anthropic.ts` — Anthropic client, SYSTEM_PROMPT, SCORING_PROMPT
- `src/app/api/search/route.ts` — user-triggered search (fires Apify actors, returns immediately)
- `src/app/api/apify/webhook/route.ts` — Apify webhook handler (receives results, upserts + scores listings)
- `src/app/api/cron/monitor/route.ts` — Vercel Cron job for Pro users
- `src/app/api/test-apify/route.ts` — diagnostic endpoint to confirm Apify connectivity
- `src/app/api/chat/anonymous/route.ts` — pre-signup onboarding chat, persists to `anon_sessions` (not `chat_sessions`/`chat_messages`, which are for logged-in users)
- `supabase/schema.sql` — full DB schema (source of truth)

## Architecture: async scraping via webhooks
The app uses Apify webhooks to avoid Vercel's 10s timeout:
1. `/api/search` fires `actor.start()` x4 in parallel (~500ms), returns `searchRunId` immediately
2. Apify POSTs to `/api/apify/webhook` when each actor finishes (2-5 min later)
3. Webhook fetches dataset, upserts listings, scores with Claude Haiku, decrements `apify_runs_pending`
4. When `apify_runs_pending` hits 0, `search_run` is marked `completed`

## DB: important columns on `search_runs`
- `apify_runs_pending` — counts down from 4 (or 2 for cron) as webhooks arrive
- `apify_run_ids` — jsonb map of `{ zillow, apartments_com, craigslist, trulia }` run IDs

## Supabase migrations
**Run directly in Supabase SQL Editor** (not via CLI — no migration files).

**Important:** `schema.sql` is the source of truth for what the schema *should* be, but editing it does nothing by itself — there's no automated apply step, and no tracking of what's actually been run against production. It's easy to add a table/function to `schema.sql` in the same commit as code that depends on it, ship the code, and have it fail in prod because the DDL was never actually executed. (This happened with `anon_sessions` / `migrate_anon_session()` — added to `schema.sql` in the same commit as `/api/chat/anonymous`, but never run against the live DB, so every request silently 500'd until caught.) **Whenever you add or change anything in `schema.sql`, immediately run that exact block in the Supabase SQL Editor before/alongside shipping the code that depends on it** — don't treat updating the file as the migration.

Example (already applied):
```sql
alter table public.search_runs
  add column if not exists apify_runs_pending int not null default 0,
  add column if not exists apify_run_ids jsonb not null default '{}';

create or replace function public.decrement_apify_runs_pending(run_id uuid)
returns public.search_runs as $$
  update public.search_runs
  set apify_runs_pending = greatest(0, apify_runs_pending - 1)
  where id = run_id
  returning *;
$$ language sql security definer;
```

## Environment variables (all set in Vercel)
- `APIFY_API_TOKEN`
- `ANTHROPIC_API_KEY`
- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `CRON_SECRET` — shared secret for cron + webhook auth
- `NEXT_PUBLIC_APP_URL` — absolute URL (e.g. `https://apartmentbuddy-ai-iyim.vercel.app`) needed for Apify webhooks

## Vercel cron
Defined in `vercel.json` — runs `/api/cron/monitor` every 6 hours. Auth: `Authorization: Bearer <CRON_SECRET>` header.

## Testing Apify connectivity
```
GET /api/test-apify?secret=<your-CRON_SECRET-value>
```
Should return `{ runId, apifyConsoleUrl }` in under 1 second. Then check Apify dashboard.

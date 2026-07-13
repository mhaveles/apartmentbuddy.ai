# Rating (Good Fit / Bad Fit) flow — investigation notes

Date: 2026-07-12
Branch: investigate/rating-function
Investigation only — no code changes made.

## 1. What fires on click

`src/app/(dashboard)/listings/page.tsx`
- The "Good fit" / "Bad fit" buttons (~line 591-604) call `updateListing(ul.id, { vote: 1 | -1 | null })`.
- `updateListing()` (line 196) does `fetch('/api/listings', { method: 'PATCH', body: { id, vote } })`.

## 2. What the handler actually does

- The route (`src/app/api/listings/route.ts`, `PATCH`, line 63) is **fully implemented**, not a stub:
  - Looks up the listing's current `score`.
  - Writes `vote` and a computed `score_vote_delta` (`score * vote`) to `user_listings` via Supabase.
  - After a vote, counts the user's total non-null votes; at 10 and every 5 after that, it fires `/api/preferences/recalibrate` in the background (fire-and-forget, not awaited).
- So yes — it hits Supabase, and it's wired to a real feature (auto-recalibration of scoring priorities), not dead code.

**Bug found in the client, independent of anything below:** `updateListing()` never checks `res.ok` or reads the response body — it unconditionally does `setListings(prev => prev.map(...))` to optimistically reflect the vote in the UI. So the button *will* visually highlight green/red on click even if the server-side write silently failed. This means the UI cannot be trusted as confirmation that a vote persisted.

**Bug found in the route:** both Supabase calls in the `PATCH` handler destructure `data` but discard `error`:
```ts
const { data } = await supabase.from('user_listings').update(updates)...single()
```
If the update fails (bad column, RLS denial, whatever), the route still returns `200` with `data: null`. Nothing surfaces the failure — not to the client, not to logs.

## 3. Does the Supabase write actually succeed? — likely broken, same root cause as the anon_sessions incident

This is the same class of bug CLAUDE.md already documents for `anon_sessions`: a schema change and the code that depends on it shipped together, but the migration itself may never have been run against production.

Timeline from git history:
- `a358520` "Add vote-based priority recalibration…" — added the Good fit/Bad fit buttons, the `PATCH` vote handling, and `/api/preferences/recalibrate`. **This commit made zero changes to `schema.sql`.** At this point the code already assumes `user_listings.vote` and `score_vote_delta` exist.
- `d9cd065` "Add intent-based chat sessions…" (later) — this is the commit that finally added `vote integer` and `score_vote_delta integer` to the `create table public.user_listings` statement in `schema.sql`, plus a commented-out `-- Migration: add vote column to user_listings / -- alter table ... add column if not exists vote smallint check (vote in (-1, 1))` block.

Per CLAUDE.md's own process, `schema.sql` is documentation only — edits to it do nothing to the live table. The only real migration step is the ALTER statement actually being pasted into the Supabase SQL Editor and run. There's no commit message, memory entry, or other record confirming that ALTER was ever executed. (Contrast with the `apify_runs_pending` migration earlier in the same file, which is explicitly called out in CLAUDE.md as "already applied.")

**I could not directly confirm the live schema** — no `.env`/Supabase credentials are available in this worktree. This needs a direct check:
```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'user_listings';
```
or just open the `user_listings` table in the Supabase Table Editor and look for `vote` / `score_vote_delta` columns.

If those columns are missing, every vote PATCH fails at the Supabase layer, `error` is swallowed (see §2), the route still returns 200, and the client still paints the button green/red — so it *looks* like it worked in the moment, but nothing is persisted (confirmed by a page reload, or by checking the row in Supabase directly).

RLS is not the suspect here — `user_listings` has a permissive `for all using (auth.uid() = user_id)` policy (schema.sql:159), same policy used successfully by `is_saved`/`is_dismissed` updates on the same route.

## 4. Where the chain breaks

Most likely break point, in order of confidence:
1. **DB layer** — `vote`/`score_vote_delta` columns possibly never migrated into production `user_listings`, despite being written by application code since `a358520`. (Needs direct DB confirmation — see §3.)
2. **API layer** (compounding, real regardless of #1) — the route silently drops any Supabase `error`, so even if #1 is fixed, any future write failure (RLS change, constraint violation, etc.) will keep returning a false-success 200.
3. **UI layer** (compounding, real regardless of #1) — the client updates React state optimistically without checking `res.ok`, so the button will "light up" even on a failed write. This is why the user sees inconsistent/no feedback rather than a clear error.

The UI is not a stub and the route is not a stub — this isn't a "feature was never built" situation, it's "feature was built end-to-end but the schema migration step was likely skipped, and two layers of missing error handling hide that fact."

## 5. Connection to the check-in chat's read-only limitation

**These are the same pipeline, not separate code paths.** The rating buttons are the upstream trigger for the check-in feature:

1. Vote PATCH → after every 5th vote past 10 → fires `/api/preferences/recalibrate`.
2. `recalibrate` requires **at least 10 rows** in `user_listings` with non-null `vote` (`src/app/api/preferences/recalibrate/route.ts:33`) — if it finds fewer than 10, it no-ops (`{ skipped: true }`).
3. If it has enough votes, it calls Claude to infer new priority weights + an "insight" string, and writes them to `preferences.priorities_suggestion` / `priorities_insight`.
4. `GET /api/preferences` surfaces those fields; `listings/page.tsx` picks them up and renders the violet "Scoring insight based on your votes" check-in card — that's the "check-in chat" surface.
5. The check-in chat itself (`sendCheckIn`) only reads/writes `chat_sessions`/`chat_messages` via `/api/chat` — it doesn't persist anything to `preferences` on its own. It's read-only in the sense you described: nothing the user types there changes their actual scoring weights. The only real write is the separate "Apply these weights" button → `/api/preferences/apply-priorities`, which you already confirmed works.

**Implication:** if votes aren't actually persisting (§3), step 2 never accumulates real votes server-side, so `recalibrate` never fires with meaningful data (or never fires at all), so the check-in card may rarely or never appear for real users — independent of whatever is separately limiting the check-in chat itself to being read-only. Fixing the vote persistence bug is a prerequisite for the check-in/recalibration feature working at all, not just a cosmetic issue on the listings page.

## Suggested next step (not done — investigation only)
Confirm live schema directly (Supabase SQL Editor or Table Editor) for `user_listings.vote` / `user_listings.score_vote_delta`. If missing, run the ALTER from schema.sql:194. Regardless of that result, the two silent-error-swallowing spots (§2, §3) should be fixed so this class of bug surfaces immediately next time instead of hiding for another release cycle.

# Chat persistence — implementation plan

Date: 2026-07-13
Branch: this worktree is actually on `investigate/chat-architecture` (not `plan/chat-persistence` as expected — that branch exists but is checked out in a different, locked worktree at `.claude/worktrees/plan+chat-persistence`). Flagging in case this plan needs to land there instead.
Planning only — no code changes made. `CHAT_ARCHITECTURE_INVESTIGATION.md`, referenced as prior context, does not exist anywhere in this repo (not on this branch, not in git history, not untracked) — the facts below were re-derived directly from current code, cited by file:line.

## 0. Confirmed current state (re-derived from code)

- **`conversations`** (`supabase/schema.sql:57-64`): `id, user_id, messages jsonb, preferences_extracted, created_at, updated_at`. This is the actual message store — every intent (onboarding, refinement, check-in, deep-dive) writes here via `src/app/api/chat/route.ts`.
- **`chat_sessions`** (`schema.sql:253-268`): `id, user_id, intent, status ('open'|'resolved'), context jsonb, created_at, resolved_at`. Pure metadata — **no FK to `conversations`**. Client code tracks two independent ids per surface (e.g. `checkInSessionId` / `checkInConversationId` at `listings/page.tsx:30-31`, `sessionId` / `conversationId` in `DeepDiveModal` at `listings/page.tsx:675-676`) and nothing in the DB links them.
- **`chat_messages`** (`schema.sql:270-283`): confirmed zero writers anywhere in `src/`. Only reader is `GET /api/chat/sessions/[id]/messages/route.ts`, which nothing calls. Staying dead per your instruction.
- **`/chat` page resume** (`chat/page.tsx:50-61`): calls `GET /api/conversations/latest` (`api/conversations/latest/route.ts`), which does `.from('conversations').order('updated_at', desc).limit(1)` — **the single most recent conversation row for the user, regardless of intent**. Since check-in and deep-dive both write rows to the same `conversations` table and bump `updated_at` on every message, a user who does a deep-dive chat and then reopens `/chat` can have the preferences page load a deep-dive conversation. This is a real bug this plan fixes as a side effect, not a hypothetical.
- **Onboarding vs. refinement**: `getSystemPrompt()` (`anthropic.ts:185-193`) already switches on `intent`, and `REFINEMENT_PROMPT` (`anthropic.ts:118`) is fully written. But `chat/page.tsx` only ever sends `intent: 'onboarding'` (line 115, gated on `onboardingSessionId` being set), and once `preferencesExtracted` flips true it stops sending `intent` at all (falls through to `SYSTEM_PROMPT` = `ONBOARDING_PROMPT`, `anthropic.ts:116`). Confirmed zero callers pass `intent: 'refinement'` anywhere in `src/`.
- **Deep-dive** (`DeepDiveModal`, `listings/page.tsx:674-761`): `init()` unconditionally `POST`s `/api/chat/sessions` (new row) then `POST`s `/api/chat` with no `conversationId` (new row), every time the modal opens — confirmed no persistence, reopening the same listing starts over.
- **Check-in** (`listings/page.tsx:223-303`): correctly ephemeral already — new `chat_sessions` row per suggestion, new `conversations` row on first reply. `applyCheckIn()` (line 270-288) posts `{}` to `/api/preferences/apply-priorities`. That route (`api/preferences/apply-priorities/route.ts:9-10, 28`) already accepts an optional `reply: string` and stores it as `preferences.user_reply`, which `recalibrate/route.ts:19-23,88-91` already reads and clears. **Route needs no changes** — this is purely a client-side wiring gap.
- **Supabase clients** (`src/lib/supabase/{server,client}.ts`): `createClient()` is cookie-bound (RLS as the logged-in user); `createServiceClient()` takes no cookies and always authenticates as service role, specifically to avoid the anon_sessions bug where a user's session silently overrode the service-role key. Every chat-related route today correctly uses `createClient()`. Nothing in this plan needs `createServiceClient()` — flagged explicitly in §4 below since this is the third time this bug class has come up.
- **`user_listings`** (`schema.sql:110-125`) already has `unique(user_id, listing_id)`, and `UserListing.id` (`types/index.ts:86`) *is* `user_listings.id` — i.e. the row `DeepDiveModal` already receives as `listing.id` is already the natural one-per-(user,listing) key. No need to invent a new tuple lookup for deep-dive.

## 1. Preferences thread (one per user, onboarding → refinement in place)

**Design decision:** don't create a second thread when preferences get extracted — keep the *same* `chat_sessions` row and flip its `intent` from `'onboarding'` to `'refinement'` in place, server-side, the moment extraction succeeds. The client never needs to know which phase it's in; it just always asks "give me my preferences session" and the server returns the right prompt.

This also lets the client collapse to tracking **one id** (`sessionId`) instead of `conversationId` + `onboardingSessionId` — the server resolves the underlying `conversations` row from `chat_sessions.conversation_id`.

**Schema (`supabase/schema.sql`, run directly in Supabase SQL Editor per CLAUDE.md convention):**

```sql
alter table public.chat_sessions
  add column if not exists conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists user_listing_id uuid references public.user_listings(id) on delete cascade,
  add column if not exists last_message_at timestamptz;

-- at most one persistent preferences thread per user
create unique index if not exists chat_sessions_preferences_unique
  on public.chat_sessions (user_id)
  where intent in ('onboarding', 'refinement');

-- atomically find-or-create the calling user's preferences thread
create or replace function public.find_or_create_preferences_session()
returns public.chat_sessions as $$
  insert into public.chat_sessions (user_id, intent, status)
  values (auth.uid(), 'onboarding', 'open')
  on conflict (user_id) where intent in ('onboarding', 'refinement')
  do update set user_id = excluded.user_id  -- no-op; forces RETURNING of the existing row
  returning *;
$$ language sql;
```

(`user_listing_id` and the deep-dive index are added in the same migration block — see §2 — since both alter the same table.)

Not `security definer` — see §4.

**Call sites:**

- **New file** `src/app/api/chat/sessions/preferences/route.ts` — `POST`, no body. Calls `supabase.rpc('find_or_create_preferences_session')`, then if `conversation_id` is set, a second query `from('conversations').select('messages').eq('id', ...).single()`. Returns `{ id, intent, conversation_id, messages }`.
- **`src/app/api/chat/route.ts`** (rewrite — see full spec in §5, this is the shared engine for both preferences and deep-dive): accepts `sessionId` instead of the client picking `conversationId`/`intent`; resolves/creates the `conversations` row via `chat_sessions.conversation_id`; derives the system prompt from `chat_sessions.intent` server-side; flips `intent: 'onboarding' → 'refinement'` in the same UPDATE the moment `preferencesExtracted` becomes true; stamps `last_message_at`.
- **`src/app/(dashboard)/chat/page.tsx`**:
  - `restore()` (lines 38-88): replace the `/api/conversations/latest` fetch + the `sessionStorage`-backed `/api/chat/sessions` POST with a single `POST /api/chat/sessions/preferences`. Load `messages` directly from the response into `setMessages`. Drop `sessionStorage` entirely — the DB is now the single source of truth, so there's nothing to cache client-side.
  - Collapse `conversationId` + `onboardingSessionId` state into one `sessionId`.
  - `sendMessage()` (lines 99-151): body becomes `{ message, sessionId }`; drop the `conversationId` and conditional `intent` fields.
  - Remove the "PATCH session to resolved, clear sessionStorage" block (lines 131-139) — the thread stays open indefinitely now; the intent flip happens inside `/api/chat` automatically.
- **Delete** `src/app/api/conversations/latest/route.ts` — confirmed (via grep) its only caller was `chat/page.tsx`; dead after the above change.

**Find-or-create logic:** `find_or_create_preferences_session()` (SQL function above) does the whole thing atomically via `INSERT ... ON CONFLICT (user_id) WHERE intent IN (...) DO UPDATE ... RETURNING *` against the partial unique index. Two concurrent calls (e.g. React double-invoke in dev, or two tabs) both get the same row back — no separate client-side dedupe needed.

## 2. Deep-dive thread (one per user+listing)

**Schema** — same migration block as §1 (grouped together in one Supabase SQL Editor run):

```sql
-- at most one deep-dive thread per (user, listing)
create unique index if not exists chat_sessions_deep_dive_unique
  on public.chat_sessions (user_id, user_listing_id)
  where intent = 'deep-dive' and user_listing_id is not null;

create or replace function public.find_or_create_deep_dive_session(p_user_listing_id uuid)
returns public.chat_sessions as $$
  insert into public.chat_sessions (user_id, intent, status, user_listing_id)
  select ul.user_id, 'deep-dive', 'open', ul.id
  from public.user_listings ul
  where ul.id = p_user_listing_id and ul.user_id = auth.uid()
  on conflict (user_id, user_listing_id) where intent = 'deep-dive'
  do update set user_id = excluded.user_id
  returning *;
$$ language sql;
```

The `select ... where ul.user_id = auth.uid()` (instead of `insert ... values`) means a `p_user_listing_id` that doesn't belong to the caller yields zero rows — the function returns nothing, and the route should treat a null RPC result as 404. This is the ownership check; not strictly load-bearing for data exposure (`listings` is already readable by all authenticated users, `user_listings` is already RLS-scoped), but it stops a `chat_sessions` row from ever pointing at someone else's `user_listings.id`.

**Call sites:**

- **New file** `src/app/api/chat/sessions/deep-dive/route.ts` — `POST { user_listing_id }`. Calls `supabase.rpc('find_or_create_deep_dive_session', { p_user_listing_id })`; 404 if null; otherwise same message-loading + response shape as the preferences route.
- **`src/app/(dashboard)/listings/page.tsx`**, `DeepDiveModal` (lines 674-761):
  - `init()` (686-728): replace the two-step `POST /api/chat/sessions` → `POST /api/chat` with a fixed opening message, with:
    1. `POST /api/chat/sessions/deep-dive` with `{ user_listing_id: listing.id }`.
    2. If the response has `messages.length > 0` → `setMessages(messages)` (resume — **do not** re-send the "explain why this scored X" opener).
    3. Else → send the existing opener via `POST /api/chat` with `{ message: openingMessage, sessionId }` (first-open-only path).
  - `send()` (741-761): body becomes `{ message: text, sessionId }`, drop `conversationId`.
  - Drop the `conversationId` state var entirely — only `sessionId` is needed now.
  - `handleClose()` (730-739): the existing PATCH-to-`resolved` call can stay as-is; it's cosmetic bookkeeping now (find-or-create doesn't filter by `status`, so a resolved thread is still found and reused on reopen). Flagged as a judgment call in §6, not a required change.

**Find-or-create logic:** same atomic upsert-and-return pattern as §1, scoped by `(user_id, user_listing_id)` instead of `user_id` alone.

## 3. Check-in (client-side fix only)

`applyCheckIn()`, `listings/page.tsx:270-288`:

```ts
async function applyCheckIn() {
  const lastUserReply = [...checkInMessages].reverse().find(m => m.role === 'user')?.content
  await fetch('/api/preferences/apply-priorities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lastUserReply ? { reply: lastUserReply } : {}),
  })
  // ...rest unchanged
}
```

No backend changes — confirmed `apply-priorities/route.ts:10,28` already does the right thing with `reply` once it's actually sent. No new tables/sessions, matching your instruction.

## 4. Future-proofing: `last_message_at`

Added on `chat_sessions` (not `conversations`) — `chat_sessions` is the thread-identity table a future archival job would query ("threads with no activity in 30 days"), and `conversations` rows for check-in are deliberately not tracked this way since they're not meant to be retained.

Populated inside the `/api/chat/route.ts` rewrite (§5): every time a message is appended to a session-linked conversation (preferences or deep-dive — check-in doesn't pass `sessionId` so it's untouched), the same `UPDATE chat_sessions SET ...` that sets `conversation_id`/flips `intent` also sets `last_message_at = now()`. No cleanup job built — column exists and is kept current, nothing queries it yet.

## 5. `src/app/api/chat/route.ts` — the shared rewrite

This is the one file both §1 and §2 depend on, so spelling it out fully. New request shape: `{ message: string; sessionId?: string; conversationId?: string; intent?: ChatIntent }` (`sessionId` is new; `conversationId`/`intent` stay, for check-in's unchanged path).

```
1. auth check — unchanged.
2. if sessionId:
     - load chat_sessions row by id + user_id (404 if missing)
     - resolve conversation:
         - if session.conversation_id → load that conversations row
         - else → create a new conversations row, then UPDATE chat_sessions SET conversation_id = <new id>
     - effective intent = session.intent (server-trusted — ignore body.intent when sessionId is present)
   else:
     - existing behavior verbatim: resolve/create via conversationId, effective intent = body.intent
3. append user message, call Claude with getSystemPrompt(effective intent) — unchanged shape
4. extract prefs — unchanged, gated on effective intent being onboarding/refinement
5. if sessionId and effective intent === 'onboarding' and prefs just got extracted:
     mark intent to flip to 'refinement' in step 6
6. save conversation.messages — unchanged
7. if sessionId: UPDATE chat_sessions SET last_message_at = now(),
     ...(newly-linked conversation_id if step 2 created one),
     ...(intent = 'refinement' if step 5 flagged it)
8. return { message, conversationId, sessionId, preferencesExtracted, ...hasNeighborhoods }
```

Steps 2-and-7's two chat_sessions touches could be one UPDATE if step 2's linking and step 7's stamping are merged — worth doing as a single write when implementing, called out here so it isn't missed as "two round trips" in review.

## 6. RLS / client considerations

Every route touched or added in this plan — existing (`chat/route.ts`, `chat/sessions/route.ts`, `chat/sessions/[id]/route.ts`) and new (`chat/sessions/preferences/route.ts`, `chat/sessions/deep-dive/route.ts`) — uses `createClient()` from `@/lib/supabase/server` (cookie-bound, RLS-scoped as the logged-in user). **None of this needs `createServiceClient()`** — every read/write is already scoped to the calling user's own rows, and existing RLS policies (`chat_sessions`: `auth.uid() = user_id`; `conversations`: `auth.uid() = user_id`; `user_listings`: `auth.uid() = user_id`) are sufficient. This is worth stating explicitly given the recurring wrong-client bug class (anon_sessions' truncated service-role key, and the service-vs-cookie-client distinction `server.ts:27-33` was specifically hardened against) — the fix here is to *not* reach for `createServiceClient()` at all, not to configure it carefully.

The two new SQL functions (`find_or_create_preferences_session`, `find_or_create_deep_dive_session`) are deliberately **not** `security definer` — plain `language sql`, runs as invoker, so RLS applies to the `INSERT` exactly as if the client had issued it directly. `security definer` is reserved in this codebase for cases that need to *bypass* RLS by design (`migrate_anon_session` on a policy-less table) — there's no such need here, and marking these `security definer` would be an unnecessary privilege escalation for no functional benefit.

## 7. Risks, ambiguities, decisions needed

1. **"Start fresh" button** (`chat/page.tsx:90-97, 180-187`) currently only clears local React state — under the new model, `restore()` will just re-fetch and re-display the same persisted thread on next load, so the button would stop doing anything meaningful. Three options, your call: (a) remove it, since the whole point of this pass is that the thread persists; (b) repurpose it to actually archive/reset server-side (new behavior, not in the four numbered scope items — would need a real "reset" endpoint); (c) leave it broken-looking for now. I'd lean (a) but this directly contradicts existing UI copy ("Update preferences" links to the same handler at lines 199, 206), so it's not a pure delete — needs a decision before implementation.
2. **Deep-dive `status: 'resolved'` PATCH on modal close** becomes cosmetic once find-or-create stops filtering by status — fine to leave, but flagging so it's not mistaken for something that still gates reuse.
3. **Message history growth**: `conversations.messages` is an unbounded `jsonb` array rewritten in full on every message (true today, not a regression) — a preferences thread that's now explicitly long-lived (months, pre-archival-job) will make this worse over time. Not fixing in this pass; the future 30-day job is the eventual answer, noted per your instruction not to build it now.
4. **Verify the migration actually gets run.** Per CLAUDE.md's own documented history (`anon_sessions`, twice) and this session's independent finding in `RATING_FLOW_INVESTIGATION.md` (`user_listings.vote` possibly never migrated) — this project has already shipped code assuming a `schema.sql` change was applied when it wasn't. When this plan gets built, the `alter table` + two `create unique index` + two `create or replace function` statements in §1/§2 must be run in the Supabase SQL Editor *before or alongside* shipping `chat/route.ts` and the two new endpoints, not just committed to the file.
5. **Race safety** relies entirely on the two partial unique indexes + `ON CONFLICT ... DO UPDATE ... RETURNING`. Worth a manual double-open test (rapid double-click on a deep-dive listing, or two tabs) once built, to confirm no duplicate `chat_sessions` rows land despite the index — should be airtight but hasn't been run.

## 8. Change footprint

- **Schema**: 1 file (`supabase/schema.sql`) + 1 manual Supabase SQL Editor run (3 `alter`/`create index` statements + 2 functions).
- **New backend files (2)**: `chat/sessions/preferences/route.ts`, `chat/sessions/deep-dive/route.ts`.
- **Rewritten backend file (1)**: `chat/route.ts` (shared engine, §5 — the biggest single piece of this).
- **Deleted backend file (1)**: `conversations/latest/route.ts`.
- **Unchanged backend files, confirmed still correct as-is**: `chat/sessions/route.ts` (still used by check-in's always-create path), `chat/sessions/[id]/route.ts` (still used for the resolve PATCH by all three intents).
- **Frontend files changed (2)**: `chat/page.tsx` (restore/sendMessage/startFresh), `listings/page.tsx` (`DeepDiveModal` init/send, `applyCheckIn`).

**Total: ~7 files touched (2 new, 1 rewritten, 1 deleted, 2 edited, 1 schema) + 1 manual DB migration step.** The backend half (schema + `chat/route.ts` + 2 new endpoints) and frontend half (`chat/page.tsx` + `listings/page.tsx`) are tightly coupled — the frontend changes assume the new request/response shape — so I'd expect this to land as one PR even if built in that logical order, rather than split. This reads as a single, focused terminal pass, not something that needs further splitting.

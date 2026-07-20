# Chunk 2 — Craigslist Scraper Schema Fix + Async Confirmation (Plan)

**Investigation/planning only. No code changed.**
Branch: `chunk-2-craigslist-schema`. Date: 2026-07-20.

Builds directly on `docs/chunk-1-scraper-diagnosis.md` (currently only present, untracked,
in the `chunk-1-scraper-diagnosis` worktree at `/Users/maxen/Desktop/apartmentbuddy/docs/` —
flagging this the same way the anon_sessions/chat_sessions drift was flagged: a doc that only
exists uncommitted in one worktree is easy to lose. Worth committing it somewhere before it's
gone.) That report's root-cause finding: our `startCraigslistScrape()` sends `startUrls` /
`includeDetails` / `maxResults`, but `automation-lab/craigslist-scraper` requires `searchQueries`
and doesn't support `startUrls` at all — the same failure class already fixed once for Zillow.

I re-verified the actor's schema live (two independent fetches of the Apify actor page) rather
than relying solely on the chunk-1 report. Both fetches agree with each other and with chunk-1's
findings, which is good corroboration, but WebFetch summarizes via a model and actor schemas can
drift — **treat field names/enums below as high-confidence, not certain, until the live test run
in the Testing section confirms them against a real SUCCEEDED run.**

---

## 1. Exact input object for a Denver user (maxPrice 2500, minBeds 1, maxBeds 2)

```json
{
  "searchQueries": [],
  "city": "denver",
  "category": "housing",
  "maxResults": 100,
  "includeDetails": true,
  "maxPrice": 2500
}
```

*(Updated post-live-test — see "Testing results" below. Originally planned as
`searchQueries: ["apartment"]`; live testing showed that excluded 9/10 real listings, so the
implementation uses `[]` instead.)*

Field-by-field:

- **`searchQueries: []`** — required by the schema, but see §3/Testing results: empty is accepted
  and gives far better recall than a keyword.
- **`city: "denver"`** — mapped from `neighborhoods[0].city`. See §2.
- **`category: "housing"`** — the actor's enum has no apartment-specific subcategory; `housing`
  is the correct top-level bucket. See §4.
- **`maxResults: 100`** — unchanged from current code. Not in scope for this chunk to retune.
- **`includeDetails: true`** — unchanged; required to get `description`, `imageUrls`, and
  (per the output schema) `latitude`/`longitude`. See §7.
- **`maxPrice: 2500`** — `Math.round(preferences.max_rent / 100)`, same pattern as Zillow/Trulia.
  Only spread in when `preferences.max_rent` is set (conditional, matching existing style).
- **No `minBeds`/`maxBeds`/`minBedrooms`/`maxBedrooms` field** — deliberate. The actor has no
  native bedroom filter (confirmed in chunk-1 and re-confirmed here). Per the agreed architecture
  direction, bedroom targeting moves entirely to scoring, so `minBeds: 1, maxBeds: 2` from the
  scenario **does not appear in the Craigslist actor input at all.** This is the biggest behavior
  change from the current code, which encodes `min_bedrooms`/`max_bedrooms` into the (unsupported)
  `startUrls` query string today.
- **No `minPrice`** — nothing in `preferences` currently maps to a rent floor; omitted like the
  other two scrapers.
- **No `maxRequestRetries`** — leaving the actor default (3) rather than overriding; no evidence
  yet that Craigslist needs the more aggressive retry handling Trulia does.

---

## 2. Mapping user city → Craigslist subdomain

Source: `neighborhoods[0].city` (free text from `monitored_neighborhoods`, e.g. `"Denver"`).

The actor's `city` field is an **enum of Craigslist subdomains** (`denver`, `newyork`, `sfbay`,
`losangeles`, `washingtondc`, …), not free text. Most US cities map cleanly with
`city.toLowerCase().replace(/\s+/g, '')` — this is actually the same normalization
`buildCraigslistUrl()` already does today for constructing the (unsupported) search URL, so the
logic isn't new, just repurposed. It's correct for `Denver→denver`, `Austin→austin`,
`Chicago→chicago`, `Seattle→seattle`, `Boston→boston`, `Portland→portland`, `Dallas→dallas`,
`Atlanta→atlanta`, `Phoenix→phoenix`, `Miami→miami`, `Philadelphia→philadelphia`,
`Minneapolis→minneapolis`.

It silently breaks for the metro-area subdomains that don't match their city name:
`"San Francisco"` → naive gives `sanfrancisco`, actual subdomain is `sfbay`. `"Washington"` /
`"Washington DC"` → naive gives `washington` or `washingtondc` depending on how the field is
stored; actual subdomain is `washingtondc`. There may be others (e.g. Bay Area cities like
Oakland/San Jose also resolve to `sfbay` on real Craigslist, not their own subdomains).

**Plan:** small explicit override map for the known-irregular cases (San Francisco Bay Area
cities → `sfbay`, Washington/DC variants → `washingtondc`, plus any others we find have their own
subdomain naming during testing), falling back to the naive normalization for everything else.

**Unmappable/unsupported city:** don't guess and fire anyway. If neither the override map nor the
naive normalization produces something we're reasonably confident is valid, **skip starting the
Craigslist actor for that neighborhood** (log a warning, return early) rather than sending a value
the actor's enum validation will reject. This mirrors the existing `Promise.allSettled` pattern in
`search-trigger.ts` — one source failing to start doesn't block the other two, and
`apify_runs_pending` is only incremented for sources that actually started (see §6). This is
strictly better than the current failure mode, where a bad input silently produces zero results
that look identical to "ran fine, found nothing."

---

## 3. `searchQueries` — recommendation

**Recommend a single generic query: `["apartment"]`.** Not bedroom-derived phrasings.

Reasoning:
- `category: "housing"` already scopes the search to Craigslist's housing section, so
  `searchQueries` is mainly a keyword filter layered on top of that, not the primary scoping
  mechanism.
- Bedroom-derived queries (`"one bedroom"`, `"two bedroom"`) would make search **recall** depend
  on the user's bedroom preference, which contradicts the agreed direction of keeping bedrooms
  purely a soft/scoring-time filter. A listing titled "Charming updated unit near downtown" with
  2 actual bedrooms would never surface if we're only querying `"two bedroom"` — this is a worse
  failure mode than not filtering at all, because it fails silently.
- A single broad term keeps behavior predictable and avoids over-fitting to a query pattern we
  haven't validated against real Craigslist search-box behavior yet (unclear whether
  `searchQueries` matches title-only or full listing text — chunk-1 didn't establish this and
  neither did today's schema fetch).
- Actor docs say `searchQueries` can be empty "to browse all listings in the category without
  keyword filtering," which would arguably maximize recall even more than `["apartment"]` — but
  the schema also marks it `required`, which is a direct contradiction I can't resolve from docs
  alone. **Test both empty `[]` and `["apartment"]` in the live test run (Testing section) and
  keep whichever the actor actually accepts and returns reasonable volume for.**

---

## 4. `category` value

**`"housing"`.** The actor's category enum is coarse (`for_sale`, `housing`, `jobs`, `services`,
`gigs`, `community`) — there's no separate "apartments for rent" vs "rooms/shared" vs "sublets"
subcategory exposed as a distinct enum value the way raw Craigslist URLs expose `apa` vs `roo` vs
`sub`. `housing` is the only value that includes apartment rentals at all, so it's also the only
correct choice, even though it will pull in some non-apartment housing content (room shares,
housing wanted, etc.) that `searchQueries` and downstream scoring need to help filter out.

---

## 5. Fallback if Craigslist returns zero results

**Non-fatal, but log a distinguishable signal — not silent.** Concretely: the webhook handler
already logs `Fetched ${listings.length} listings for ${source}` (webhook/route.ts:95) for every
source unconditionally, so a zero-result Craigslist run is already visible in logs today without
new code. What's currently missing is a way to tell "zero results because Craigslist genuinely had
nothing for this search" apart from "zero results because our input was schema-invalid and the run
never really searched anything" — which chunk-1 established is exactly what's been happening. This
plan doesn't propose new persistent monitoring infrastructure (out of scope for this chunk), but
after the schema fix, a zero-result Craigslist webhook becomes a meaningful signal instead of an
expected one, and existing logs are sufficient to catch it manually. Flagging as a good candidate
for the "open issues" monitoring backlog (see `project_open_issues.md`) if it keeps recurring
post-fix.

---

## 6. Is Craigslist already async? (verifying chunk-1's claim)

**Confirmed — yes, already fully async, same as Zillow and Trulia. No blocking code found.**

- `src/lib/search-trigger.ts:105-109`: all three scrapers are started via
  `Promise.allSettled([startZillowScrape(...), startCraigslistScrape(...), startTruliaScrape(...)])`
  — `allSettled`, not `all`, and none of the three `start*Scrape()` functions await actor
  completion.
- `startActor()` (`apify.ts:82-98`) is a single `fetch()` POST to
  `/acts/{id}/runs?...&webhooks=...` that returns as soon as Apify acknowledges the run started —
  it returns `data.data.id` (the run ID), not run results.
- `/api/search/route.ts` POST handler (route.ts:5-33) calls `triggerSearchForUser` and returns its
  result directly with no polling loop.
- Actual results only ever arrive via `/api/apify/webhook`, driven by Apify's own
  `ACTOR.RUN.SUCCEEDED`/`ACTOR.RUN.FAILED` webhook events (`buildWebhooks()`,
  `apify.ts:68-80`), fully decoupled from the request/response cycle of `/api/search`.

**Conclusion: no "unblock Craigslist" code work is needed in the implementation phase.** The
async architecture is already uniform across all three sources. The reason Craigslist has looked
like it "hangs" is entirely the schema bug (§ chunk-1 finding 2b) combined with the 15-minute
client-side staleness fallback in `GET /api/search` (route.ts:71-83) — not a missing async path.
Implementation should focus purely on the input-schema rewrite; I don't expect to touch
`search-trigger.ts` or `/api/search/route.ts` at all for the "run in background" part of the goal.

---

## 7. Do Craigslist listings include `lat`/`lon`?

**Yes, conditionally.** Per the actor's output schema (confirmed via live fetch): `latitude` and
`longitude` fields exist on listing items, but only populate when `includeDetails: true` **and**
the individual listing's detail page actually has coordinate data available (not guaranteed for
every post). We already set `includeDetails: true` in current code and the plan keeps it, so this
should carry forward without any change needed for Chunk 5's geo-in-scoring work. Two caveats to
verify in the live test (not assumed from docs alone): (a) whether `latitude`/`longitude` show up
as top-level fields or nested (the way Trulia's actor nests location data), which affects
`validateCraigslistItem()`'s parsing, and (b) what fraction of real Denver listings actually carry
non-null coordinates in practice, since chunk-1 couldn't get a live SUCCEEDED run to check this
against.

---

## Summary of code changes for the implementation phase (pending approval)

1. Rewrite `startCraigslistScrape()` in `src/lib/apify.ts` to send
   `{ searchQueries, city, category, maxResults, includeDetails, maxPrice? }` instead of
   `{ startUrls, includeDetails, maxResults }`.
2. Add a city → Craigslist-subdomain mapping helper (small override map + normalized fallback),
   replacing `buildCraigslistUrl()`'s domain-construction logic; skip firing the actor (log +
   return) when a neighborhood's city can't be confidently mapped.
3. Remove `buildCraigslistUrl()` entirely — its URL-building approach depended on the unsupported
   `startUrls` field and geo/bedroom query params the actor doesn't accept. No other function
   calls it.
4. Update `validateCraigslistItem()` in `apify.ts` if `latitude`/`longitude` need mapping into
   `ScrapedListing` (currently the interface has no lat/lon field at all — worth checking whether
   Chunk 5 wants that added now or later; flagging, not deciding, since it's outside this chunk's
   stated scope of "just fix the schema + confirm async").
5. No changes planned to `search-trigger.ts`, `/api/search/route.ts`, or
   `/api/apify/webhook/route.ts` — §6 found nothing blocking there.
6. Zillow and Trulia scrapers untouched, per instructions.

## Testing results (live, post-implementation, 2026-07-20)

Ran the actor directly via Apify's `run-sync-get-dataset-items` endpoint (not through our own
webhook — no `NEXT_PUBLIC_APP_URL`/deployed preview was available locally) with the exact input
shape `startCraigslistScrape()` now sends, against `city: "denver", category: "housing"`:

- **Run status:** `HTTP 201` / dataset returned on every call — actor completes successfully with
  the new schema (previously this input shape never even validated).
- **`searchQueries: []` vs `["apartment"]`:** empty array accepted despite the schema marking it
  required. Sampled 10 results with `searchQueries: []` — 9/10 titles did **not** contain the
  literal word "apartment" (e.g. "The Amenities You Deserve at Rates You'll Love", "Sweet Studio
  Condo..."). Confirms §3's recommendation was directionally right but the specific keyword choice
  was wrong — **switched to `searchQueries: []`** in the implementation to avoid silently
  dropping most real listings.
- **`maxPrice` unit — resolved:** dollars, not cents. `maxPrice: 2500` against Denver returned
  20/20 listings priced $143–$2,366, all ≤ $2,500; baseline (no `maxPrice`) topped out at the same
  ~$2,366 ceiling in that sample, and would have returned near-zero results under a
  cents-interpretation (which would cap real filtering at ~$25/mo). Matches the existing
  Zillow/Trulia dollar-conversion convention — no change needed to
  `Math.round(preferences.max_rent / 100)`.
- **`city: "denver"`:** accepted as-is via the naive-normalization path (no override needed for
  this city).
- **lat/lon — resolved:** top-level `latitude`/`longitude` fields, non-null on 20/20 sampled
  listings with `includeDetails: true`. `extractLatLon()`'s primary check (`item.latitude`)
  handles this directly; nested fallbacks are unexercised but kept defensively.
- **Field parsing sanity-checked against a real item:** `bedrooms: "1BR / 1Ba"` parses to
  `bedrooms: 1, bathrooms: 1` correctly via existing regex; `price: "$1,680", priceNumeric: 1680`
  → `rent: 168000` (cents) correctly; empty `sqft: ""` → `null` correctly; `postedAt` within 30
  days → not dropped as stale. No changes needed to `validateCraigslistItem()`'s existing
  bedroom/price/sqft parsing — only the new lat/lon extraction was added.

**Not tested:** the full webhook → DB upsert → scoring round-trip (would require either a deployed
preview URL or writing directly against production with a synthetic `search_run`/user context,
neither of which was safe to do unilaterally). Recommend one real search from the deployed app
before considering this fully closed — the actor-level behavior is now confirmed correct, but the
save/dedup/scoring path for Craigslist listings specifically hasn't been exercised end-to-end
since the rewrite.

**Process note:** while restoring test credentials, `vercel env pull` was run against `.env.local`
in this worktree, which is a symlink to `/Users/maxen/Desktop/apartmentbuddy/.env.local` (the
`chunk-1-scraper-diagnosis` worktree). Vercel's CLI cannot read back values for env vars marked
"Sensitive" and silently pulls them as empty strings instead of erroring — this zeroed out
`ANTHROPIC_API_KEY`, `APIFY_API_TOKEN`, `CRON_SECRET`, `STRIPE_SECRET_KEY`, and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` in that shared file. The user re-supplied a working
`APIFY_API_TOKEN` for this session and plans to rotate it (and the other exposed values)
afterward. Worth checking that shared `.env.local` is in a good state before relying on it again,
and consider un-marking "Sensitive" on these vars in Vercel if `vercel env pull` should keep
working for local dev going forward.

---

**Implementation complete, live-tested, and reported per instructions.**

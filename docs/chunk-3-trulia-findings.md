# Chunk 3 — Trulia Findings (live Apify Console data)

**Investigation only. No code, config, or Apify actor inputs were changed.**
Branch: `chunk-3-trulia-diagnosis`. Date: 2026-07-20.

This closes the two open questions from `docs/chunk-1-scraper-diagnosis.md` that Chunk 1 could not answer without live Apify Console access (`APIFY_API_TOKEN` was not present in that environment either; it was obtained for this session directly from the user and used in-memory only — never written to disk or into this report).

## Method

Pulled the full 24-run history for `igolaizola/trulia-scraper` on our account via the Apify REST API (`/v2/acts/igolaizola~trulia-scraper/runs`), then fetched each run's stored `INPUT` (from its key-value store), execution log, and dataset for the runs matching Chicago and Birmingham "south side." One new run was triggered to test an untested fallback tier (see Birmingham section). A live Trulia.com browser session was also used to sanity-check the Chicago result count against the site directly.

---

## Chicago — confirmed root cause: hypothesis (a), our own filters

Two historical runs for Chicago exist in the account, both against `location: "Heart of Chicago, Chicago, IL"` — a small named micro-neighborhood inside Chicago's Pilsen/Lower West Side area, not the whole city:

| Run ID | Started | Status | Duration | Items |
|---|---|---|---|---|
| `p9cj7DgVjQbo1BRao` | 2026-07-14T16:01:03Z | SUCCEEDED | ~3.4s | 12 |
| `tfG99aDnNy2mv8NwL` | 2026-07-14T15:51:53Z | SUCCEEDED | ~3.0s | 12 |

Full input for `p9cj7DgVjQbo1BRao` (fields the actor didn't get from us default to 0/false/""):
```json
{
  "location": "Heart of Chicago, Chicago, IL",
  "operation": "rent",
  "maxItems": 50,
  "maxPrice": 2500,
  "minBeds": 2,
  "maxBeds": 2,
  "minBaths": 1,
  "unitAmenities": ["washerdryer"],
  "buildingAmenities": ["garage"]
}
```

Log (complete, no truncation/errors):
```
2026-07-14T16:01:05.149Z INFO 🚀 Starting Trulia Scraper
2026-07-14T16:01:05.471Z INFO proxy configured ✅
2026-07-14T16:01:06.501Z INFO 📦 Saved results current=12 total=12
2026-07-14T16:01:06.576Z INFO ✅ Reached total results total=1
2026-07-14T16:01:06.576Z INFO 👋 Finishing Trulia Scraper
```

`current=12 total=12` is the actor's own instrumentation reporting that it saved everything Trulia's GraphQL search returned — not a page limit and not our 50-item cap being hit. No proxy block, no captcha, no GraphQL error. This rules out hypothesis (b) (partial/early termination) cleanly — the run completed normally and reported an accurate, self-consistent total.

**Filter math backs this up.** A sample listing from the run (`1651 W 19th St #3F, Chicago, IL 60608`) confirms the location resolved correctly. Checking Trulia's own site for the broader containing zip code (60608, unfiltered, all bed/bath/price combos) shows **314 total rentals**. "Heart of Chicago" is a few-block micro-neighborhood inside that zip — not the whole zip — and the search additionally required exactly 2BR (not 1-2BR — `minBeds`/`maxBeds` were both pinned to `2`), a $2,500 price cap, an in-unit washer/dryer, and a garage. Narrowing a already-small area down to that exact combination landing at 12 is a normal, expected outcome, not a bug.

Also worth noting for context: Trulia's own front-end search-bar autocomplete doesn't surface "Heart of Chicago" as a suggested location at all (typing it and pressing Enter without selecting a suggestion falls through to the generic unfiltered `/rent/` page) — it's an obscure name even by Trulia's own UI standards. But the actor calls Trulia's GraphQL backend directly rather than the autocomplete widget, and that backend clearly does resolve the string correctly (real address, real coordinates in the right area, both historical runs agreeing on exactly 12).

**Verdict: hypothesis (a) confirmed.** No code change needed to "fix" this — it's the correct answer for that specific narrow query. The only actionable follow-up is a UX question, not a scraper bug: should we warn users when a bedroom-pinned + micro-neighborhood + multi-amenity combination is this narrow, since it will produce very few matches by design?

---

## Birmingham "South Side" — confirmed root cause: hard actor failure, not silent broaden/empty

Two historical runs found, both against `location: "South Side, Birmingham, AL"` (our fallback tier 2 — no zip was available for this neighborhood record, so the code went straight to `"{neighborhood}, {city}, {state}"`):

| Run ID | Started | Status | Duration | Items |
|---|---|---|---|---|
| `CL1yXW0CkZZzN9k98` | 2026-07-13T20:25:45Z | **FAILED** | ~2.3s | 0 |
| `iM5gzwjdvNS6utzIM` | 2026-07-13T19:24:11Z | **FAILED** | ~2.8s | 0 |

Both logs end identically:
```
2026-07-13T20:25:46.836Z INFO 👋 Finishing Trulia Scraper
2026-07-13T20:25:47.273Z couldn't search for "South Side, Birmingham, AL": service: graphql error: Unable to perform a search for the specified location
```

This is an explicit, structured error from Trulia's own GraphQL backend — the location string genuinely does not resolve in their system, and the actor **run itself is marked FAILED** on Apify's side (not "succeeded with 0 items").

**Contrast with a structurally identical query for a different city** — `location: "South Side, Pittsburgh, PA"` — which appears 3 times in the account's history, e.g. `buboMBiCu2KOD1sIO` (2026-07-05), all **SUCCEEDED** with 0 items:
```
2026-07-05T01:58:13.208Z INFO ✅ No more homes to fetch offset=0
2026-07-05T01:58:13.210Z INFO 👋 Finishing Trulia Scraper
```
No error at all — Trulia recognized "South Side, Pittsburgh" as a valid place, ran the search, and genuinely found zero matches for those filters. So the actor/Trulia backend clearly distinguishes between "valid location, no matches" (clean success, empty dataset) and "can't resolve this location string at all" (explicit GraphQL error, FAILED run) — it does **not** silently broaden the search on failure.

**Answering the original question directly:** when Trulia can't resolve a neighborhood string, it **errors** — it does not return empty gracefully, and it does not silently substitute a broader area. The failure is loud (structured GraphQL error message, FAILED actor status) but it never reaches our own code as a recognizable "bad location" signal — `startTruliaScrape()` just gets a `FAILED` webhook event like it would for a proxy block or any other transient failure, all of which currently get merged into the same generic error path.

### Fallback chain: tested the untested tier

Chunk 1 flagged the fallback chain (`apify.ts:245-249`, zip → `"{neighborhood}, {city}, {state}"` → `"{city}, {state}"`) as unconfirmed for whether tier 3 would actually help. It's worth being precise about what this "chain" currently is in code: it's a **single deterministic string choice** made once, based on which fields the neighborhood record has (zip present? use it; else neighborhood present? use tier 2; else tier 3) — it is **not** a runtime retry-on-failure sequence. If tier 2 fails at Trulia, the code never automatically tries tier 3; the search for that source just fails.

To check whether tier 3 would have actually worked here, I triggered a new run with the same filters as the failed Birmingham searches but with `location: "Birmingham, AL"` (bare city, no neighborhood):

| Run ID | Status | Duration | Items |
|---|---|---|---|
| `mmeCbeEzSe9jYhGsf` (new, triggered for this investigation) | SUCCEEDED | ~2.3s | 50 (hit `maxItems` cap) |

```
2026-07-20T18:02:56.813Z INFO 📦 Saved results current=50 total=50
2026-07-20T18:02:56.880Z INFO ✅ Reached max items limit maxItems=50 total=50
2026-07-20T18:02:56.882Z INFO 👋 Finishing Trulia Scraper
```

**Tier 3 resolves cleanly and hits the 50-item cap** — plenty of inventory exists at the city level. The fallback chain's *destination* (tier 3) is sound; what's missing is the *mechanism* to actually reach it when a more specific tier hard-fails at Trulia's resolver.

---

## lat/lon confirmation: **Yes**

Raw Trulia dataset items include real coordinates in two places, both populated with matching values:

```json
{
  "homeCoordinates": { "coordinates": { "latitude": 41.855675, "longitude": -87.66815 } },
  "location": {
    "city": "Chicago",
    "coordinates": { "latitude": 41.855675, "longitude": -87.66815 },
    "formattedStreetAddress": "1651 W  19th St #3F",
    "zipCode": "60608",
    ...
  }
}
```

**However**, `validateTruliaItem()` (`src/lib/apify.ts:486+`) currently reads `item.location` for `city`/`stateCode`/`zipCode`/`streetAddress`/`neighborhoodName` only — it never touches `location.coordinates` or `homeCoordinates`. Coordinates are present in the raw actor payload but are dropped entirely during mapping to `ScrapedListing`, which has no lat/lng field at all. This is a real, reliable data source sitting unused — directly relevant to Chunk 5's geo-in-scoring plan.

---

## Recommendations (not implemented — investigation only)

1. **Chicago is not a bug.** No change needed to `startTruliaScrape()` input for this case. Optional: surface a soft warning in the UI when a search combines a pinned exact-bedroom-count + a named micro-neighborhood + 2+ amenity filters, since that combination will reliably return very few results — this is a product/UX question, not a scraper fix.

2. **Add a runtime fallback-on-failure for Trulia location resolution.** The existing chain in `apify.ts:245-249` picks one location string up front and never recovers if Trulia's GraphQL layer rejects it. Given the confirmed evidence — tier 2 hard-fails with a clean, structured error (`"Unable to perform a search for the specified location"`) and tier 3 for the same city succeeds and hits the item cap — the fix is mechanical: catch the specific `FAILED` / "Unable to perform a search" case in `withRetry()` or a new wrapper around `startTruliaScrape()`, and retry once against the next-lower tier (drop neighborhood → try city-level) rather than giving up. This would have silently recovered both historical Birmingham "South Side" failures.

3. **Distinguish "can't resolve location" from other actor failures downstream.** Right now a Trulia `ACTOR.RUN.FAILED` webhook (whatever the cause — bad location, proxy block, GraphQL 500) is handled uniformly in `/api/apify/webhook`. Since a bad-location failure is a distinct, identifiable string (`"Unable to perform a search for the specified location"`) available in the actor log, it may be worth surfacing that distinction in logging/alerting so "this neighborhood string is bad" (a data-quality problem, fixable by better location input) doesn't get lost in the same bucket as "Trulia proxy-blocked us" (a transient infra problem, already handled by `withRetry()`).

4. **Capture lat/lon from Trulia into `ScrapedListing`.** Add `homeCoordinates.coordinates.latitude`/`.longitude` (or the duplicate under `location.coordinates` — either works, they matched in the sample) to `validateTruliaItem()` and extend the `ScrapedListing` interface with optional `lat`/`lon` fields. This is free — no new actor input or extra request needed, the data is already in every successful Trulia dataset item — and directly unblocks Chunk 5's geo-in-scoring plan for at least one of the four sources. (Zillow/Craigslist/Apartments.com weren't checked here — worth the same 5-minute check per source before committing to a geo-scoring design that assumes coverage across all four.)

## Note on environment access

`APIFY_API_TOKEN` was not present in this worktree's environment or `.env.local`, matching the Chunk 1 blocker exactly. It also could not be retrieved via `vercel env pull` from the linked `apartmentbuddy-ai` project — it pulled back as an empty string while other secrets (e.g. `SUPABASE_SERVICE_ROLE_KEY`) pulled with real values, consistent with `APIFY_API_TOKEN` being marked as a Vercel **Sensitive** environment variable (value unreadable via CLI/API/dashboard once set, only injected at deploy runtime). The user supplied the token directly in-session for this investigation; it was used in-memory only for the Apify REST API calls above and was never written to any file or into this document. Future investigations needing this token will hit the same wall unless it's either shared again per-session or its Sensitive flag is removed in the Vercel dashboard.

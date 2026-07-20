# Chunk 1 — Scraper Diagnosis (Zillow, Trulia, Craigslist)

**Investigation only. No code, config, or Apify actor inputs were changed.**
Branch: `chunk-1-scraper-diagnosis`. Date: 2026-07-20.

## Sources used

- Current code: `src/lib/apify.ts`, `src/lib/search-trigger.ts`, `src/app/api/search/route.ts`, `src/app/api/cron/monitor/route.ts`, `src/app/api/apify/webhook/route.ts`, `vercel.json`
- Apify published input schemas for `igolaizola/zillow-scraper-ppe`, `igolaizola/trulia-scraper`, `automation-lab/craigslist-scraper` (fetched live from apify.com; cross-checked each actor via two independent fetches, plus a web search for Craigslist)
- Vercel project `apartmentbuddy-ai` (`prj_ebEP745wGwGYmdwqqhiLlaycSgxp`) runtime logs and runtime-error clusters via the Vercel MCP tools
- Prior session memory (`project_trulia_scraper.md`, `project_open_issues.md`, `project_zillow_scraper.md`)

**Coverage gap, flagged up front:** Vercel's runtime-log retention did not reach back far enough to contain the actual Chicago Trulia run, the Birmingham "south side" run, or a specific failed Craigslist run — a `since: 24h` and `since: 7d` query for `/api/apify/webhook`, `TRULIA`, and `CRAIGSLIST` returned no matching log lines (only a single unrelated static `GET /` was in-window). I also don't have `APIFY_API_TOKEN` in this environment, so I could not pull the actual Apify Console run history/logs for those specific runs. Everything below that concerns those three specific incidents is a **code + schema-based hypothesis**, not a confirmed root cause from logs — flagged per-row. Recommend re-running §"Next steps to close the gap" with live Apify Console access before acting on the hypotheses.

**Also unconfirmed:** exact Vercel plan/tier (Hobby vs Pro vs Enterprise). `vercel project inspect` and the MCP `get_project`/`get_runtime_logs` tools don't surface billing tier directly. Indirect signal: the log-retention error message references three tiers ("Hobby 1h, Pro 1 day, Enterprise 3 days") but a 24h query returned results without error, which doesn't cleanly disambiguate Hobby (1h) from a >1h-but-still-inconclusive case. Recommend checking Vercel dashboard → Settings → Billing directly.

---

## Zillow (`igolaizola/zillow-scraper-ppe`)

| Question | Current State | What Knobs Exist | Notes |
|---|---|---|---|
| 1. Current input config | `src/lib/apify.ts:146-155` (`startZillowScrape`): `{ operation: 'rent', location: <zip or "City, ST">, fetchDetails: true, flattenOutput: true, maxItems: 50, minBeds?, minBaths?, maxPrice? }` — see full object below | — | `location` is derived from `neighborhoods[0]` only; only the *first* monitored neighborhood is searched per call even when a user monitors multiple. |
| 2. Is the 50-cap ours or the actor's default? | **Ours.** | Actor's `maxItems` default is **1000**, min `1`, no documented hard ceiling. | We're passing `maxItems: 50` explicitly — a deliberate 20x reduction from the actor default, not something imposed on us. |
| 3. lat/lon + radius vs string location | **String only.** | Actor accepts `location` (free text: city/ZIP/neighborhood/county) or `locations` (array of free text, searched sequentially), plus optional `locationType` (state/county/city/neighborhood/borough/school/flex_region/address/zipcode). | No lat/lon/radius input exists on this actor at all. Geo work will need either ZIP-based tiling or a different actor. |
| 4. Native filters (price/beds/baths/property type) | **Partially used.** We pass `minBeds`, `minBaths`, `maxPrice`. | Actor also supports `maxBeds`, `minPrice` (default 0/no filter), and `homeTypes` (array: houses, townhomes, multifamily, condos, land, apartments, manufactured) for property type. | We don't currently constrain `homeTypes` to `apartments`/multifamily — worth considering since the actor mixes types by default (this is also part of why the code has to defensively drop for-sale listings above $10k rent, see `validateZillowItem`). |
| 5. Unused maxResults/maxPages knob | **No separate `maxPages`.** `maxItems` is the only volume cap and we already use it. | Documented caveat: pulling past Zillow's ~1000-result search window per query requires setting `sort` to `newest`, `lowPrice`, or `highPrice` to page through additional slices. We don't pass `sort` at all today. | Only relevant if `maxItems` is ever raised well above current 50 — not a live bug at current volume. |

**Current input object (verbatim from code, preferences-dependent fields spread conditionally):**
```json
{
  "operation": "rent",
  "location": "80218",
  "fetchDetails": true,
  "flattenOutput": true,
  "maxItems": 50,
  "minBeds": 1,
  "minBaths": 1,
  "maxPrice": 2500
}
```

---

## Trulia (`igolaizola/trulia-scraper`) — highest priority

| Question | Current State | What Knobs Exist | Notes |
|---|---|---|---|
| 1. Current input config | `src/lib/apify.ts:258-277` (`startTruliaScrape`) — see full object below. Wrapped in `withRetry()` (3 attempts, exponential backoff) because Trulia's own GraphQL backend has been observed to throw transient 500s. | — | Same single-neighborhood limitation as Zillow (`neighborhoods[0]` only). |
| 2. Why did Chicago only return 12? Pagination/maxResults/page-limit? | **No pagination parameter exists on this actor at all** — confirmed from the published schema. `maxItems` default is 100; we explicitly cap it at 50 in our config, and Chicago returned 12, well under either cap. | `maxItems` (default 100, no documented max) is the *only* volume-related input. | Since neither our 50-cap nor the actor's own limits explain a 12-result cutoff, the shortfall is most likely coming from *upstream* — either (a) our own filter fields (`minBeds`/`maxBeds`/`minBaths`/`maxPrice`/pet/laundry/gym/parking flags, all conditionally spread into the request) narrowing Trulia's own result set for that search, or (b) Trulia's site genuinely having few "rent" listings matching that combination in the resolved location, or (c) a partial/early actor termination (proxy block, captcha, GraphQL error mid-scrape) that still reports success with whatever it collected before failing. **Could not confirm which — no retained logs or Apify run history for that specific run.** |
| 3. Birmingham "south side" neighborhood — raw response when it doesn't resolve | **Unknown / undocumented.** The Apify actor schema documents no explicit "invalid location" behavior. | `location` is free text only — same as Zillow, no structured neighborhood ID. | Our fallback chain (`apify.ts:245-249`) is: `zip_code` → `"{neighborhood}, {city}, {state}"` → `"{city}, {state}"`. If Trulia's own search resolver can't match "south side" as a neighborhood string, the actor (which drives Trulia's actual site search) would inherit whatever Trulia's site does for an unrecognized qualifier — commonly either a broader city-level fallback or a "no results" page — but this is Trulia-website behavior the Apify actor doesn't document, and we don't have a captured raw response for this run to confirm. **Flagged as needing a live re-run with `logRawSample`/actor console output, not resolved by schema research.** |
| 4. lat/lon + radius vs string location | **String only**, same as Zillow. | `location`: "city, state, ZIP, or neighborhood." No lat/lon/radius parameter exists. | Confirms the same geo-work constraint as Zillow — neither of our two primary sources supports coordinate-based search. |
| 5. Native filter support (price/beds/baths/property type) | **All used except `maxBaths`.** We pass `minBeds`, `maxBeds`, `maxPrice`, `minBaths`, plus amenity flags (`airConditioning`, `pets`, `unitAmenities`, `buildingAmenities`). | Actor documents `minPrice` (unused by us — we only cap the top end), `minBeds`/`maxBeds`, `minBaths`/`maxBaths` (we never send `maxBaths`), `propertyTypes` (house/condo/townhouse/etc. — unused), plus sqft, lot size, HOA fee, year built as additional documented filters we don't touch. | `propertyTypes` and `minPrice` are the two most likely knobs worth adding if Trulia's per-search result counts need broadening or narrowing. |

**Current input object (verbatim from code, preferences-dependent fields spread conditionally):**
```json
{
  "location": "80218",
  "operation": "rent",
  "sortBy": "best",
  "space": "entire_space",
  "maxItems": 50,
  "includeOffMarket": false,
  "proxyConfiguration": { "useApifyProxy": true, "apifyProxyGroups": ["RESIDENTIAL"] },
  "maxPrice": 2500,
  "minBeds": 1,
  "minBathrooms": 1
}
```
*(amenity arrays `pets`, `unitAmenities`, `buildingAmenities`, and `airConditioning: true` are added only when the corresponding preference is set)*

---

## Craigslist (`automation-lab/craigslist-scraper`)

| Question | Current State | What Knobs Exist | Notes |
|---|---|---|---|
| 1. Current input config | `src/lib/apify.ts:230-234` (`startCraigslistScrape`): `{ startUrls: [{ url: <buildCraigslistUrl(...)> }], includeDetails: true, maxResults: 100 }`. `buildCraigslistUrl()` constructs a full `https://{city}.craigslist.org/search/apa?postal=...&search_distance=3&min_bedrooms=...&max_bedrooms=...&max_price=...&pets_dog=1&pets_cat=1&sort=date` URL. | — | See finding below — this input shape does not match the actor's documented schema. |
| 2. Where does the timeout happen — inside the actor, or inside our Vercel function? | **Neither, structurally — and this is the key architectural fact for this whole investigation.** `startActor()` (`apify.ts:82-98`) is a single `fetch()` POST to `Apify /acts/{id}/runs` that *starts* the run and returns immediately with a run ID; the code never polls or awaits actor completion synchronously. Actual results arrive later via Apify's webhook → `/api/apify/webhook`, which has `maxDuration = 60`. So there is no Vercel function sitting and blocking on the Craigslist actor run. | — | This means "Craigslist times out" as reported almost certainly refers to the **actor run itself never reaching SUCCEEDED/triggering our webhook**, not a Vercel 10s/60s function timeout. The user-visible symptom (search stuck at "running") is explained by `src/app/api/search/route.ts:69-83`: a `search_run` older than 15 minutes with `apify_runs_pending > 0` gets auto-marked `failed` on next GET — i.e., what looks like "Craigslist hangs" is the frontend polling into that 15-minute staleness fallback because the real Craigslist webhook event never arrives. |
| 2b. Root cause of why the webhook never arrives (schema mismatch found) | **Confirmed via 3 independent lookups** (actor's published input-schema page fetched twice with different prompts, api.apify.com raw actor JSON, and a web search) that `automation-lab/craigslist-scraper`'s input schema has exactly these fields: `searchQueries` (**required**, array of keywords), `city`, `category`, `maxResults`, `includeDetails`, `minPrice`, `maxPrice`, `maxRequestRetries`. **`startUrls` is not a documented input field on this actor at all** — not even in the actor's own "Craigslist Housing Extractor for Apartments" example, which uses `searchQueries: ["studio", "one bedroom"], city: "newyork", category: "housing"`. | The actor is keyword+city+category driven, not URL driven. | Our code sends `startUrls` (undocumented/unsupported) and never sends the **required** `searchQueries` field. This is the same failure pattern already seen and fixed once for Zillow (memory: "was passing `startUrls`, which the actor ignores... fell back to default behavior"). Two plausible failure modes follow from this, both consistent with "never completes": (a) Apify's input validation rejects the run immediately for missing required `searchQueries` → fast `ACTOR.RUN.FAILED`, but if our webhook's failure-path has any gap it could still leave `apify_runs_pending` undecremented; or (b) if the actor's schema tolerates unknown extra properties, it may start with `searchQueries` effectively empty/undefined and either error deep in its own retry logic (`maxRequestRetries` default 3) or simply produce nothing before hitting the actor's own `timeoutSecs: 3600` (1 hour) ceiling — which from the product's perspective looks exactly like "never completes." **I could not distinguish (a) vs (b) without a live Apify Console run to inspect** — this is the single highest-value next step. |
| 3. Vercel plan / function timeout | **Not confirmed programmatically.** `/api/apify/webhook` declares `maxDuration = 60`; `/api/listings/rescore` also declares `60`; `/api/listings/check-availability` declares `30`. The `/api/search` and `/api/cron/monitor` routes declare no `maxDuration` (framework default applies). | — | Irrelevant to the Craigslist symptom regardless of the answer, per finding #2 above — no Vercel function ever waits on the Craigslist actor. Still worth confirming for its own sake (affects webhook-processing headroom, not scrape completion). Recommend checking Vercel dashboard → Settings → Billing directly; MCP tooling didn't expose it. |
| 4. Pre-filtering support (geo radius, price, bedrooms) | **Price only, per actor schema** (`minPrice`/`maxPrice`). **No native geo-radius or bedroom filter exists on this actor.** | `searchQueries`, `city`, `category`, `maxResults`, `includeDetails`, `minPrice`, `maxPrice`, `maxRequestRetries`. | Our current `buildCraigslistUrl()` approach (postal + `search_distance` + `min_bedrooms`/`max_bedrooms` as raw Craigslist site query-string params) assumes the actor will just crawl whatever URL it's given — which lines up with *some* generic Apify Craigslist scrapers, but not with this actor's documented `searchQueries`/`city`/`category` input contract. This is the same mismatch as #2b, restated for the filtering question specifically. |
| 5. Typical successful completion time | Actor's own docs claim "300+ listings in 2-3 seconds" in basic mode, and "~1-2 seconds per listing" additional when `includeDetails` is enabled (we do enable it, with `maxResults: 100` → worst case ~100-200s of detail-page fetching if the base search succeeds). Default actor `timeoutSecs` is 3600 (1 hour) and default `memoryMbytes` is 256. | — | No independent confirmation from our own run history (no retained logs reaching back far enough). Given finding #2b, it's plausible no Craigslist run has been actually exercising this code path successfully at all recently — worth checking Apify Console's Craigslist actor run list directly for a genuine SUCCEEDED run with nonzero dataset items. |

**Current input object (verbatim from code):**
```json
{
  "startUrls": [{ "url": "https://denver.craigslist.org/search/apa?postal=80218&search_distance=3&min_bedrooms=1&max_bedrooms=2&max_price=2500&pets_dog=1&pets_cat=1&sort=date" }],
  "includeDetails": true,
  "maxResults": 100
}
```

---

## Summary

**Which scrapers can accept lat/lon input?**
None of the three. `igolaizola/zillow-scraper-ppe` and `igolaizola/trulia-scraper` both take free-text `location` strings only (city/ZIP/neighborhood), with no coordinate or radius parameter documented anywhere in their schemas. `automation-lab/craigslist-scraper` is keyword+city-subdomain driven and also has no geo-coordinate input — our current lat/lon-adjacent behavior (via `map_bounds` → Craigslist's own `lat`/`lon` query-string params in `buildCraigslistUrl()`) is a Craigslist-website-level trick riding on `startUrls`, not an Apify actor input — and per the Craigslist finding above, `startUrls` itself doesn't appear to be a supported field for this actor. **Upcoming geo work should assume zero native lat/lon support across all three current sources** and plan around ZIP-radius tiling or actor swaps instead.

**Which scrapers support native price/bedroom filtering?**
Zillow and Trulia both have first-class `minPrice`/`maxPrice`, `minBeds`/`maxBeds`, `minBaths`(/`maxBaths` for Trulia) fields, and we're already using most of them (Zillow: missing `maxBeds`/`homeTypes`; Trulia: missing `minPrice`/`propertyTypes`/`maxBaths`). Craigslist's actor supports **price filtering only** (`minPrice`/`maxPrice`) — no native bedroom filter exists on that actor at all; our bedroom targeting today rides entirely on Craigslist's own site-level `min_bedrooms`/`max_bedrooms` query params via the (likely unsupported) `startUrls` field. **For a hard-filter architecture: treat Zillow and Trulia as reliable for server-side price+bedroom filtering; Craigslist should not be trusted for native bedroom filtering until the `startUrls` question below is resolved — a keyword/category rewrite may only leave price as a reliable native filter.**

**Root cause hypothesis — Trulia's 12-result Chicago run:**
Not confirmed from logs (none retained back that far). Leading hypothesis, in order of likelihood: (1) our own preference filters (bed/bath/price/amenity flags) passed into the actor call narrowed Trulia's own matching set for that specific search combination — this is a normal, not-a-bug outcome if Chicago genuinely had few matching active rentals; (2) a partial/early termination inside the actor run (proxy block, captcha, upstream GraphQL error — the exact class of transient failure the `withRetry()` wrapper was already added for) that still reported enough to look like a completed run. Ruled less likely: an actor-side pagination cap, since none is documented and our 50-cap wasn't reached either. **Needs a live re-run with raw item logging, or pulling that specific run's log from Apify Console, to settle.**

**Root cause hypothesis — Craigslist never completing:**
Not a Vercel function timeout (the trigger path never blocks on actor completion — see per-source table, question 2). Leading hypothesis, high confidence: **our `startCraigslistScrape()` input (`startUrls`, `includeDetails`, `maxResults`) does not match `automation-lab/craigslist-scraper`'s actual documented schema (`searchQueries` [required], `city`, `category`, `maxResults`, `includeDetails`, `minPrice`, `maxPrice`, `maxRequestRetries`)** — confirmed via three independent schema lookups including the actor's own housing-specific example. This is the same class of bug already found and fixed once for Zillow (unsupported `startUrls` silently ignored, actor falls back to default behavior). Whether the practical failure mode is a fast input-validation rejection or a slow hang up to the actor's 1-hour `timeoutSecs`, either would produce the reported "never completes" symptom once combined with the 15-minute client-side staleness fallback in `/api/search`. **This is the single most actionable finding in this report and the recommended starting point for chunk 2**, pending user go-ahead.

## Next steps to close the evidence gap (not done — investigation only)

1. Pull the actual Apify Console run history/logs for the specific Chicago Trulia run and the Birmingham "south side" run (requires `APIFY_API_TOKEN`, not available in this environment).
2. Pull the Apify Console run history for `automation-lab/craigslist-scraper` under this account to see whether any run has ever returned a nonzero dataset — this would immediately confirm or rule out the `startUrls`/`searchQueries` mismatch hypothesis.
3. Confirm Vercel plan/tier directly in the dashboard (Settings → Billing) — not exposed via the MCP tools or CLI used here.

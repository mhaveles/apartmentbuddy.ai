import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchScrapedListingsByRunId, fetchTruliaListingsByRunId, isTruliaLocationFailure, retryTruliaScrapeAtLocation } from '@/lib/apify'
import { getAnthropic, SCORING_PROMPT, fetchListingImages } from '@/lib/anthropic'
import { buildVotedContext, type VotedRow } from '@/lib/scoring-utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  // Verify secret
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { searchRunId, source, eventType, defaultDatasetId, actorRunId } = body

  console.log('WEBHOOK RECEIVED:', JSON.stringify({ searchRunId, source, eventType, defaultDatasetId, actorRunId }))

  if (!searchRunId || !source) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Look up search run
  const { data: searchRun } = await supabase
    .from('search_runs')
    .select('*')
    .eq('id', searchRunId)
    .single()

  if (!searchRun) {
    return NextResponse.json({ error: 'Search run not found' }, { status: 404 })
  }

  const userId = searchRun.user_id

  // Decrement FIRST — before any processing — so a timeout mid-scoring never
  // leaves apify_runs_pending stuck and the run status never updating.
  const { data: updated, error: rpcError } = await supabase
    .rpc('decrement_apify_runs_pending', { run_id: searchRunId })
    .select()
    .single()

  let newPending: number
  if (rpcError || !updated) {
    console.error('decrement_apify_runs_pending RPC failed, using fallback:', rpcError?.message)
    const current = (searchRun.apify_runs_pending as number) ?? 1
    newPending = Math.max(0, current - 1)
    await supabase
      .from('search_runs')
      .update({ apify_runs_pending: newPending })
      .eq('id', searchRunId)
  } else {
    newPending = (updated as { apify_runs_pending: number }).apify_runs_pending
  }

  const allDone = newPending === 0

  // Resolve the Apify run ID to fetch data with.
  const storedRunId = (searchRun.apify_run_ids as Record<string, string> | null)?.[source]
  const resolvedRunId = storedRunId || actorRunId
  console.log(`Webhook: source=${source} eventType=${eventType} resolvedRunId=${resolvedRunId} pending=${newPending} allDone=${allDone}`)

  // Trulia-specific: a FAILED run may be Trulia's GraphQL resolver rejecting our location
  // string outright, rather than a transient/proxy failure (withRetry() in apify.ts already
  // retries those with the SAME input). Distinguish the two via the run log, and for a genuine
  // location-resolution failure, retry once with the next-lower fallback tier (dropped when the
  // run was started, stored on search_runs.trulia_fallback_location) instead of giving up.
  if (source === 'trulia' && eventType === 'ACTOR.RUN.FAILED' && actorRunId) {
    const locationFailure = await isTruliaLocationFailure(actorRunId)
    const fallbackLocation = searchRun.trulia_fallback_location as string | null

    if (locationFailure && fallbackLocation) {
      console.warn(`[TRULIA] location-resolution failure for search_run=${searchRunId} (actorRunId=${actorRunId}) — retrying at fallback tier "${fallbackLocation}"`)

      try {
        const { data: prefRow } = await supabase.from('preferences').select('*').eq('user_id', userId).single()
        const retryWebhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/apify/webhook?secret=${process.env.CRON_SECRET}`
        const newRunId = await retryTruliaScrapeAtLocation(fallbackLocation, retryWebhookUrl, searchRunId, prefRow || undefined)

        // Undo the decrement above — a replacement run is now in flight, so this source isn't
        // actually done yet. Atomic RPC avoids clobbering concurrent decrements from other sources.
        await supabase.rpc('increment_apify_runs_pending', { run_id: searchRunId })
        await supabase
          .from('search_runs')
          .update({
            apify_run_ids: { ...(searchRun.apify_run_ids as Record<string, string> | null), trulia: newRunId },
            trulia_fallback_location: null, // exhausted — at most one retry
          })
          .eq('id', searchRunId)

        console.log(`[TRULIA] fallback retry started: new run ${newRunId} for search_run=${searchRunId}`)
        return NextResponse.json({ ok: true, truliaFallbackRetried: true })
      } catch (err) {
        console.error(`[TRULIA] fallback retry failed to start for search_run=${searchRunId}: ${(err as Error).message}`)
        // fall through to normal failure handling below
      }
    } else if (locationFailure) {
      console.warn(`[TRULIA] location-resolution failure for search_run=${searchRunId} (actorRunId=${actorRunId}) — already at broadest tier, no further fallback`)
    } else {
      console.warn(`[TRULIA] run FAILED for search_run=${searchRunId} (actorRunId=${actorRunId}) — not a location-resolution failure (transient/proxy/other)`)
    }
  }

  let listingsFoundThisRun = 0
  let scoredThisRun = 0

  if (resolvedRunId) {
    // Fetch preferences, listings, and voted examples in parallel
    const [prefResult, listings, likedResult, dislikedResult] = await Promise.all([
      supabase.from('preferences').select('*').eq('user_id', userId).single(),
      source === 'trulia' ? fetchTruliaListingsByRunId(resolvedRunId) : fetchScrapedListingsByRunId(resolvedRunId, source),
      supabase
        .from('user_listings')
        .select('vote, score_breakdown, listing:listings(address, neighborhood, city, rent, bedrooms, bathrooms, sqft, amenities)')
        .eq('user_id', userId)
        .eq('vote', 1)
        .order('scored_at', { ascending: false })
        .limit(5),
      supabase
        .from('user_listings')
        .select('vote, score_breakdown, listing:listings(address, neighborhood, city, rent, bedrooms, bathrooms, sqft, amenities)')
        .eq('user_id', userId)
        .eq('vote', -1)
        .order('scored_at', { ascending: false })
        .limit(5),
    ])
    const preferences = prefResult.data

    console.log(`Fetched ${listings.length} listings for ${source} (preferences found: ${!!preferences})`)
    listingsFoundThisRun = listings.length

    // Phase 1: Save all listings to DB in parallel batches
    const SAVE_CONCURRENCY = 10
    const savedListings: Array<{ id: string; listing: typeof listings[number] }> = []

    for (let i = 0; i < listings.length; i += SAVE_CONCURRENCY) {
      const batch = listings.slice(i, i + SAVE_CONCURRENCY)
      const results = await Promise.all(batch.map(async (listing) => {
        const { data: savedListing } = await supabase
          .from('listings')
          .upsert({
            external_id: listing.externalId,
            source: listing.source,
            url: listing.url,
            title: listing.title,
            address: listing.address,
            city: listing.city,
            state: listing.state,
            neighborhood: listing.neighborhood,
            zip_code: listing.zipCode,
            rent: listing.rent,
            bedrooms: listing.bedrooms,
            bathrooms: listing.bathrooms,
            sqft: listing.sqft,
            available_date: listing.availableDate,
            amenities: listing.amenities,
            description: listing.description,
            images: listing.images,
            scraped_at: new Date().toISOString(),
            is_available: true,
            lat: listing.lat ?? null,
            lon: listing.lon ?? null,
          }, { onConflict: 'external_id,source' })
          .select()
          .single()
        return savedListing ? { id: savedListing.id, listing } : null
      }))
      savedListings.push(...results.filter((r): r is { id: string; listing: typeof listings[number] } => r !== null))
    }

    console.log(`Saved ${savedListings.length}/${listings.length} listings to DB`)

    // Phase 2: Score listings synchronously before responding.
    // Previously used after() but that requires Fluid Compute on Vercel — without it
    // the function freezes after sending the response and scoring never completes.
    // Scoring inline is safe: with CONCURRENCY=10, 100 listings takes ~15s, under Apify's 30s timeout.
    if (preferences && savedListings.length > 0) {
      const SCORE_CONCURRENCY = 10
      const votedContext = buildVotedContext([
        ...((likedResult.data ?? []) as VotedRow[]),
        ...((dislikedResult.data ?? []) as VotedRow[]),
      ])
      const filteredForScoring = savedListings.filter(({ listing }) => {
        if (preferences.max_rent && listing.rent > preferences.max_rent) return false
        if (preferences.min_bedrooms != null && listing.bedrooms !== null && listing.bedrooms < preferences.min_bedrooms) return false
        if (preferences.max_bedrooms != null && listing.bedrooms !== null && listing.bedrooms > preferences.max_bedrooms) return false
        return true
      })

      // Phase 1.5: Dedup before scoring — prevents paying for Anthropic calls on duplicates.
      // Fetch all listings this user already has scored to catch cross-source matches
      // (same apartment on Apartments.com and Craigslist gets different listing_id UUIDs,
      //  so the idempotency check below can't catch them — we need this URL/address+rent check).
      const { data: existingUserListings } = await supabase
        .from('user_listings')
        .select('id, listing:listings(url, address, rent)')
        .eq('user_id', userId)

      const seenUrls = new Set<string>()
      const seenAddrRent = new Set<string>()
      const dupKeyToULId = new Map<string, string>()
      for (const ul of existingUserListings || []) {
        const l = ul.listing as { url?: string; address?: string; rent?: number } | null
        if (l?.url) {
          const urlKey = l.url.trim()
          seenUrls.add(urlKey)
          dupKeyToULId.set(`url:${urlKey}`, ul.id as string)
        }
        if (l?.address && l.address.trim().length > 5 && l?.rent) {
          const addrRentKey = `${l.address.toLowerCase().trim()}:${l.rent}`
          seenAddrRent.add(addrRentKey)
          dupKeyToULId.set(`addr:${addrRentKey}`, ul.id as string)
        }
      }

      const batchSeenUrls = new Set<string>()
      const batchSeenAddrRent = new Set<string>()
      const toScore: typeof filteredForScoring = []
      const sourceUpdates: Array<{ ulId: string; newSource: string }> = []

      for (const item of filteredForScoring) {
        const urlKey = item.listing.url?.trim()
        const addrRentKey =
          item.listing.address && item.listing.address.trim().length > 5 && item.listing.rent
            ? `${item.listing.address.toLowerCase().trim()}:${item.listing.rent}`
            : null

        // Cross-source DB match — already scored under a different source's listing_id
        let crossDupULId: string | undefined
        if (urlKey && seenUrls.has(urlKey)) crossDupULId = dupKeyToULId.get(`url:${urlKey}`)
        else if (addrRentKey && seenAddrRent.has(addrRentKey)) crossDupULId = dupKeyToULId.get(`addr:${addrRentKey}`)

        if (crossDupULId) {
          sourceUpdates.push({ ulId: crossDupULId, newSource: item.listing.source })
          continue
        }

        // Within-batch duplicate (same source returning the same listing twice)
        if ((urlKey && batchSeenUrls.has(urlKey)) || (addrRentKey && batchSeenAddrRent.has(addrRentKey))) continue

        if (urlKey) batchSeenUrls.add(urlKey)
        if (addrRentKey) batchSeenAddrRent.add(addrRentKey)
        toScore.push(item)
      }

      // Cap at 50: cheapest first as a preference proxy to stay within Vercel's 60s timeout
      const preCapCount = toScore.length
      if (toScore.length > 50) {
        toScore.sort((a, b) => a.listing.rent - b.listing.rent)
        toScore.splice(50)
      }
      const capDropped = preCapCount - toScore.length
      const dupSkipped = filteredForScoring.length - preCapCount

      console.log(
        `Dedup: ${dupSkipped} skipped (${sourceUpdates.length} cross-source), ` +
        `${capDropped} capped, scoring ${toScore.length}/${filteredForScoring.length} listings`
      )

      // Atomic sources append for cross-source dupes — single SQL UPDATE, no fetch-then-write race.
      // Idempotent: the SQL guard prevents adding the same source twice on webhook retries.
      if (sourceUpdates.length > 0) {
        await Promise.allSettled(
          sourceUpdates.map(({ ulId, newSource }) =>
            supabase.rpc('append_user_listing_source', { ul_id: ulId, new_source: newSource })
          )
        )
      }

      for (let i = 0; i < toScore.length; i += SCORE_CONCURRENCY) {
        const batch = toScore.slice(i, i + SCORE_CONCURRENCY)
        const results = await Promise.all(batch.map(async ({ id: listingId, listing }) => {
          // Skip if already scored for this user (idempotent on webhook retries)
          const { data: existing } = await supabase
            .from('user_listings')
            .select('id')
            .eq('user_id', userId)
            .eq('listing_id', listingId)
            .single()
          if (existing) return 0

          try {
            const imageBlocks = await fetchListingImages(listing.images || [], 5)
            const priorityNote = preferences.priorities
              ? `\nDimension priorities — weight your scores accordingly (high = more influential, low = less influential):\n${JSON.stringify(preferences.priorities, null, 2)}\n`
              : ''
            const textContent = `User preferences:\n${JSON.stringify(preferences, null, 2)}${priorityNote}${votedContext}\n\nListing:\n${JSON.stringify({
              address: listing.address,
              zip_code: listing.zipCode,
              neighborhood: listing.neighborhood,
              city: listing.city,
              state: listing.state,
              rent: listing.rent / 100,
              bedrooms: listing.bedrooms,
              bathrooms: listing.bathrooms,
              sqft: listing.sqft,
              amenities: listing.amenities,
              description: listing.description,
            }, null, 2)}`

            const messageContent = [
              ...imageBlocks,
              { type: 'text' as const, text: textContent },
            ]

            const scoreResponse = await getAnthropic().messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 768,
              system: SCORING_PROMPT,
              messages: [{ role: 'user', content: messageContent }],
            })

            const rawText = scoreResponse.content[0].type === 'text' ? scoreResponse.content[0].text : '{}'
            const scoreText = rawText.replace(/```(?:json)?\s*/g, '').replace(/```/g, '')
            const jsonMatch = scoreText.match(/\{[\s\S]*\}/)
            if (jsonMatch) {
              const scoreData = JSON.parse(jsonMatch[0])
              await supabase.from('user_listings').insert({
                user_id: userId,
                listing_id: listingId,
                score: scoreData.score,
                score_breakdown: scoreData.breakdown,
                score_reasoning: scoreData.reasoning,
                sources: [listing.source],
                search_run_id: searchRunId,
              })
              return 1
            }
          } catch (err) {
            console.error(`Scoring error for listing ${listingId}:`, err)
          }
          return 0
        }))
        scoredThisRun += results.reduce((a: number, b: number) => a + b, 0)
      }
      console.log(`Scored ${scoredThisRun}/${toScore.length} listings for ${source}`)
    } else {
      console.log(`Skipping scoring: preferences=${!!preferences} savedListings=${savedListings.length}`)
    }
  }

  // Update counters atomically via RPC (avoids race condition when multiple webhooks fire concurrently).
  // If the RPC doesn't exist yet, fall back to a non-atomic update.
  if (listingsFoundThisRun > 0 || scoredThisRun > 0) {
    const { error: rpcIncrErr } = await supabase.rpc('increment_search_run_counts', {
      run_id: searchRunId,
      found_delta: listingsFoundThisRun,
      scored_delta: scoredThisRun,
    })
    if (rpcIncrErr) {
      console.warn('increment_search_run_counts RPC not found, using non-atomic fallback:', rpcIncrErr.message)
      const { data: currentRun } = await supabase
        .from('search_runs')
        .select('listings_found, listings_scored')
        .eq('id', searchRunId)
        .single()
      await supabase
        .from('search_runs')
        .update({
          listings_found: (currentRun?.listings_found || 0) + listingsFoundThisRun,
          listings_scored: (currentRun?.listings_scored || 0) + scoredThisRun,
        })
        .eq('id', searchRunId)
    }
  }

  // Mark completed/failed once all actors have reported back.
  if (allDone) {
    const { data: finalRun } = await supabase
      .from('search_runs')
      .select('listings_found')
      .eq('id', searchRunId)
      .single()
    const totalFound = (finalRun?.listings_found as number | null) ?? 0
    const finalStatus = eventType === 'ACTOR.RUN.FAILED' && totalFound === 0 ? 'failed' : 'completed'
    await supabase
      .from('search_runs')
      .update({ status: finalStatus, completed_at: new Date().toISOString() })
      .eq('id', searchRunId)
    console.log(`Search run ${searchRunId} marked ${finalStatus} (total found: ${totalFound})`)
  }

  return NextResponse.json({ ok: true })
}

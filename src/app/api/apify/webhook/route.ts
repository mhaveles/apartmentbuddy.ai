import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { fetchScrapedListingsByRunId } from '@/lib/apify'
import { getAnthropic, SCORING_PROMPT } from '@/lib/anthropic'

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

  // Decrement FIRST — before any scoring — so a timeout mid-scoring never
  // leaves apify_runs_pending stuck and the run status never updating.
  const { data: updated, error: rpcError } = await supabase
    .rpc('decrement_apify_runs_pending', { run_id: searchRunId })
    .select()
    .single()

  let newPending: number
  if (rpcError || !updated) {
    // RPC function may not exist — fall back to read-modify-write
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
  // We use the run ID stored in our DB at actor-start time — this is more reliable than
  // depending on Apify's {{resource.id}} template variable being interpolated in the payload.
  const storedRunId = (searchRun.apify_run_ids as Record<string, string> | null)?.[source]
  const resolvedRunId = storedRunId || actorRunId  // actorRunId from payload as fallback
  console.log(`Webhook: source=${source} eventType=${eventType} resolvedRunId=${resolvedRunId} pending=${newPending} allDone=${allDone}`)

  if (resolvedRunId) {
    const { data: preferences } = await supabase
      .from('preferences')
      .select('*')
      .eq('user_id', userId)
      .single()

    const listings = await fetchScrapedListingsByRunId(resolvedRunId, source)
    console.log(`Fetched ${listings.length} listings for run ${resolvedRunId}`)

    // Phase 1: Save all listings to DB (fast, no AI)
    const savedListings: Array<{ id: string; listing: typeof listings[number] }> = []
    for (const listing of listings) {
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
        }, { onConflict: 'external_id,source' })
        .select()
        .single()

      if (savedListing) savedListings.push({ id: savedListing.id, listing })
    }

    // Update listings_found now so the run count is correct even if scoring is cut short
    await supabase
      .from('search_runs')
      .update({ listings_found: (searchRun.listings_found || 0) + listings.length })
      .eq('id', searchRunId)

    // Phase 2: Score in background AFTER response is sent (avoids Apify webhook timeout)
    // after() runs post-response within the same Vercel function invocation
    if (preferences && savedListings.length > 0) {
      after(async () => {
        const CONCURRENCY = 5
        // Filter by user preferences before scoring — only score listings that actually match.
        // All listings are already saved to the DB above; this just narrows what gets scored.
        const filteredForScoring = savedListings.filter(({ listing }) => {
          if (preferences.max_rent && listing.rent > preferences.max_rent) return false
          if (preferences.min_bedrooms != null && listing.bedrooms !== null && listing.bedrooms < preferences.min_bedrooms) return false
          if (preferences.max_bedrooms != null && listing.bedrooms !== null && listing.bedrooms > preferences.max_bedrooms) return false
          return true
        })
        console.log(`Pre-score filter: ${filteredForScoring.length}/${savedListings.length} listings match preferences`)
        const toScore = filteredForScoring.slice(0, 50) // cap at 50 to stay within 60s Vercel limit
        let scored = 0
        for (let i = 0; i < toScore.length; i += CONCURRENCY) {
          const batch = toScore.slice(i, i + CONCURRENCY)
          const results = await Promise.all(batch.map(async ({ id: listingId, listing }) => {
            // Skip if already scored for this user
            const { data: existing } = await supabase
              .from('user_listings')
              .select('id')
              .eq('user_id', userId)
              .eq('listing_id', listingId)
              .single()
            if (existing) return 0

            try {
              const scoreResponse = await getAnthropic().messages.create({
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 512,
                system: SCORING_PROMPT,
                messages: [{
                  role: 'user',
                  content: `User preferences:\n${JSON.stringify(preferences, null, 2)}\n\nListing:\n${JSON.stringify({
                    rent: listing.rent / 100,
                    bedrooms: listing.bedrooms,
                    bathrooms: listing.bathrooms,
                    sqft: listing.sqft,
                    amenities: listing.amenities,
                    neighborhood: listing.neighborhood,
                    city: listing.city,
                    description: listing.description,
                  }, null, 2)}`,
                }],
              })

              const rawText = scoreResponse.content[0].type === 'text' ? scoreResponse.content[0].text : '{}'
              // Strip markdown code fences (```json...``` or ```...```) before extracting JSON
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
                })
                return 1
              }
            } catch (err) {
              console.error('Scoring error:', err)
            }
            return 0
          }))
          scored += results.reduce((a: number, b: number) => a + b, 0)
        }

        await supabase
          .from('search_runs')
          .update({ listings_scored: (searchRun.listings_scored || 0) + scored })
          .eq('id', searchRunId)

        console.log(`Scored ${scored} listings for run ${resolvedRunId}`)
      })
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
  }

  // Return 200 immediately — scoring runs in background via after()
  return NextResponse.json({ ok: true })
}

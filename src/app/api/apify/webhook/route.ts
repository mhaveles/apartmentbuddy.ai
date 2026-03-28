import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { fetchScrapedListings } from '@/lib/apify'
import { anthropic, SCORING_PROMPT } from '@/lib/anthropic'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  // Verify secret
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { searchRunId, source, eventType, defaultDatasetId } = body

  if (!searchRunId || !source) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const supabase = await createServiceClient()

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
  const { data: updated } = await supabase
    .rpc('decrement_apify_runs_pending', { run_id: searchRunId })
    .select()
    .single()

  const allDone = updated && (updated as { apify_runs_pending: number }).apify_runs_pending === 0

  // Process listings on success
  if (eventType === 'ACTOR.RUN.SUCCEEDED' && defaultDatasetId) {
    const { data: preferences } = await supabase
      .from('preferences')
      .select('*')
      .eq('user_id', userId)
      .single()

    const listings = await fetchScrapedListings(defaultDatasetId, source)

    let scored = 0

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

      if (!savedListing) continue

      // Skip if already scored for this user
      const { data: existing } = await supabase
        .from('user_listings')
        .select('id')
        .eq('user_id', userId)
        .eq('listing_id', savedListing.id)
        .single()

      if (existing) continue

      if (preferences) {
        try {
          const scoreResponse = await anthropic.messages.create({
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

          const scoreText = scoreResponse.content[0].type === 'text' ? scoreResponse.content[0].text : '{}'
          const jsonMatch = scoreText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const scoreData = JSON.parse(jsonMatch[0])
            await supabase.from('user_listings').insert({
              user_id: userId,
              listing_id: savedListing.id,
              score: scoreData.score,
              score_breakdown: scoreData.breakdown,
              score_reasoning: scoreData.reasoning,
            })
            scored++
          }
        } catch (err) {
          console.error('Scoring error:', err)
        }
      }
    }

    await supabase
      .from('search_runs')
      .update({
        listings_found: (searchRun.listings_found || 0) + listings.length,
        listings_scored: (searchRun.listings_scored || 0) + scored,
      })
      .eq('id', searchRunId)
  }

  // Mark completed/failed once all actors have reported back.
  // Only mark 'failed' if zero listings found AND the last event was a failure —
  // partial results (some actors succeeded) should still be 'completed'.
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

  return NextResponse.json({ ok: true })
}

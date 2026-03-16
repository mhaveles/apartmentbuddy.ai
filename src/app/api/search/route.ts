import { NextRequest, NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, SCORING_PROMPT } from '@/lib/anthropic'
import { scrapeZillow, scrapeApartmentsCom, scrapeCraigslist, scrapeTrulia } from '@/lib/apify'
import { FREE_SEARCH_LIMIT } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check plan limits
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, searches_used')
    .eq('id', user.id)
    .single()

  if (!profile) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  if (profile.plan === 'free' && profile.searches_used >= FREE_SEARCH_LIMIT) {
    return NextResponse.json(
      { error: 'Free search limit reached. Upgrade to Pro for continuous monitoring.', upgrade: true },
      { status: 403 }
    )
  }

  // Get user preferences
  const { data: preferences } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!preferences) {
    return NextResponse.json(
      { error: 'Please complete the preferences chat first.' },
      { status: 400 }
    )
  }

  // Get monitored neighborhoods
  const { data: neighborhoods } = await supabase
    .from('monitored_neighborhoods')
    .select('*')
    .eq('user_id', user.id)
    .eq('active', true)

  if (!neighborhoods || neighborhoods.length === 0) {
    return NextResponse.json(
      { error: 'Please add at least one neighborhood to monitor.' },
      { status: 400 }
    )
  }

  // Create search run
  const { data: searchRun } = await supabase
    .from('search_runs')
    .insert({
      user_id: user.id,
      neighborhoods: neighborhoods.map(n => `${n.neighborhood}, ${n.city}, ${n.state}`),
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  // Return immediately — scraping happens async
  // In production this would be a background job / queue
  // For now we fire-and-forget via edge function

  // Update searches used for free tier
  if (profile.plan === 'free') {
    await supabase
      .from('profiles')
      .update({ searches_used: profile.searches_used + 1 })
      .eq('id', user.id)
  }

  // Use after() so Vercel keeps the function alive until scraping completes
  after(() => runSearchInBackground(user.id, neighborhoods, preferences, searchRun!.id).catch(console.error))

  return NextResponse.json({ searchRunId: searchRun!.id, status: 'running' })
}

async function runSearchInBackground(
  userId: string,
  neighborhoods: Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null }>,
  preferences: Record<string, unknown>,
  searchRunId: string
) {
  // Use service role for background work
  const { createServiceClient } = await import('@/lib/supabase/server')
  const supabase = await createServiceClient()

  try {
    // Scrape listings
    const [zillowListings, apartmentsListings, craigslistListings, truliaListings] = await Promise.all([
      scrapeZillow(neighborhoods),
      scrapeApartmentsCom(neighborhoods),
      scrapeCraigslist(neighborhoods),
      scrapeTrulia(neighborhoods),
    ])

    const allListings = [...zillowListings, ...apartmentsListings, ...craigslistListings, ...truliaListings]

    await supabase
      .from('search_runs')
      .update({ listings_found: allListings.length })
      .eq('id', searchRunId)

    let scored = 0

    for (const listing of allListings) {
      // Upsert the listing
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

      // Check if already scored for this user
      const { data: existing } = await supabase
        .from('user_listings')
        .select('id')
        .eq('user_id', userId)
        .eq('listing_id', savedListing.id)
        .single()

      if (existing) continue

      // Score with Claude
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
            }, null, 2)}`
          }]
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

    await supabase
      .from('search_runs')
      .update({
        status: 'completed',
        listings_scored: scored,
        completed_at: new Date().toISOString(),
      })
      .eq('id', searchRunId)
  } catch (error) {
    await supabase
      .from('search_runs')
      .update({
        status: 'failed',
        error: String(error),
        completed_at: new Date().toISOString(),
      })
      .eq('id', searchRunId)
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const searchRunId = searchParams.get('runId')
  if (!searchRunId) return NextResponse.json({ error: 'runId required' }, { status: 400 })

  await supabase
    .from('search_runs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', searchRunId)
    .eq('user_id', user.id)

  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const searchRunId = searchParams.get('runId')

  if (searchRunId) {
    const { data } = await supabase
      .from('search_runs')
      .select('*')
      .eq('id', searchRunId)
      .eq('user_id', user.id)
      .single()
    return NextResponse.json(data)
  }

  const { data } = await supabase
    .from('search_runs')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json(data)
}

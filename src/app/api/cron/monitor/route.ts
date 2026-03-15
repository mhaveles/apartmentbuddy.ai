import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { scrapeZillow, scrapeApartmentsCom } from '@/lib/apify'
import { anthropic, SCORING_PROMPT } from '@/lib/anthropic'

// Called by Vercel Cron every 6 hours for Pro users
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Get all Pro users with active neighborhoods
  const { data: proUsers } = await supabase
    .from('profiles')
    .select('id')
    .eq('plan', 'pro')
    .eq('subscription_status', 'active')

  if (!proUsers || proUsers.length === 0) {
    return NextResponse.json({ message: 'No pro users' })
  }

  let totalScored = 0

  for (const user of proUsers) {
    try {
      const { data: neighborhoods } = await supabase
        .from('monitored_neighborhoods')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true)

      if (!neighborhoods || neighborhoods.length === 0) continue

      const { data: preferences } = await supabase
        .from('preferences')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (!preferences) continue

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

      const [zillowListings, apartmentsListings] = await Promise.all([
        scrapeZillow(neighborhoods),
        scrapeApartmentsCom(neighborhoods),
      ])
      const allListings = [...zillowListings, ...apartmentsListings]

      let scored = 0
      for (const listing of allListings) {
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

        const { data: existing } = await supabase
          .from('user_listings')
          .select('id')
          .eq('user_id', user.id)
          .eq('listing_id', savedListing.id)
          .single()

        if (existing) continue

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
              user_id: user.id,
              listing_id: savedListing.id,
              score: scoreData.score,
              score_breakdown: scoreData.breakdown,
              score_reasoning: scoreData.reasoning,
            })
            scored++
            totalScored++
          }
        } catch {}
      }

      await supabase
        .from('search_runs')
        .update({
          status: 'completed',
          listings_found: allListings.length,
          listings_scored: scored,
          completed_at: new Date().toISOString(),
        })
        .eq('id', searchRun!.id)
    } catch (err) {
      console.error(`Error processing user ${user.id}:`, err)
    }
  }

  return NextResponse.json({ processed: proUsers.length, scored: totalScored })
}

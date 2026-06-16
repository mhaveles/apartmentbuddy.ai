import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { getAnthropic, SCORING_PROMPT } from '@/lib/anthropic'
import { geocodeAddress } from '@/lib/apify'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  void req
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: preferences } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!preferences) return NextResponse.json({ error: 'No preferences found' }, { status: 400 })

  const { data: userListings } = await supabase
    .from('user_listings')
    .select('id, listing_id, listing:listings(id, external_id, source, address, city, state, neighborhood, zip_code, rent, bedrooms, bathrooms, sqft, amenities, description, url)')
    .eq('user_id', user.id)
    .eq('is_dismissed', false)

  if (!userListings || userListings.length === 0) {
    return NextResponse.json({ rescored: 0 })
  }

  // Return immediately — heavy work runs in background
  after(async () => {
    const serviceClient = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    type ListingRow = {
      id: string
      external_id: string
      source: string
      address: string | null
      city: string
      state: string
      neighborhood: string | null
      zip_code: string | null
      rent: number
      bedrooms: number | null
      bathrooms: number | null
      sqft: number | null
      amenities: string[] | null
      description: string | null
      url: string
    }

    // Step 1: Geocode listings missing neighborhood (max 20, Nominatim rate-limit 1/sec)
    const toGeocode = userListings
      .map(ul => ul.listing as unknown as ListingRow | null)
      .filter((l): l is ListingRow => l !== null && !l.neighborhood && !!l.address && !!l.city)
      .slice(0, 20)

    for (const l of toGeocode) {
      const neighborhood = await geocodeAddress(l.address!, l.city, l.state)
      if (neighborhood) {
        await serviceClient
          .from('listings')
          .update({ neighborhood })
          .eq('id', l.id)
        l.neighborhood = neighborhood
      }
      await new Promise(r => setTimeout(r, 1100)) // Nominatim rate limit: 1 req/sec
    }

    // Step 2: Re-score all listings in batches of 5
    const toScore = userListings.slice(0, 50)
    const CONCURRENCY = 5
    let rescored = 0

    for (let i = 0; i < toScore.length; i += CONCURRENCY) {
      const batch = toScore.slice(i, i + CONCURRENCY)
      const results = await Promise.all(batch.map(async (ul) => {
        const l = ul.listing as unknown as ListingRow | null
        if (!l) return 0
        try {
          const scoreResponse = await getAnthropic().messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 512,
            system: SCORING_PROMPT,
            messages: [{
              role: 'user',
              content: `User preferences:\n${JSON.stringify(preferences, null, 2)}\n\nListing:\n${JSON.stringify({
                address: l.address,
                zip_code: l.zip_code,
                neighborhood: l.neighborhood,
                city: l.city,
                state: l.state,
                rent: l.rent / 100,
                bedrooms: l.bedrooms,
                bathrooms: l.bathrooms,
                sqft: l.sqft,
                amenities: l.amenities,
                description: l.description,
              }, null, 2)}`,
            }],
          })

          const rawText = scoreResponse.content[0].type === 'text' ? scoreResponse.content[0].text : '{}'
          const scoreText = rawText.replace(/```(?:json)?\s*/g, '').replace(/```/g, '')
          const jsonMatch = scoreText.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const scoreData = JSON.parse(jsonMatch[0])
            await serviceClient
              .from('user_listings')
              .update({
                score: scoreData.score,
                score_breakdown: scoreData.breakdown,
                score_reasoning: scoreData.reasoning,
              })
              .eq('id', ul.id)
            return 1
          }
        } catch (err) {
          console.error('Rescore error for listing', ul.listing_id, err)
        }
        return 0
      }))
      rescored += results.reduce((a: number, b: number) => a + b, 0)
    }

    console.log(`Rescore complete: ${rescored} listings updated`)
  })

  return NextResponse.json({ rescoring: true, count: userListings.length })
}

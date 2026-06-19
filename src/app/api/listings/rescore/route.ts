import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropic, SCORING_PROMPT, fetchListingImages } from '@/lib/anthropic'

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
    .select('id, listing_id, listing:listings(id, address, city, state, neighborhood, zip_code, rent, bedrooms, bathrooms, sqft, amenities, description, images)')
    .eq('user_id', user.id)
    .eq('is_dismissed', false)
    .limit(20)

  if (!userListings || userListings.length === 0) {
    return NextResponse.json({ rescored: 0 })
  }

  type ListingRow = {
    id: string
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
    images: string[] | null
  }

  const CONCURRENCY = 5
  let rescored = 0

  for (let i = 0; i < userListings.length; i += CONCURRENCY) {
    const batch = userListings.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (ul) => {
      const l = ul.listing as unknown as ListingRow | null
      if (!l) return 0
      try {
        const imageBlocks = await fetchListingImages(l.images || [], 5)
        const textContent = `User preferences:\n${JSON.stringify(preferences, null, 2)}\n\nListing:\n${JSON.stringify({
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
          await supabase
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

  console.log(`Rescore complete: ${rescored}/${userListings.length} listings updated`)
  return NextResponse.json({ rescored, count: userListings.length })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropic, SCORING_PROMPT, fetchListingImages } from '@/lib/anthropic'
import { buildVotedContext, type VotedRow } from '@/lib/scoring-utils'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const supabase = await createClient()

  let userId: string
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${process.env.CRON_SECRET}`) {
    const body = await req.json()
    if (!body?.userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    userId = body.userId
  } else {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    userId = user.id
  }

  const { data: preferences } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!preferences) return NextResponse.json({ error: 'No preferences found' }, { status: 400 })

  // Atomically claim stale listings — listings whose scored_at is null (never manually rescored)
  // or older than the last preferences update. FOR UPDATE SKIP LOCKED inside the RPC ensures
  // concurrent rescore calls each claim a disjoint set of rows.
  const { data: claimed, error: claimError } = await supabase.rpc('claim_stale_user_listings_for_rescore', {
    p_user_id: userId,
    p_prefs_updated_at: preferences.updated_at,
    p_limit: 20,
  })

  if (claimError) {
    console.error('claim_stale_user_listings_for_rescore RPC error:', claimError.message)
    return NextResponse.json({ error: 'Failed to claim listings for rescoring' }, { status: 500 })
  }

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ rescored: 0 })
  }

  // Fetch full listing data for claimed IDs
  const { data: userListings } = await supabase
    .from('user_listings')
    .select('id, listing_id, listing:listings(id, address, city, state, neighborhood, zip_code, rent, bedrooms, bathrooms, sqft, amenities, description, images)')
    .in('id', (claimed as Array<{ id: string; listing_id: string }>).map(c => c.id))

  if (!userListings || userListings.length === 0) {
    return NextResponse.json({ rescored: 0 })
  }

  const [{ data: likedListings }, { data: dislikedListings }] = await Promise.all([
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

  const votedContext = buildVotedContext([
    ...((likedListings ?? []) as VotedRow[]),
    ...((dislikedListings ?? []) as VotedRow[]),
  ])

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
        // Mirror the webhook's priorityNote block exactly so both scoring paths are identical
        const priorityNote = preferences.priorities
          ? `\nDimension priorities — weight your scores accordingly (high = more influential, low = less influential):\n${JSON.stringify(preferences.priorities, null, 2)}\n`
          : ''
        const textContent = `User preferences:\n${JSON.stringify(preferences, null, 2)}${priorityNote}${votedContext}\n\nListing:\n${JSON.stringify({
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
          // scored_at is already set to claim time by the RPC; only update score columns
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

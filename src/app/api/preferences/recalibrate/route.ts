import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropic } from '@/lib/anthropic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const supabase = await createClient()

  // Fetch voted listings with their full listing data
  const { data: votedListings } = await supabase
    .from('user_listings')
    .select('vote, score_breakdown, listing:listings(rent, bedrooms, bathrooms, sqft, neighborhood, city, amenities)')
    .eq('user_id', userId)
    .not('vote', 'is', null)

  if (!votedListings || votedListings.length < 10) {
    return NextResponse.json({ skipped: true, reason: 'fewer than 10 votes' })
  }

  const liked = votedListings.filter(v => v.vote === 1)
  const disliked = votedListings.filter(v => v.vote === -1)

  const formatListing = (v: typeof votedListings[number]) => {
    const l = v.listing as unknown as Record<string, unknown> | null
    return {
      breakdown: v.score_breakdown,
      rent: l?.rent,
      bedrooms: l?.bedrooms,
      sqft: l?.sqft,
      neighborhood: l?.neighborhood,
      amenities: l?.amenities,
    }
  }

  const prompt = `A user has rated ${liked.length} apartments as good matches and ${disliked.length} as poor matches.

Liked apartments:
${JSON.stringify(liked.map(formatListing), null, 2)}

Disliked apartments:
${JSON.stringify(disliked.map(formatListing), null, 2)}

Based on these patterns, what does this user appear to prioritize most when choosing an apartment? Consider their score breakdowns (price, location, size, amenities, availability) and listing attributes.

Return ONLY a JSON object with this exact shape — no explanation, no markdown:
{
  "price": "high|medium|low",
  "location": "high|medium|low",
  "size": "high|medium|low",
  "amenities": "high|medium|low",
  "insight": "<1 sentence explaining the pattern you observed>"
}`

  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse Claude response' }, { status: 500 })

  const suggested = JSON.parse(jsonMatch[0])
  const { insight, ...suggestedPriorities } = suggested

  // Store the suggestion — the UI will prompt the user to confirm before applying
  const { error } = await supabase
    .from('preferences')
    .update({ priorities_suggestion: suggestedPriorities, priorities_insight: insight })
    .eq('user_id', userId)

  if (error) {
    console.error('Recalibrate update error:', error)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  return NextResponse.json({ suggested: suggestedPriorities, insight })
}

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAnthropic } from '@/lib/anthropic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const supabase = await createServiceClient()

  // Fetch voted listings ordered by disagreement (score_vote_delta ASC = AI liked it, user didn't)
  const { data: prefsRow } = await supabase
    .from('preferences')
    .select('user_reply')
    .eq('user_id', userId)
    .single()

  const userReply: string | null = prefsRow?.user_reply ?? null

  const { data: votedListings } = await supabase
    .from('user_listings')
    .select('vote, score, score_vote_delta, score_breakdown, listing:listings(rent, bedrooms, bathrooms, sqft, neighborhood, city, amenities)')
    .eq('user_id', userId)
    .not('vote', 'is', null)
    .order('score_vote_delta', { ascending: true })
    .limit(30)

  if (!votedListings || votedListings.length < 10) {
    return NextResponse.json({ skipped: true, reason: 'fewer than 10 votes' })
  }

  const formatListing = (v: typeof votedListings[number]) => {
    const l = v.listing as unknown as Record<string, unknown> | null
    return {
      vote: v.vote,
      ai_score: v.score,
      disagreement: v.score_vote_delta,
      breakdown: v.score_breakdown,
      rent: l?.rent,
      bedrooms: l?.bedrooms,
      sqft: l?.sqft,
      neighborhood: l?.neighborhood,
      city: l?.city,
      amenities: l?.amenities,
    }
  }

  const prompt = `A user voted on apartments. Below are up to 30 of their ratings, ordered by disagreement with the AI (most disagreeable first — negative "disagreement" means the AI scored it highly but the user disliked it).

All voted listings (ordered by disagreement, most contentious first):
${JSON.stringify(votedListings.map(formatListing), null, 2)}

Identify 3–5 specific patterns that explain where the AI's scores diverge from this user's taste. Each finding should:
- Reference concrete evidence from the data (rent ranges, neighborhoods, amenity combos, bedroom counts, etc.)
- Be written as a plain-English sentence a non-technical user can act on
- Explain *why* the mismatch exists, not just that it does

Also infer priority weights for the 4 scoring dimensions.

Return ONLY a JSON object — no explanation, no markdown:
{
  "price": "high|medium|low",
  "location": "high|medium|low",
  "size": "high|medium|low",
  "amenities": "high|medium|low",
  "insight": "<3–5 bullet findings separated by \\n, each starting with •>"
}${userReply ? `\n\nThe user also said: "${userReply}". Factor this into your findings.` : ''}`

  const response = await getAnthropic().messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw = response.content[0].type === 'text' ? response.content[0].text : '{}'
  const jsonMatch = raw.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return NextResponse.json({ error: 'Failed to parse Claude response' }, { status: 500 })

  const suggested = JSON.parse(jsonMatch[0])
  const { insight, ...suggestedPriorities } = suggested

  // Store the suggestion — the UI will prompt the user to confirm before applying
  // Clear user_reply so it isn't reused on the next recalibration
  const { error } = await supabase
    .from('preferences')
    .update({ priorities_suggestion: suggestedPriorities, priorities_insight: insight, user_reply: null })
    .eq('user_id', userId)

  if (error) {
    console.error('Recalibrate update error:', error)
    return NextResponse.json({ error: 'DB update failed' }, { status: 500 })
  }

  return NextResponse.json({ suggested: suggestedPriorities, insight })
}

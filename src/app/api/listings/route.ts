import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const savedOnly = searchParams.get('saved') === 'true'

  let query = supabase
    .from('user_listings')
    .select(`
      *,
      listing:listings(*),
      search_run:search_runs(neighborhood_id, neighborhood_label)
    `)
    .eq('user_id', user.id)
    .eq('is_dismissed', false)
    .order('score', { ascending: false })

  if (savedOnly) {
    query = query.eq('is_saved', true)
  }

  const { data } = await query

  type ListingRecord = { url?: string; address?: string; rent?: number; is_available?: boolean }

  // Filter unavailable listings
  const available = (data || []).filter(ul => (ul.listing as ListingRecord | null)?.is_available !== false)

  // Deduplicate: same URL or same address+rent from different sources — keep highest score (already sorted desc)
  const seen = new Set<string>()
  const deduplicated = available.filter(ul => {
    const l = ul.listing as ListingRecord | null
    const url = l?.url?.trim()
    const address = l?.address?.toLowerCase().trim()
    const rent = l?.rent

    if (url) {
      if (seen.has(`url:${url}`)) return false
      seen.add(`url:${url}`)
    }
    if (address && address.length > 5 && rent) {
      const key = `addr:${address}:${rent}`
      if (seen.has(key)) return false
      seen.add(key)
    }
    return true
  })

  const ranked = deduplicated.map((ul, i) => ({
    ...ul,
    rank: i + 1,
    total: deduplicated.length,
  }))

  return NextResponse.json(ranked)
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, is_saved, is_dismissed, vote } = await req.json()

  const updates: Record<string, boolean | number | null> = {}
  if (is_saved !== undefined) updates.is_saved = is_saved
  if (is_dismissed !== undefined) updates.is_dismissed = is_dismissed
  if (vote !== undefined) {
    const { data: cur } = await supabase
      .from('user_listings')
      .select('score')
      .eq('id', id)
      .eq('user_id', user.id)
      .single()
    updates.vote = vote
    updates.score_vote_delta = vote !== null && cur?.score != null ? cur.score * vote : null
  }

  const { data, error } = await supabase
    .from('user_listings')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    console.error('PATCH /api/listings update error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // After a vote, check if we've hit the recalibration threshold (10, 15, 20, ...)
  if (vote !== undefined && vote !== null) {
    const { count, error: countError } = await supabase
      .from('user_listings')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .not('vote', 'is', null)

    if (countError) {
      console.error('PATCH /api/listings vote-count error:', countError)
    }

    const totalVotes = count ?? 0
    if (totalVotes >= 10 && (totalVotes === 10 || totalVotes % 5 === 0)) {
      // Fire recalibration in background — don't await so PATCH responds immediately
      fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/preferences/recalibrate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({ userId: user.id }),
      }).catch(() => { /* non-critical */ })
    }
  }

  return NextResponse.json(data)
}

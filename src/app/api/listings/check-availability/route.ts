import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'

export const maxDuration = 30

async function isUrlAvailable(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    return res.status !== 404
  } catch {
    return true // network/timeout errors — assume still available
  } finally {
    clearTimeout(timeout)
  }
}

export async function POST(req: NextRequest) {
  void req
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data: userListings } = await supabase
    .from('user_listings')
    .select('listing_id, listing:listings(id, url, is_available, availability_checked_at)')
    .eq('user_id', user.id)
    .eq('is_dismissed', false)

  if (!userListings || userListings.length === 0) {
    return NextResponse.json({ checked: 0, removed: 0 })
  }

  type ListingRow = { id: string; url: string; is_available: boolean; availability_checked_at: string | null }

  const toCheck = userListings
    .map(ul => ul.listing as unknown as ListingRow | null)
    .filter((l): l is ListingRow =>
      l !== null &&
      (!l.availability_checked_at || l.availability_checked_at < oneDayAgo)
    )
    .slice(0, 30)

  if (toCheck.length === 0) {
    return NextResponse.json({ checked: 0, removed: 0 })
  }

  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const CONCURRENCY = 5
  let checked = 0
  let removed = 0

  for (let i = 0; i < toCheck.length; i += CONCURRENCY) {
    const batch = toCheck.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map(async (listing) => {
      const available = await isUrlAvailable(listing.url)
      await serviceClient.from('listings').update({
        is_available: available,
        availability_checked_at: new Date().toISOString(),
      }).eq('id', listing.id)
        return available ? 0 : 1
    }))
    checked += batch.length
    removed += results.reduce((a: number, b: number) => a + b, 0)
  }

  return NextResponse.json({ checked, removed })
}

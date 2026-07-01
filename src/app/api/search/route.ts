import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { startZillowScrape, startCraigslistScrape, startTruliaScrape } from '@/lib/apify'
import { checkCredits, recordSearchUsed } from '@/lib/credits'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const creditCheck = await checkCredits(supabase, user.id)

  if (!creditCheck.allowed) {
    return NextResponse.json(
      { error: "You've used your 3 free searches. Get 3 more for $5.", paywall: true },
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
      apify_runs_pending: 1,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (!searchRun) {
    return NextResponse.json({ error: 'Failed to create search run' }, { status: 500 })
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/apify/webhook?secret=${process.env.CRON_SECRET}`

  const [zillowResult, craigslistResult, truliaResult] = await Promise.allSettled([
    startZillowScrape(neighborhoods, webhookUrl, searchRun.id, preferences),
    startCraigslistScrape(neighborhoods, webhookUrl, searchRun.id, preferences),
    startTruliaScrape(neighborhoods, webhookUrl, searchRun.id, preferences),
  ])

  const runIds = {
    zillow: zillowResult.status === 'fulfilled' ? zillowResult.value : null,
    craigslist: craigslistResult.status === 'fulfilled' ? craigslistResult.value : null,
    trulia: truliaResult.status === 'fulfilled' ? truliaResult.value : null,
  }

  const successfulStarts = Object.values(runIds).filter(Boolean).length

  const failures = [
    zillowResult.status === 'rejected' ? `zillow: ${(zillowResult.reason as Error).message}` : null,
    craigslistResult.status === 'rejected' ? `craigslist: ${(craigslistResult.reason as Error).message}` : null,
    truliaResult.status === 'rejected' ? `trulia: ${(truliaResult.reason as Error).message}` : null,
  ].filter(Boolean) as string[]

  if (failures.length > 0) {
    console.error('Some actors failed to start:', failures)
  }

  if (successfulStarts === 0) {
    await supabase
      .from('search_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', searchRun.id)
    return NextResponse.json({ error: 'All scrapers failed to start', details: failures }, { status: 500 })
  }

  // Store run IDs and set pending count to only the actors that actually started
  await supabase
    .from('search_runs')
    .update({
      apify_run_ids: runIds,
      apify_runs_pending: successfulStarts,
    })
    .eq('id', searchRun.id)

  if (creditCheck.plan === 'free') {
    await recordSearchUsed(supabase, user.id)
  }

  return NextResponse.json({ searchRunId: searchRun.id, status: 'running', started: successfulStarts, failures })
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

    // Auto-recover stale runs: if all actors reported back but status wasn't updated
    // (race condition or webhook failure), resolve it now rather than leaving UI stuck.
    if (data && (data.status === 'running' || data.status === 'pending')) {
      const staleAt = new Date(Date.now() - 15 * 60 * 1000).toISOString()
      const isStale = data.started_at < staleAt
      const allActorsDone = (data.apify_runs_pending as number) === 0
      if (allActorsDone || isStale) {
        const resolvedStatus = allActorsDone ? 'completed' : 'failed'
        await supabase
          .from('search_runs')
          .update({ status: resolvedStatus, completed_at: new Date().toISOString() })
          .eq('id', searchRunId)
        return NextResponse.json({ ...data, status: resolvedStatus })
      }
    }

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

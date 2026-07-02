import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { triggerSearchForUser } from '@/lib/search-trigger'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const result = await triggerSearchForUser(supabase, user.id)

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        ...(result.paywall && { paywall: true }),
        ...(result.details && { details: result.details }),
      },
      { status: result.status }
    )
  }

  return NextResponse.json({
    searchRunId: result.searchRunId,
    status: 'running',
    started: result.started,
    failures: result.failures,
  })
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

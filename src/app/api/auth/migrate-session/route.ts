import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { migrateAnonSession } from '@/lib/migrate-anon-session'

// Called by the signup flow right after auth completes. Marks the anon session
// converted, migrates its preferences_json into the new user's preferences +
// monitored_neighborhoods, and auto-fires their first search.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { sessionId }: { sessionId?: string } = await req.json()
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 })
  }

  const service = await createServiceClient()
  const result = await migrateAnonSession(supabase, service, user.id, sessionId)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  if ('needsNeighborhood' in result) {
    return NextResponse.json({ migrated: true, needsNeighborhood: true })
  }

  if ('searchError' in result) {
    return NextResponse.json({ migrated: true, searchError: result.searchError })
  }

  return NextResponse.json({ migrated: true, searchRunId: result.searchRunId })
}

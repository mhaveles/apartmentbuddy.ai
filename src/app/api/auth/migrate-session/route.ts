import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { applyExtractedPreferences } from '@/lib/preferences'
import { triggerSearchForUser } from '@/lib/search-trigger'

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

  const { data: anonSession } = await service
    .from('anon_sessions')
    .select('id')
    .eq('session_id', sessionId)
    .single()

  if (!anonSession) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  const { data: migrated, error: rpcError } = await service
    .rpc('migrate_anon_session', { anon_session_id: anonSession.id, new_user_id: user.id })
    .select()
    .single()

  if (rpcError || !migrated) {
    return NextResponse.json({ error: 'Session already converted or not found' }, { status: 409 })
  }

  const prefs = (migrated as { preferences_json: Record<string, unknown> | null }).preferences_json
  if (prefs) {
    await applyExtractedPreferences(supabase, user.id, prefs)
  }

  const searchResult = await triggerSearchForUser(supabase, user.id)
  if (!searchResult.ok) {
    return NextResponse.json({ migrated: true, searchError: searchResult.error })
  }

  return NextResponse.json({ migrated: true, searchRunId: searchResult.searchRunId })
}

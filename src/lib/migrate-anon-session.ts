import { SupabaseClient } from '@supabase/supabase-js'
import { applyExtractedPreferences } from '@/lib/preferences'
import { triggerSearchForUser } from '@/lib/search-trigger'

export type MigrateAnonSessionResult =
  | { ok: true; searchRunId: string }
  | { ok: true; searchError: string }
  | { ok: false; status: number; error: string }

// Marks an anon session converted, migrates its preferences_json into the new
// user's preferences/monitored_neighborhoods, and auto-fires their first search.
// Shared by the email/password migrate-session route and the OAuth callback route,
// since the latter completes server-side and can't make an authenticated HTTP
// round-trip back to this app.
export async function migrateAnonSession(
  supabase: SupabaseClient,
  service: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<MigrateAnonSessionResult> {
  const { data: anonSession } = await service
    .from('anon_sessions')
    .select('id')
    .eq('session_id', sessionId)
    .single()

  if (!anonSession) {
    return { ok: false, status: 404, error: 'Session not found' }
  }

  const { data: migrated, error: rpcError } = await service
    .rpc('migrate_anon_session', { anon_session_id: anonSession.id, new_user_id: userId })
    .select()
    .single()

  if (rpcError || !migrated) {
    return { ok: false, status: 409, error: 'Session already converted or not found' }
  }

  const prefs = (migrated as { preferences_json: Record<string, unknown> | null }).preferences_json
  if (prefs) {
    await applyExtractedPreferences(supabase, userId, prefs)
  }

  const searchResult = await triggerSearchForUser(supabase, userId)
  if (!searchResult.ok) {
    return { ok: true, searchError: searchResult.error }
  }

  return { ok: true, searchRunId: searchResult.searchRunId }
}

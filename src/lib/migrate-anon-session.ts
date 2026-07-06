import { SupabaseClient } from '@supabase/supabase-js'
import { applyExtractedPreferences } from '@/lib/preferences'
import { triggerSearchForUser } from '@/lib/search-trigger'
import { Message } from '@/types'

export type MigrateAnonSessionResult =
  | { ok: true; searchRunId: string }
  | { ok: true; searchError: string }
  | { ok: true; needsNeighborhood: true }
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
  const { data: anonSession, error: selectError } = await service
    .from('anon_sessions')
    .select('id')
    .eq('session_id', sessionId)
    .single()

  if (selectError || !anonSession) {
    if (selectError && selectError.code !== 'PGRST116') {
      console.error('anon_sessions lookup failed during migration:', selectError)
    }
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
  const chatHistory = (migrated as { chat_history: Message[] | null }).chat_history

  if (chatHistory && chatHistory.length > 0) {
    const { error: conversationError } = await supabase
      .from('conversations')
      .insert({
        user_id: userId,
        messages: chatHistory,
        preferences_extracted: !!prefs,
      })
    if (conversationError) {
      console.error('Failed to migrate conversation history:', conversationError)
    }
  }

  let hasNeighborhoods = false
  if (prefs) {
    const applied = await applyExtractedPreferences(supabase, userId, prefs)
    hasNeighborhoods = applied.hasNeighborhoods
  }

  // The pre-signup chat never confirmed a neighborhood (or it failed validation) —
  // triggerSearchForUser would just fail with the same generic error, so skip straight
  // to telling the caller this user needs to add one before any search can run.
  if (!hasNeighborhoods) {
    return { ok: true, needsNeighborhood: true }
  }

  const searchResult = await triggerSearchForUser(supabase, userId)
  if (!searchResult.ok) {
    return { ok: true, searchError: searchResult.error }
  }

  return { ok: true, searchRunId: searchResult.searchRunId }
}

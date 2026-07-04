import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getAnthropic, getSystemPrompt } from '@/lib/anthropic'
import { extractPreferencesJson } from '@/lib/preferences'

type AnonMessage = { role: 'user' | 'assistant'; content: string; timestamp: string }

// No-auth onboarding chat for pre-login visitors. Mirrors /api/chat's onboarding
// path but persists into anon_sessions (keyed by a client-generated session_id)
// instead of conversations/preferences, since there's no user yet.
export async function POST(req: NextRequest) {
  try {
    const { sessionId, message }: { sessionId?: string; message?: string } = await req.json()

    if (!sessionId || !message) {
      return NextResponse.json({ error: 'sessionId and message are required' }, { status: 400 })
    }

    const supabase = await createServiceClient()

    let { data: session, error: selectError } = await supabase
      .from('anon_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single()

    // PGRST116 = "no rows found", which just means this session doesn't exist yet.
    // Any other error (RLS, bad key, missing table, etc.) is a real failure —
    // don't silently fall through to insert as if the row simply wasn't there.
    if (selectError && selectError.code !== 'PGRST116') {
      console.error('anon_sessions select error:', selectError)
      return NextResponse.json(
        { error: `Failed to load session: ${selectError.message}` },
        { status: 500 }
      )
    }

    if (!session) {
      const { data: created, error: insertError } = await supabase
        .from('anon_sessions')
        .insert({ session_id: sessionId, chat_history: [] })
        .select()
        .single()

      if (insertError) {
        console.error('anon_sessions insert error:', insertError)
        return NextResponse.json(
          { error: `Failed to create session: ${insertError.message}` },
          { status: 500 }
        )
      }

      session = created
    }

    if (!session) {
      return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
    }

    if (session.status !== 'pending') {
      return NextResponse.json({ error: 'This session has already been converted' }, { status: 409 })
    }

    const history: AnonMessage[] = session.chat_history || []
    history.push({ role: 'user', content: message, timestamp: new Date().toISOString() })

    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: getSystemPrompt('onboarding'),
      messages: history.map(m => ({ role: m.role, content: m.content })),
    })

    const assistantContent = response.content[0].type === 'text' ? response.content[0].text : ''
    history.push({ role: 'assistant', content: assistantContent, timestamp: new Date().toISOString() })

    const prefs = extractPreferencesJson(assistantContent)

    const { error: updateError } = await supabase
      .from('anon_sessions')
      .update({
        chat_history: history,
        ...(prefs && { preferences_json: prefs }),
      })
      .eq('id', session.id)

    if (updateError) {
      console.error('anon_sessions update error:', updateError)
    }

    return NextResponse.json({
      message: { role: 'assistant', content: assistantContent },
      sessionId,
      promptSignup: prefs !== null,
    })
  } catch (err) {
    console.error('Anonymous chat error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

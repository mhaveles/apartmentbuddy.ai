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

    let { data: session } = await supabase
      .from('anon_sessions')
      .select('*')
      .eq('session_id', sessionId)
      .single()

    if (!session) {
      const { data: created } = await supabase
        .from('anon_sessions')
        .insert({ session_id: sessionId, chat_history: [] })
        .select()
        .single()
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

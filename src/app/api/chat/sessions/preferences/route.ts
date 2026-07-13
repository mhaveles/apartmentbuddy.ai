import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: rawSession, error } = await supabase
    .rpc('find_or_create_preferences_session')
    .select()
    .single()

  if (error || !rawSession) {
    return NextResponse.json({ error: error?.message || 'Failed to resolve session' }, { status: 500 })
  }

  const session = rawSession as { id: string; intent: string; conversation_id: string | null }

  let messages = []
  if (session.conversation_id) {
    const { data: conversation } = await supabase
      .from('conversations')
      .select('messages')
      .eq('id', session.conversation_id)
      .eq('user_id', user.id)
      .single()
    messages = conversation?.messages || []
  }

  return NextResponse.json({
    id: session.id,
    intent: session.intent,
    conversationId: session.conversation_id,
    messages,
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const userListingId = body?.user_listing_id
  if (typeof userListingId !== 'string' || !userListingId) {
    return NextResponse.json({ error: 'user_listing_id is required' }, { status: 400 })
  }

  const { data: rawSession, error } = await supabase
    .rpc('find_or_create_deep_dive_session', { p_user_listing_id: userListingId })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rawSession) return NextResponse.json({ error: 'Listing not found' }, { status: 404 })

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

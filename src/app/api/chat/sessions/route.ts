import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const VALID_INTENTS = ['onboarding', 'refinement', 'check-in', 'deep-dive'] as const

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { intent, context } = body

  if (!VALID_INTENTS.includes(intent)) {
    return NextResponse.json(
      { error: `intent must be one of: ${VALID_INTENTS.join(', ')}` },
      { status: 400 }
    )
  }

  const { data: session, error } = await supabase
    .from('chat_sessions')
    .insert({ user_id: user.id, intent, context: context ?? null })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(session, { status: 201 })
}

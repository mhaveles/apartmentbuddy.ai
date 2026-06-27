import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const reply: string | undefined = typeof body?.reply === 'string' && body.reply ? body.reply : undefined

  const { data: prefs } = await supabase
    .from('preferences')
    .select('priorities_suggestion')
    .eq('user_id', user.id)
    .single()

  if (!prefs?.priorities_suggestion) {
    return NextResponse.json({ error: 'No suggestion to apply' }, { status: 400 })
  }

  await supabase
    .from('preferences')
    .update({
      priorities: prefs.priorities_suggestion,
      priorities_suggestion: null,
      priorities_insight: null,
      ...(reply !== undefined ? { user_reply: reply } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/listings/rescore`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.CRON_SECRET}`,
    },
    body: JSON.stringify({ userId: user.id }),
  }).catch(() => { /* non-critical */ })

  return NextResponse.json({ applied: true })
}

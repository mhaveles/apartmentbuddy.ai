import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)

  return NextResponse.json({ applied: true })
}

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('preferences')
    .select('priorities, priorities_suggestion, priorities_insight')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data ?? {})
}

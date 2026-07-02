import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: prefs } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!prefs) return NextResponse.json({})

  const { data: neighborhoods } = await supabase
    .from('monitored_neighborhoods')
    .select('neighborhood, city, state')
    .eq('user_id', user.id)
    .eq('active', true)

  return NextResponse.json({ ...prefs, neighborhoods: neighborhoods ?? [] })
}

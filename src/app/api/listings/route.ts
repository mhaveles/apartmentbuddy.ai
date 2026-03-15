import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const savedOnly = searchParams.get('saved') === 'true'

  let query = supabase
    .from('user_listings')
    .select(`
      *,
      listing:listings(*)
    `)
    .eq('user_id', user.id)
    .eq('is_dismissed', false)
    .order('score', { ascending: false })

  if (savedOnly) {
    query = query.eq('is_saved', true)
  }

  const { data } = await query

  return NextResponse.json(data || [])
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, is_saved, is_dismissed } = await req.json()

  const updates: Record<string, boolean> = {}
  if (is_saved !== undefined) updates.is_saved = is_saved
  if (is_dismissed !== undefined) updates.is_dismissed = is_dismissed

  const { data } = await supabase
    .from('user_listings')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  return NextResponse.json(data)
}

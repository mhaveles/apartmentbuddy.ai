import { SupabaseClient } from '@supabase/supabase-js'

type CreditCheck =
  | { allowed: true; plan: string }
  | { allowed: false; paywall: true }

// Pro plan bypasses credits entirely (unlimited, per continuous monitoring).
// Free plan is gated by credits - searches_used.
export async function checkCredits(supabase: SupabaseClient, userId: string): Promise<CreditCheck> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, credits, searches_used')
    .eq('id', userId)
    .single()

  if (!profile) return { allowed: false, paywall: true }
  if (profile.plan === 'pro') return { allowed: true, plan: profile.plan }

  const remaining = profile.credits - profile.searches_used
  if (remaining <= 0) return { allowed: false, paywall: true }

  return { allowed: true, plan: profile.plan }
}

export async function recordSearchUsed(supabase: SupabaseClient, userId: string) {
  const { error } = await supabase.rpc('increment_searches_used', { user_id: userId })
  if (error) {
    console.error('increment_searches_used RPC failed:', error.message)
  }
}

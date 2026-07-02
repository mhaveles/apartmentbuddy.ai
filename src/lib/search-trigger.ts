import { SupabaseClient } from '@supabase/supabase-js'
import { startZillowScrape, startCraigslistScrape, startTruliaScrape } from '@/lib/apify'
import { checkCredits, recordSearchUsed } from '@/lib/credits'

export type TriggerSearchResult =
  | { ok: true; searchRunId: string; started: number; failures: string[] }
  | { ok: false; status: number; error: string; paywall?: true; details?: string[] }

// Starts a search run for a user: credit check, fetch preferences/neighborhoods,
// insert a search_runs row, fire the scraper actors, record their run IDs.
// Shared by the authenticated /api/search endpoint and the post-signup auto-fire path.
export async function triggerSearchForUser(supabase: SupabaseClient, userId: string): Promise<TriggerSearchResult> {
  const creditCheck = await checkCredits(supabase, userId)

  if (!creditCheck.allowed) {
    return {
      ok: false,
      status: 403,
      error: "You've used your 3 free searches. Get 3 more for $5.",
      paywall: true,
    }
  }

  const { data: preferences } = await supabase
    .from('preferences')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (!preferences) {
    return { ok: false, status: 400, error: 'Please complete the preferences chat first.' }
  }

  const { data: neighborhoods } = await supabase
    .from('monitored_neighborhoods')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)

  if (!neighborhoods || neighborhoods.length === 0) {
    return { ok: false, status: 400, error: 'Please add at least one neighborhood to monitor.' }
  }

  const { data: searchRun } = await supabase
    .from('search_runs')
    .insert({
      user_id: userId,
      neighborhoods: neighborhoods.map(n => `${n.neighborhood}, ${n.city}, ${n.state}`),
      status: 'running',
      apify_runs_pending: 1,
      started_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (!searchRun) {
    return { ok: false, status: 500, error: 'Failed to create search run' }
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/apify/webhook?secret=${process.env.CRON_SECRET}`

  const [zillowResult, craigslistResult, truliaResult] = await Promise.allSettled([
    startZillowScrape(neighborhoods, webhookUrl, searchRun.id, preferences),
    startCraigslistScrape(neighborhoods, webhookUrl, searchRun.id, preferences),
    startTruliaScrape(neighborhoods, webhookUrl, searchRun.id, preferences),
  ])

  const runIds = {
    zillow: zillowResult.status === 'fulfilled' ? zillowResult.value : null,
    craigslist: craigslistResult.status === 'fulfilled' ? craigslistResult.value : null,
    trulia: truliaResult.status === 'fulfilled' ? truliaResult.value : null,
  }

  const successfulStarts = Object.values(runIds).filter(Boolean).length

  const failures = [
    zillowResult.status === 'rejected' ? `zillow: ${(zillowResult.reason as Error).message}` : null,
    craigslistResult.status === 'rejected' ? `craigslist: ${(craigslistResult.reason as Error).message}` : null,
    truliaResult.status === 'rejected' ? `trulia: ${(truliaResult.reason as Error).message}` : null,
  ].filter(Boolean) as string[]

  if (failures.length > 0) {
    console.error('Some actors failed to start:', failures)
  }

  if (successfulStarts === 0) {
    await supabase
      .from('search_runs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', searchRun.id)
    return { ok: false, status: 500, error: 'All scrapers failed to start', details: failures }
  }

  // Store run IDs and set pending count to only the actors that actually started
  await supabase
    .from('search_runs')
    .update({
      apify_run_ids: runIds,
      apify_runs_pending: successfulStarts,
    })
    .eq('id', searchRun.id)

  if (creditCheck.plan === 'free') {
    await recordSearchUsed(supabase, userId)
  }

  return { ok: true, searchRunId: searchRun.id, started: successfulStarts, failures }
}

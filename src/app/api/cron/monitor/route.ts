import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { startZillowScrape, startApartmentsComScrape } from '@/lib/apify'

// Called by Vercel Cron every 6 hours for Pro users
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Get all Pro users with active neighborhoods
  const { data: proUsers } = await supabase
    .from('profiles')
    .select('id')
    .eq('plan', 'pro')
    .eq('subscription_status', 'active')

  if (!proUsers || proUsers.length === 0) {
    return NextResponse.json({ message: 'No pro users' })
  }

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/apify/webhook?secret=${process.env.CRON_SECRET}`
  let started = 0

  for (const user of proUsers) {
    try {
      const { data: neighborhoods } = await supabase
        .from('monitored_neighborhoods')
        .select('*')
        .eq('user_id', user.id)
        .eq('active', true)

      if (!neighborhoods || neighborhoods.length === 0) continue

      const { data: preferences } = await supabase
        .from('preferences')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (!preferences) continue

      const { data: searchRun } = await supabase
        .from('search_runs')
        .insert({
          user_id: user.id,
          neighborhoods: neighborhoods.map(n => `${n.neighborhood}, ${n.city}, ${n.state}`),
          status: 'running',
          apify_runs_pending: 2,
          started_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (!searchRun) continue

      const [zillowRunId, apartmentsRunId] = await Promise.all([
        startZillowScrape(neighborhoods, webhookUrl, searchRun.id),
        startApartmentsComScrape(neighborhoods, webhookUrl, searchRun.id),
      ])

      await supabase
        .from('search_runs')
        .update({
          apify_run_ids: {
            zillow: zillowRunId,
            apartments_com: apartmentsRunId,
          },
        })
        .eq('id', searchRun.id)

      started++
    } catch (err) {
      console.error(`Error starting cron run for user ${user.id}:`, err)
    }
  }

  return NextResponse.json({ processed: proUsers.length, started })
}

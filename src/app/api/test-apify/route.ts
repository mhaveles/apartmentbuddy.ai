import { NextRequest, NextResponse } from 'next/server'
import { ApifyClient } from 'apify-client'

// Diagnostic endpoint — confirms Apify connectivity from Vercel
// Usage: GET /api/test-apify?secret=<CRON_SECRET>
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const client = new ApifyClient({ token: process.env.APIFY_API_TOKEN! })

  const run = await client.actor('maxcopell/zillow-scraper').start({
    startUrls: [{ url: 'https://www.zillow.com/homes/for_rent/New-York_rb/' }],
    maxItems: 3,
    type: 'rent',
  })

  return NextResponse.json({
    runId: run.id,
    apifyConsoleUrl: `https://console.apify.com/actors/runs/${run.id}`,
  })
}

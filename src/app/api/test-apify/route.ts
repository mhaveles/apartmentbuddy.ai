import { NextRequest, NextResponse } from 'next/server'

// Diagnostic endpoint — confirms Apify connectivity from Vercel
// Usage: GET /api/test-apify?secret=<CRON_SECRET>
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const token = process.env.APIFY_API_TOKEN
  const res = await fetch(`https://api.apify.com/v2/acts/maxcopell~zillow-scraper/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startUrls: [{ url: 'https://www.zillow.com/homes/for_rent/New-York_rb/' }],
      maxItems: 3,
      type: 'rent',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    return NextResponse.json({ error: `Apify error: ${res.status}`, detail: text }, { status: 500 })
  }

  const data = await res.json()
  const runId = data.data.id

  return NextResponse.json({
    runId,
    apifyConsoleUrl: `https://console.apify.com/actors/runs/${runId}`,
  })
}

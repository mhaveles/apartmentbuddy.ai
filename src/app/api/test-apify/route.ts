import { NextRequest, NextResponse } from 'next/server'

// Diagnostic endpoint — test Zillow and/or Craigslist actor starts independently
// Usage:
//   GET /api/test-apify?secret=X&actor=zillow
//   GET /api/test-apify?secret=X&actor=craigslist
//   GET /api/test-apify?secret=X&actor=all&zip=80218&city=denver

const APIFY_BASE = 'https://api.apify.com/v2'

async function startTestActor(actorId: string, input: unknown, token: string) {
  const res = await fetch(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const text = await res.text()
  if (!res.ok) {
    return { ok: false, status: res.status, error: text }
  }
  const data = JSON.parse(text)
  return {
    ok: true,
    runId: data.data.id as string,
    consoleUrl: `https://console.apify.com/actors/runs/${data.data.id}`,
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const actor = searchParams.get('actor') || 'all'
  const token = process.env.APIFY_API_TOKEN!
  const zip = searchParams.get('zip') || '80218'
  const city = searchParams.get('city') || 'denver'

  const zillowInput = {
    searchUrls: [{
      url: `https://www.zillow.com/${zip}_rb/?searchQueryState=${encodeURIComponent(JSON.stringify({
        pagination: {},
        isMapVisible: false,
        isListVisible: true,
        filterState: {
          fr:   { value: true  },
          fsba: { value: false },
          fsbo: { value: false },
          nc:   { value: false },
          cmsn: { value: false },
          auc:  { value: false },
          fore: { value: false },
        },
      }))}`,
    }],
    maxItems: 3,
    type: 'rent',
  }

  const craigslistInput = {
    city,
    category: 'apa',
    maxItems: 3,
  }

  const results: Record<string, unknown> = {}

  if (actor === 'zillow' || actor === 'all') {
    results.zillow = await startTestActor('maxcopell/zillow-scraper', zillowInput, token)
  }

  if (actor === 'craigslist' || actor === 'all') {
    results.craigslist = await startTestActor('automation-lab/craigslist-scraper', craigslistInput, token)
  }

  return NextResponse.json(results)
}

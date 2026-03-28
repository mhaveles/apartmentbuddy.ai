// Uses Apify REST API directly (no SDK) to avoid proxy-agent bundling issues on Vercel

const APIFY_BASE = 'https://api.apify.com/v2'

function token() {
  return process.env.APIFY_API_TOKEN!
}

export interface ScrapedListing {
  externalId: string
  source: string
  url: string
  title: string
  address: string
  city: string
  state: string
  neighborhood: string | null
  zipCode: string | null
  rent: number // monthly in cents
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  availableDate: string | null
  amenities: string[]
  description: string | null
  images: string[]
}

type Neighborhood = Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null }>

function buildWebhooks(webhookUrl: string, searchRunId: string, source: string) {
  return [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
    requestUrl: webhookUrl,
    payloadTemplate: JSON.stringify({
      searchRunId,
      source,
      eventType: '{{eventType}}',
      defaultDatasetId: '{{resource.defaultDatasetId}}',
      actorRunId: '{{resource.id}}',
    }),
  }]
}

async function startActor(actorId: string, input: unknown, webhooks: unknown[]): Promise<string> {
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${token()}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input as object, webhooks }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Apify start failed for ${actorId}: ${res.status} ${text}`)
  }
  const data = await res.json()
  return data.data.id as string
}

export async function startZillowScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  // actor: maxcopell/zillow-scraper — searchUrls is required
  // Use clean /rentals/ URL format (searchQueryState format returns 0 results)
  const searchUrls = neighborhoods.map(n => {
    if (n.zip_code) {
      return { url: `https://www.zillow.com/homes/for_rent/${n.zip_code}_rb/` }
    }
    const citySlug = `${n.city.toLowerCase().replace(/\s+/g, '-')}-${n.state.toLowerCase()}`
    return { url: `https://www.zillow.com/${citySlug}/rentals/` }
  })
  return startActor('maxcopell/zillow-scraper', {
    searchUrls,
    maxItems: 50,
  }, buildWebhooks(webhookUrl, searchRunId, 'zillow'))
}

export async function startApartmentsComScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  const searchUrls = neighborhoods.map(n => {
    const location = n.zip_code || `${n.neighborhood.toLowerCase().replace(/\s+/g, '-')}-${n.city.toLowerCase()}-${n.state.toLowerCase()}`
    return `https://www.apartments.com/${location}/`
  })
  return startActor('parseforge/apartments-com-scraper', {
    startUrls: searchUrls.map(url => ({ url })),
    maxItems: 50,
  }, buildWebhooks(webhookUrl, searchRunId, 'apartments_com'))
}

export async function startCraigslistScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  // actor: automation-lab/craigslist-scraper
  // Requires startUrls (array of {url} objects) — not searchQueries
  // /search/apa is the apartments category; no need for &section=apa
  const startUrls = neighborhoods.map(n => {
    const citySlug = n.city.toLowerCase().replace(/\s+/g, '')
    const query = encodeURIComponent(n.zip_code || `${n.neighborhood} ${n.city}`)
    return { url: `https://${citySlug}.craigslist.org/search/apa?query=${query}` }
  })
  return startActor('automation-lab/craigslist-scraper', {
    startUrls,
    maxItems: 50,
  }, buildWebhooks(webhookUrl, searchRunId, 'craigslist'))
}

export async function startTruliaScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  const searchUrls = neighborhoods.map(n => {
    const location = n.zip_code || `${n.neighborhood.toLowerCase().replace(/\s+/g, '-')}-${n.city.toLowerCase()}-${n.state.toLowerCase()}`
    return `https://www.trulia.com/for_rent/${location}/`
  })
  return startActor('epctex/trulia-scraper', {
    startUrls: searchUrls.map(url => ({ url })),
    maxItems: 50,
  }, buildWebhooks(webhookUrl, searchRunId, 'trulia'))
}

export async function fetchScrapedListings(
  datasetId: string,
  source: string
): Promise<ScrapedListing[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token()}&clean=true`)
  if (!res.ok) throw new Error(`Failed to fetch dataset ${datasetId}: ${res.status}`)
  const items: Record<string, unknown>[] = await res.json()

  if (source === 'zillow') {
    return items.map(item => ({
      externalId: String(item.zpid || item.id || Math.random()),
      source: 'zillow',
      url: String(item.detailUrl || item.url || ''),
      title: String(item.statusText || `${item.bedrooms}bd ${item.bathrooms}ba`),
      address: String(item.streetAddress || item.address || ''),
      city: String(item.city || ''),
      state: String(item.state || ''),
      neighborhood: item.neighborhood ? String(item.neighborhood) : null,
      zipCode: item.zipcode ? String(item.zipcode) : null,
      rent: Math.round((Number(item.price) || 0) * 100),
      bedrooms: item.bedrooms ? Number(item.bedrooms) : null,
      bathrooms: item.bathrooms ? Number(item.bathrooms) : null,
      sqft: item.livingArea ? Number(item.livingArea) : null,
      availableDate: null,
      amenities: [],
      description: item.description ? String(item.description) : null,
      images: Array.isArray(item.photos) ? item.photos.map(String) : [],
    }))
  }

  if (source === 'apartments_com') {
    return items.map(item => ({
      externalId: String(item.id || item.propertyId || Math.random()),
      source: 'apartments_com',
      url: String(item.url || item.detailUrl || ''),
      title: String(item.name || item.title || ''),
      address: String(item.address || ''),
      city: String(item.city || ''),
      state: String(item.state || ''),
      neighborhood: null,
      zipCode: item.zipCode ? String(item.zipCode) : null,
      rent: Math.round((Number(item.minRent || item.rent) || 0) * 100),
      bedrooms: item.beds ? Number(item.beds) : null,
      bathrooms: item.baths ? Number(item.baths) : null,
      sqft: item.sqft ? Number(item.sqft) : null,
      availableDate: item.availableDate ? String(item.availableDate) : null,
      amenities: Array.isArray(item.amenities) ? item.amenities.map(String) : [],
      description: item.description ? String(item.description) : null,
      images: Array.isArray(item.photos) ? item.photos.map(String) : [],
    }))
  }

  if (source === 'craigslist') {
    return items.map(item => ({
      externalId: String(item.id || item.postId || Math.random()),
      source: 'craigslist',
      url: String(item.url || ''),
      title: String(item.title || ''),
      address: String(item.location || item.address || ''),
      city: String(item.city || ''),
      state: String(item.state || ''),
      neighborhood: item.neighborhood ? String(item.neighborhood) : null,
      zipCode: item.zipCode ? String(item.zipCode) : null,
      rent: Math.round((Number(item.price) || 0) * 100),
      bedrooms: item.bedrooms ? Number(item.bedrooms) : null,
      bathrooms: item.bathrooms ? Number(item.bathrooms) : null,
      sqft: item.sqft ? Number(item.sqft) : null,
      availableDate: item.availableDate ? String(item.availableDate) : null,
      amenities: [],
      description: item.description ? String(item.description) : null,
      images: Array.isArray(item.images) ? item.images.map(String) : [],
    }))
  }

  if (source === 'trulia') {
    return items.map(item => ({
      externalId: String(item.id || item.propertyId || Math.random()),
      source: 'trulia',
      url: String(item.url || ''),
      title: String(item.title || item.name || ''),
      address: String(item.address || item.streetAddress || ''),
      city: String(item.city || ''),
      state: String(item.state || ''),
      neighborhood: item.neighborhood ? String(item.neighborhood) : null,
      zipCode: item.zipCode ? String(item.zipCode) : null,
      rent: Math.round((Number(item.price) || 0) * 100),
      bedrooms: item.bedrooms ? Number(item.bedrooms) : null,
      bathrooms: item.bathrooms ? Number(item.bathrooms) : null,
      sqft: item.sqft ? Number(item.sqft) : null,
      availableDate: item.availableDate ? String(item.availableDate) : null,
      amenities: Array.isArray(item.amenities) ? item.amenities.map(String) : [],
      description: item.description ? String(item.description) : null,
      images: Array.isArray(item.photos) ? item.photos.map(String) : [],
    }))
  }

  return []
}

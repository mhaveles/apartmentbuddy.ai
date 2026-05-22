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

type MapBounds = { north: number; south: number; east: number; west: number }
type Neighborhood = Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null; map_bounds?: MapBounds | null }>

export async function geocodeZip(zip: string): Promise<MapBounds | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?postalcode=${encodeURIComponent(zip)}&countrycodes=us&format=json&limit=1`,
      { headers: { 'User-Agent': 'ApartmentBuddy/1.0 (contact@apartmentbuddy.ai)' } }
    )
    if (!res.ok) return null
    const data: Array<{ boundingbox?: string[] }> = await res.json()
    if (!data[0]?.boundingbox) return null
    // boundingbox is [south, north, west, east]
    const [south, north, west, east] = data[0].boundingbox.map(Number)
    return { north, south, east, west }
  } catch {
    return null
  }
}

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
  // Apify requires webhooks as a base64-encoded query param, NOT in the request body.
  // Putting them in the body passes them as actor input and Apify ignores them entirely.
  const webhooksParam = Buffer.from(JSON.stringify(webhooks)).toString('base64')
  const url = `${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs?token=${token()}&webhooks=${webhooksParam}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
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
  searchRunId: string,
  preferences?: { max_rent?: number | null; min_bedrooms?: number | null; min_bathrooms?: number | null }
): Promise<string> {
  // actor: maxcopell/zillow-scraper — requires searchUrls with ?searchQueryState= in the URL
  // The geographic identifier MUST be in the URL path (e.g. /80218_rb/ or /denver-co/rentals/)
  // so Zillow scopes the search to that area. Without it, 0 results.
  // Use short-form filter keys (fr, fsba, beds, baths, mp) — the actor parses Zillow's public URL format.
  // mp = monthly payment (dollars), max_rent stored in cents so divide by 100.
  // Geocode any neighborhoods that don't have stored bounds yet
  const boundsMap = await Promise.all(
    neighborhoods.map(async n => n.map_bounds ?? (n.zip_code ? await geocodeZip(n.zip_code) : null))
  )

  const searchUrls = neighborhoods.map((n, i) => {
    const filterState: Record<string, unknown> = {
      fr:   { value: true  },
      fsba: { value: false },
      fsbo: { value: false },
      nc:   { value: false },
      cmsn: { value: false },
      auc:  { value: false },
      fore: { value: false },
    }
    if (preferences?.min_bedrooms) filterState.beds = { min: preferences.min_bedrooms }
    if (preferences?.min_bathrooms) filterState.baths = { min: preferences.min_bathrooms }
    if (preferences?.max_rent) filterState.mp = { max: Math.round(preferences.max_rent / 100) }

    const bounds = boundsMap[i]
    const searchQueryStateObj: Record<string, unknown> = {
      isMapVisible: true,
      isListVisible: true,
      filterState,
    }
    if (bounds) {
      searchQueryStateObj.mapBounds = bounds
    }

    return { url: `https://www.zillow.com/homes/for_rent/?searchQueryState=${encodeURIComponent(JSON.stringify(searchQueryStateObj))}` }
  })
  return startActor('maxcopell/zillow-scraper', {
    searchUrls,
    maxItems: 50,
    type: 'rent',
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

function buildCraigslistUrl(
  n: { city: string; state: string; neighborhood: string; zip_code?: string | null; map_bounds?: MapBounds | null },
  preferences?: { max_rent?: number | null; min_bedrooms?: number | null; max_bedrooms?: number | null; pet_friendly?: boolean | null }
): string {
  // Build a full Craigslist search URL using their native filter parameters.
  // This mirrors exactly what a user would do manually — geographic radius, bedroom range, pets, price.
  const cityDomain = n.city.toLowerCase().replace(/\s+/g, '')
  const base = `https://${cityDomain}.craigslist.org/search/apa`

  const params = new URLSearchParams()

  // Geographic targeting: prefer zip code + radius, fall back to lat/lon from map_bounds
  if (n.zip_code) {
    params.set('postal', n.zip_code)
    params.set('search_distance', '3')  // 3 mile radius — tight neighborhood scope
  } else if (n.map_bounds) {
    params.set('lat', ((n.map_bounds.north + n.map_bounds.south) / 2).toFixed(4))
    params.set('lon', ((n.map_bounds.east + n.map_bounds.west) / 2).toFixed(4))
    params.set('search_distance', '3')
  }

  // Bedroom range from preferences
  if (preferences?.min_bedrooms != null) {
    params.set('min_bedrooms', String(preferences.min_bedrooms))
  }
  if (preferences?.max_bedrooms != null) {
    params.set('max_bedrooms', String(preferences.max_bedrooms))
  } else if (preferences?.min_bedrooms != null) {
    params.set('max_bedrooms', String(preferences.min_bedrooms + 1))  // default: min and one size up
  }

  // Price ceiling (max_rent stored in cents → convert to dollars)
  if (preferences?.max_rent) {
    params.set('max_price', String(Math.round(preferences.max_rent / 100)))
  }

  // Pet policy
  if (preferences?.pet_friendly) {
    params.set('pets_dog', '1')
    params.set('pets_cat', '1')
  }

  params.set('sort', 'date')
  return `${base}?${params.toString()}`
}

export async function startCraigslistScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string,
  preferences?: { max_rent?: number | null; min_bedrooms?: number | null; max_bedrooms?: number | null; pet_friendly?: boolean | null }
): Promise<string> {
  const first = neighborhoods[0]
  // Use the neighborhood name as the search query for geographic relevance.
  // Also pass price/bedroom params — the actor claims to support price filtering;
  // if supported these pre-filter results before they reach us.
  return startActor('automation-lab/craigslist-scraper', {
    category: 'housing',
    city: first.city,
    includeDetails: true,
    maxResults: 100,
    searchQueries: [first.neighborhood || 'apartment'],
    ...(preferences?.max_rent     && { maxPrice:    Math.round(preferences.max_rent / 100) }),
    ...(preferences?.min_bedrooms && { minBedrooms: preferences.min_bedrooms }),
    ...(preferences?.max_bedrooms && { maxBedrooms: preferences.max_bedrooms }),
    ...(preferences?.pet_friendly && { pets: true }),
  }, buildWebhooks(webhookUrl, searchRunId, 'craigslist'))
}

export async function startTruliaScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  const first = neighborhoods[0]
  const state = first.state.toUpperCase()
  const city = first.city.replace(/\s+/g, '_')   // "New York" → "New_York"
  const searchLocation = `${city},${state}`        // "Denver,CO"
  return startActor('memo23/trulia-scraper', {
    startUrls: [`https://www.trulia.com/for_rent/${searchLocation}/`],
    searchListingType: 'FOR_RENT',
    searchLocation,
    searchSort: 'RECOMMENDED',
    maxItems: 50,
    proxy: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
  }, buildWebhooks(webhookUrl, searchRunId, 'trulia'))
}

export async function fetchScrapedListingsByRunId(
  runId: string,
  source: string
): Promise<ScrapedListing[]> {
  const res = await fetch(`${APIFY_BASE}/actor-runs/${runId}/dataset/items?token=${token()}&clean=true`)
  if (!res.ok) throw new Error(`Failed to fetch dataset for run ${runId}: ${res.status}`)
  const items: Record<string, unknown>[] = await res.json()
  return mapListings(items, source)
}

// Apartments are typically 100–4000 sqft. Values outside this range are almost always
// misreported lot size, building size, or data mapping errors from the scraper.
function sanitizeSqft(val: number | null | undefined): number | null {
  if (val == null || isNaN(Number(val))) return null
  const n = Number(val)
  if (n < 100 || n > 4000) return null
  return n
}

function mapListings(items: Record<string, unknown>[], source: string): ScrapedListing[] {
  if (source === 'zillow') {
    return items.flatMap(item => {
      const zpid = item.zpid || item.id
      if (!zpid) return [] // drop listings with no stable ID — Math.random() causes DB duplicates
      return [{
        externalId: String(zpid),
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
        sqft: sanitizeSqft(item.livingArea as number | null),
        availableDate: null,
        amenities: [],
        description: item.description ? String(item.description) : null,
        images: Array.isArray(item.photos) ? item.photos.map(String) : [],
      }]
    })
  }

  if (source === 'apartments_com') {
    return items.flatMap(item => {
      const propertyId = item.id || item.propertyId
      if (!propertyId) return []
      return [{
        externalId: String(propertyId),
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
        sqft: sanitizeSqft(item.sqft as number | null),
        availableDate: item.availableDate ? String(item.availableDate) : null,
        amenities: Array.isArray(item.amenities) ? item.amenities.map(String) : [],
        description: item.description ? String(item.description) : null,
        images: Array.isArray(item.photos) ? item.photos.map(String) : [],
      }]
    })
  }

  if (source === 'craigslist') {
    return items.map(item => {
      // bedrooms/bathrooms come as "1BR / 1Ba" — parseInt handles the leading digit correctly
      const bedroomStr = String(item.bedrooms || '')
      const bedrooms = bedroomStr ? parseInt(bedroomStr) : null  // "1BR / 1Ba" → 1, "0BR" → 0
      const bathMatch = bedroomStr.match(/(\d+)\s*[Bb]a/)
      const bathrooms = bathMatch ? parseInt(bathMatch[1]) : null  // "1BR / 1Ba" → 1

      // sqft comes as "550ft2" — strip non-numeric chars
      const sqftStr = String(item.sqft || '')
      const sqft = sqftStr ? (parseInt(sqftStr.replace(/[^0-9]/g, '')) || null) : null

      // price comes as "$1,120" — strip non-numeric chars before parsing
      const rent = Math.round((parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0) * 100)

      // city/state not returned by actor — use what's in the title/location context
      // address: prefer structured address, fall back to location string
      const address = String(item.address || item.location || '')

      const postId = item.id || item.postId
      if (!postId) return null
      return {
        externalId: String(postId),
        source: 'craigslist',
        url: String(item.url || ''),
        title: String(item.title || ''),
        address,
        city: String(item.city || ''),
        state: String(item.state || ''),
        neighborhood: item.location ? String(item.location).split(',')[0].trim() : null,
        zipCode: item.zipCode ? String(item.zipCode) : null,
        rent,
        bedrooms,
        bathrooms,
        sqft: sanitizeSqft(sqft),
        availableDate: item.postedAt ? String(item.postedAt).split('T')[0] : null,
        amenities: [],
        description: item.description ? String(item.description) : null,
        images: Array.isArray(item.images) ? item.images.map(String) : [],
      }
    }).filter((l): l is ScrapedListing => l !== null)
  }

  if (source === 'trulia') {
    // Log first raw item so we can verify/fix field mapping after first test run
    if (items.length > 0) console.log('TRULIA RAW ITEM:', JSON.stringify(items[0], null, 2))
    return items.flatMap(item => {
      const listingId = item.id || item.listingId || item.trulia_id
      if (!listingId) return []
      const rawSqft = item.sqft != null ? Number(item.sqft) : item.floorSpace != null ? Number(item.floorSpace) : null
      return [{
        externalId: String(listingId),
        source: 'trulia',
        url: String(item.url || item.listingUrl || item.detailUrl || ''),
        title: String(item.title || item.name || ''),
        address: String(item.address || item.streetAddress || item.fullAddress || ''),
        city: String(item.city || ''),
        state: String(item.state || ''),
        neighborhood: item.neighborhood ? String(item.neighborhood) : null,
        zipCode: item.zipCode ? String(item.zipCode) : null,
        rent: Math.round((Number(item.price || item.listPrice || item.rentPrice) || 0) * 100),
        bedrooms: item.bedrooms != null ? Number(item.bedrooms) : item.beds != null ? Number(item.beds) : null,
        bathrooms: item.bathrooms != null ? Number(item.bathrooms) : item.baths != null ? Number(item.baths) : null,
        sqft: sanitizeSqft(rawSqft),
        availableDate: item.availableDate ? String(item.availableDate) : null,
        amenities: Array.isArray(item.amenities) ? item.amenities.map(String) : [],
        description: item.description ? String(item.description) : null,
        images: Array.isArray(item.photos) ? item.photos.map(String)
              : Array.isArray(item.images) ? item.images.map(String) : [],
      }]
    })
  }

  return []
}

export async function fetchScrapedListings(
  datasetId: string,
  source: string
): Promise<ScrapedListing[]> {
  const res = await fetch(`${APIFY_BASE}/datasets/${datasetId}/items?token=${token()}&clean=true`)
  if (!res.ok) throw new Error(`Failed to fetch dataset ${datasetId}: ${res.status}`)
  const items: Record<string, unknown>[] = await res.json()
  return mapListings(items, source)
}

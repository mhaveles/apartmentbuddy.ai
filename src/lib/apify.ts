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
  preferences?: {
    max_rent?: number | null
    min_bedrooms?: number | null
    min_bathrooms?: number | null
    air_conditioning?: boolean | null
    in_unit_laundry?: boolean | null
    parking_required?: boolean | null
    pet_friendly?: boolean | null
    gym?: boolean | null
  }
): Promise<string> {
  // actor: igolaizola/zillow-scraper-ppe — takes a plain location string + boolean amenity flags.
  // Use the most specific location we have: zip > "Neighborhood, City, ST" > "City, ST".
  const first = neighborhoods[0]
  const location = first.zip_code
    ? first.zip_code
    : first.neighborhood
      ? `${first.neighborhood}, ${first.city}, ${first.state.toUpperCase()}`
      : `${first.city}, ${first.state.toUpperCase()}`

  return startActor('igolaizola/zillow-scraper-ppe', {
    location,
    fetchDetails: true,
    flattenOutput: true,
    maxItems: 50,
    // Boolean amenity flags from user preferences
    ...(preferences?.air_conditioning  && { airConditioning: true }),
    ...(preferences?.in_unit_laundry   && { inUnitLaundry: true }),
    ...(preferences?.parking_required  && { garage: true, onSiteParking: true }),
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
  searchRunId: string,
  preferences?: { max_rent?: number | null; min_bedrooms?: number | null; max_bedrooms?: number | null; min_bathrooms?: number | null; pet_friendly?: boolean | null; in_unit_laundry?: boolean | null; air_conditioning?: boolean | null; gym?: boolean | null; parking_required?: boolean | null }
): Promise<string> {
  const first = neighborhoods[0]
  // Prefer zip code for precise targeting; fall back to neighborhood then city
  const location = first.zip_code
    ? first.zip_code
    : first.neighborhood
      ? `${first.neighborhood}, ${first.city}, ${first.state.toUpperCase()}`
      : `${first.city}, ${first.state.toUpperCase()}`

  const pets: string[] = preferences?.pet_friendly ? ['cats', 'large_dogs'] : []
  const unitAmenities: string[] = preferences?.in_unit_laundry ? ['washerdryer'] : []
  const buildingAmenities: string[] = [
    ...(preferences?.gym ? ['gym'] : []),
    ...(preferences?.parking_required ? ['garage'] : []),
  ]

  return startActor('igolaizola/trulia-scraper', {
    location,
    operation: 'rent',
    sortBy: 'best',
    space: 'entire_space',
    maxItems: 50,
    includeOffMarket: false,
    proxyConfiguration: {
      useApifyProxy: true,
      apifyProxyGroups: ['RESIDENTIAL'],
    },
    ...(preferences?.air_conditioning        && { airConditioning: true }),
    ...(preferences?.max_rent                && { maxPrice: Math.round(preferences.max_rent / 100) }),
    ...(preferences?.min_bedrooms  != null   && { minBeds:  preferences.min_bedrooms }),
    ...(preferences?.max_bedrooms  != null   && { maxBeds:  preferences.max_bedrooms }),
    ...(preferences?.min_bathrooms != null   && { minBaths: preferences.min_bathrooms }),
    ...(pets.length > 0                      && { pets }),
    ...(unitAmenities.length > 0             && { unitAmenities }),
    ...(buildingAmenities.length > 0         && { buildingAmenities }),
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
    // igolaizola/zillow-scraper-ppe with flattenOutput:true returns dot-notation keys.
    // Log the first raw item so we can verify field names after the first real run.
    if (items.length > 0) console.log('ZILLOW PPE RAW ITEM:', JSON.stringify(items[0], null, 2))

    return items.flatMap(item => {
      // zpid is the stable Zillow property ID — prefer it; fall back to id
      const zpid = item.zpid || item['hdpData.homeInfo.zpid'] || item.id
      if (!zpid) return []

      // flattenOutput:true uses dot-notation keys for nested objects
      const streetAddress = item['address.streetAddress'] || item.streetAddress || item.address || ''
      const city          = item['address.city']          || item.city          || ''
      const state         = item['address.state']         || item.state         || ''
      const zipCode       = item['address.zipcode']       || item.zipcode       || item.zipCode || null
      const price         = Number(item['hdpData.homeInfo.price'] || item.price || 0)
      const beds          = item.bedrooms  ?? item['hdpData.homeInfo.bedrooms']  ?? null
      const baths         = item.bathrooms ?? item['hdpData.homeInfo.bathrooms'] ?? null
      const sqftRaw       = item.livingArea ?? item['hdpData.homeInfo.livingArea'] ?? null
      const detailUrl     = String(item.detailUrl || item.url || '')
      const desc          = item.description ? String(item.description) : null
      const imgs: string[] = Array.isArray(item.photos)
        ? item.photos.map(String)
        : Array.isArray(item['miniCardPhotos'])
          ? (item['miniCardPhotos'] as Array<{ url?: string }>).map(p => p?.url ?? '').filter(Boolean)
          : []

      const bedsLabel  = beds  != null ? `${beds}bd`  : ''
      const bathsLabel = baths != null ? `${baths}ba` : ''
      const title = String([bedsLabel, bathsLabel].filter(Boolean).join(' ') || streetAddress)

      return [{
        externalId: String(zpid),
        source: 'zillow',
        url: detailUrl,
        title,
        address: String(streetAddress),
        city: String(city),
        state: String(state),
        neighborhood: item.neighborhood ? String(item.neighborhood) : null,
        zipCode: zipCode ? String(zipCode) : null,
        rent: Math.round(price * 100),
        bedrooms:  beds  != null ? Number(beds)  : null,
        bathrooms: baths != null ? Number(baths) : null,
        sqft: sanitizeSqft(sqftRaw as number | null),
        availableDate: null,
        amenities: [],
        description: desc,
        images: imgs,
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
        amenities: [] as string[],
        description: item.description ? String(item.description) : null,
        images: Array.isArray(item.images) ? item.images.map(String) : [],
      }
    }).filter((l): l is ScrapedListing => l !== null)
  }

  if (source === 'trulia') {
    return items.flatMap((item, idx) => {
      // Only drop listings explicitly marked inactive — missing field means assume active
      if (item['currentStatus.isActiveForRent'] === false) return []

      type TrackingEntry = { key: string; value: string }
      const tracking = Array.isArray(item.tracking) ? (item.tracking as TrackingEntry[]) : []
      const trackingMap = Object.fromEntries(tracking.map(e => [e.key, e.value]))

      // Log first raw item to verify field mapping in Vercel logs
      if (idx === 0) console.log('TRULIA RAW ITEM:', JSON.stringify(item, null, 2))

      // externalId: tracking zPID → typedHomeId suffix → direct zpid/id field
      const externalId = trackingMap.zPID
        || String(item['metadata.typedHomeId'] || '').replace('_ZPID', '')
        || String(item.zpid || item.id || '')
      if (!externalId) return []

      // price: tracking listingPrice → direct price/rent fields
      const rawPrice = trackingMap.listingPrice
        || String(item.price || item.rent || item.listingPrice || '0')
      const rent = Math.round((parseFloat(rawPrice) || 0) * 100)

      // bedrooms/bathrooms/sqft: flat dotted keys → direct fields
      const bedrooms = parseInt(String(item['bedrooms.formattedValue'] || item.bedrooms || '')) || null
      const bathrooms = parseFloat(String(item['bathrooms.formattedValue'] || item.bathrooms || '')) || null
      const sqftRaw = parseInt(String(item['floorSpace.formattedDimension'] || item.sqft || '').replace(/[^0-9]/g, '')) || null

      type Tag = { formattedName: string }
      const tagNames = Array.isArray(item.largeTags) ? (item.largeTags as Tag[]).map(t => t.formattedName) : []
      const amenities: string[] = tagNames.some(t => t.includes('PET FRIENDLY')) ? ['pet_friendly'] : []

      return [{
        externalId,
        source: 'trulia',
        url: String(item.url || ''),
        title: String(item['location.formattedLocation'] || item.title || item.address || ''),
        address: String(item['location.streetAddress'] || item.address || ''),
        city: String(item['location.city'] || item.city || ''),
        state: String(item['location.stateCode'] || item.state || ''),
        neighborhood: null,
        zipCode: item['location.zipCode'] ? String(item['location.zipCode']) : (item.zipCode ? String(item.zipCode) : null),
        rent,
        bedrooms,
        bathrooms,
        sqft: sanitizeSqft(sqftRaw),
        availableDate: item['activeListing.dateListed'] ? String(item['activeListing.dateListed']).split('T')[0] : null,
        amenities,
        description: item.description ? String(item.description) : null,
        images: Array.isArray(item.images) ? item.images.map(String) : [],
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

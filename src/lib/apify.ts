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
  lat?: number | null
  lon?: number | null
}

type MapBounds = { north: number; south: number; east: number; west: number }
type Neighborhood = Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null; map_bounds?: MapBounds | null }>

export async function geocodeAddress(address: string, city: string, state: string): Promise<string | null> {
  try {
    // Strip unit/apt numbers — "#7", "#2-213", "Apt 4B" — they confuse Nominatim
    const street = address.replace(/#\S+/g, '').replace(/\b(apt|unit|suite|ste|#)\s*\S+/gi, '').trim()
    const q = encodeURIComponent(`${street}, ${city}, ${state}, USA`)
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&addressdetails=1`,
      { headers: { 'User-Agent': 'ApartmentBuddy/1.0 (contact@apartmentbuddy.ai)' } }
    )
    if (!res.ok) return null
    const data: Array<{ address?: Record<string, string> }> = await res.json()
    const addr = data[0]?.address
    if (!addr) return null
    return addr.suburb || addr.neighbourhood || addr.quarter || addr.city_district || null
  } catch {
    return null
  }
}

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Trulia's actor start / dataset fetch has been observed to fail transiently upstream
// (e.g. "service: graphql error: Internal Server Error" from Trulia's own backend).
// Retry with backoff rather than silently dropping the source for the whole search run.
async function withRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const delay = 500 * 2 ** (attempt - 1)
        console.warn(`[TRULIA] ${label} attempt ${attempt}/${maxAttempts} failed: ${(err as Error).message}. Retrying in ${delay}ms`)
        await sleep(delay)
      }
    }
  }
  throw lastErr
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
  // igolaizola/zillow-scraper-ppe uses `operation` + `location` (not startUrls).
  // Default operation is "buy"; must set "rent" explicitly or it returns for-sale listings.
  const first = neighborhoods[0]
  const location = first.zip_code
    ? first.zip_code
    : `${first.city}, ${first.state.toUpperCase()}`

  return startActor('igolaizola/zillow-scraper-ppe', {
    operation: 'rent',
    location,
    fetchDetails: true,
    flattenOutput: true,
    maxItems: 50,
    ...(preferences?.min_bedrooms  != null && { minBeds:  preferences.min_bedrooms }),
    ...(preferences?.min_bathrooms != null && { minBaths: Math.floor(preferences.min_bathrooms) }),
    ...(preferences?.max_rent           && { maxPrice: Math.round(preferences.max_rent / 100) }),
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

// Craigslist subdomains that don't match a naive lowercase-and-strip-spaces of the city name.
// Not exhaustive — the actor's city enum has hundreds of entries we can't validate offline.
// Anything not in this map falls through to naive normalization; if that guess is wrong, Apify's
// own input validation rejects the run at start time, which surfaces via the existing
// Promise.allSettled failure path in search-trigger.ts rather than failing silently.
const CRAIGSLIST_CITY_OVERRIDES: Record<string, string> = {
  'san francisco': 'sfbay',
  'oakland': 'sfbay',
  'san jose': 'sfbay',
  'washington': 'washingtondc',
  'washington dc': 'washingtondc',
}

function resolveCraigslistCity(city: string): string | null {
  const key = city.trim().toLowerCase()
  if (!key) return null
  return CRAIGSLIST_CITY_OVERRIDES[key] || key.replace(/\s+/g, '')
}

export async function startCraigslistScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string,
  preferences?: { max_rent?: number | null }
): Promise<string | null> {
  // automation-lab/craigslist-scraper is searchQueries/city/category driven, not startUrls-driven
  // (startUrls is not a supported input on this actor — see docs/chunk-1-scraper-diagnosis.md).
  // No native bedroom filter exists on this actor, so bedroom targeting is intentionally left
  // out here and handled at scoring time instead.
  const first = neighborhoods[0]
  const city = resolveCraigslistCity(first.city)
  if (!city) {
    console.warn(`[CRAIGSLIST] could not resolve a Craigslist subdomain for city "${first.city}" — skipping`)
    return null
  }

  return startActor('automation-lab/craigslist-scraper', {
    // Empty array, not a keyword like "apartment" — live-tested (chunk 2) against a Denver
    // "housing" search: 9/10 real apartment listings didn't contain the literal word "apartment"
    // in their title, so a keyword filter here would have silently dropped most legitimate
    // results. Schema marks this "required" but the actor accepts [] fine (confirmed live) and
    // uses it to mean "no keyword filter, browse the whole category."
    searchQueries: [],
    city,
    category: 'housing',
    maxResults: 100,
    includeDetails: true,
    // Confirmed live (chunk 2): maxPrice is dollars, not cents — same convention as Zillow/Trulia.
    ...(preferences?.max_rent && { maxPrice: Math.round(preferences.max_rent / 100) }),
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

  return withRetry('startActor', () => startActor('igolaizola/trulia-scraper', {
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
  }, buildWebhooks(webhookUrl, searchRunId, 'trulia')))
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

// Trulia-only: retries the dataset fetch with backoff. A transient Apify API error here
// previously meant the source's apify_runs_pending counter still decremented (webhook
// decrements first) while the listings themselves were never fetched or saved.
export async function fetchTruliaListingsByRunId(runId: string): Promise<ScrapedListing[]> {
  return withRetry('dataset fetch', () => fetchScrapedListingsByRunId(runId, 'trulia'))
}

// Apartments are typically 100–4000 sqft. Values outside this range are almost always
// misreported lot size, building size, or data mapping errors from the scraper.
function sanitizeSqft(val: number | null | undefined): number | null {
  if (val == null || isNaN(Number(val))) return null
  const n = Number(val)
  if (n < 100 || n > 4000) return null
  return n
}

function asRecord(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : null
}

// Confirmed live (chunk 2, Denver test): top-level `latitude`/`longitude`, populated on
// 20/20 sampled listings with includeDetails:true. Nested fallbacks kept defensively in case
// coverage varies by city/listing. Note `item.location` on this actor is a plain string
// (neighborhood name), so asRecord() on it correctly falls through to null instead of
// misreading string characters as an object.
function extractLatLon(item: Record<string, unknown>): { lat: number | null; lon: number | null } {
  const nested = [asRecord(item.location), asRecord(item.coordinates), asRecord(item.geo)]
  const firstDefined = (...vals: unknown[]) => vals.find(v => v != null && v !== '')

  const rawLat = firstDefined(
    item.latitude, item.lat,
    ...nested.map(o => o?.latitude), ...nested.map(o => o?.lat)
  )
  const rawLon = firstDefined(
    item.longitude, item.lon, item.lng,
    ...nested.map(o => o?.longitude), ...nested.map(o => o?.lon), ...nested.map(o => o?.lng)
  )

  const lat = rawLat != null && !isNaN(Number(rawLat)) ? Number(rawLat) : null
  const lon = rawLon != null && !isNaN(Number(rawLon)) ? Number(rawLon) : null
  return { lat, lon }
}

function logRawSample(source: string, item: Record<string, unknown>): void {
  console.log(`[${source.toUpperCase()}] RAW ITEM:`, JSON.stringify(item, null, 2))
}

function isScoreable(listing: ScrapedListing): boolean {
  const issues: string[] = []
  if (!listing.externalId)                issues.push('missing externalId')
  if (!listing.url)                       issues.push('missing url')
  if (listing.rent === 0)                 issues.push('rent is 0')
  if (!listing.city && !listing.address)  issues.push('no location')
  if (issues.length) {
    console.warn(`[${listing.source}] dropping unscorable listing: ${issues.join(', ')}`)
    return false
  }
  return true
}

function validateZillowItem(item: Record<string, unknown>): ScrapedListing | null {
  // igolaizola/zillow-scraper-ppe with flattenOutput:true returns dot-notation keys
  const zpid = item.zpid || item['hdpData.homeInfo.zpid'] || item.id
  if (!zpid) return null

  const streetAddress = item['address.streetAddress'] || item.streetAddress || item.address || ''
  const city          = item['address.city']          || item.city          || ''
  const state         = item['address.state']         || item.state         || ''
  const zipCode       = item['address.zipcode']       || item.zipcode       || item.zipCode || null

  // The actor populates rent across several fields depending on listing type; check in priority order.
  let priceRaw = 0
  let priceField = 'none'
  for (const field of ['rental.baseRent', '_details.price', 'price.value', 'hdpView.price'] as const) {
    const val = Number(item[field] || 0)
    if (val > 0) { priceRaw = val; priceField = field; break }
  }
  console.log(`[ZILLOW] zpid=${zpid} rent=${priceRaw} (field: ${priceField})`)

  // Drop for-sale listings: monthly rents in Denver are under $10k; values above that are sale prices.
  // The actor may return mixed listing types regardless of homeStatus filter.
  if (priceRaw > 10000) {
    console.log(`[ZILLOW] dropping likely sale listing zpid=${zpid} price=${priceRaw}`)
    return null
  }
  const price         = priceRaw
  const beds          = item.bedrooms   ?? null
  const baths         = item.bathrooms  ?? null
  const sqftRaw       = item.livingArea ?? null
  const detailUrl     = String(item.url || item.hdpUrl || '')
  const desc          = item['_details.description'] ? String(item['_details.description']) : null
  const rawPhotos     = item['media.allPropertyPhotos.highResolution']
  const imgs: string[] = Array.isArray(rawPhotos) ? rawPhotos.map(String) : []

  // Extract amenities from resoFacts (requires fetchDetails:true).
  // Log the full object on first appearance — exact subfield names vary; confirmed names get added here.
  const resoFacts = item['_details.resoFacts'] as Record<string, unknown> | undefined
  if (resoFacts) console.log('[ZILLOW] resoFacts:', JSON.stringify(resoFacts, null, 2))
  const amenities: string[] = []
  if (resoFacts?.hasPetsAllowed)                           amenities.push('pet_friendly')
  if (resoFacts?.hasGarage || resoFacts?.parkingFeatures)  amenities.push('parking')
  if (resoFacts?.laundryFeatures)                          amenities.push(`laundry: ${resoFacts.laundryFeatures}`)
  // Fallback: scan description for common amenity signals when resoFacts is absent
  const descLower = (desc || '').toLowerCase()
  if (!amenities.some(a => a.includes('laundry')) && /in.unit.laundry|washer.?dryer/i.test(descLower))
    amenities.push('laundry: in-unit')
  if (!amenities.includes('pet_friendly') && /pets?\s+(ok|allowed|friendly|welcome)/i.test(descLower))
    amenities.push('pet_friendly')
  if (!amenities.includes('parking') && /parking\s+(included|available|garage)/i.test(descLower))
    amenities.push('parking')

  const bedsLabel  = beds  != null ? `${beds}bd`  : ''
  const bathsLabel = baths != null ? `${baths}ba` : ''
  const title = String([bedsLabel, bathsLabel].filter(Boolean).join(' ') || streetAddress)

  return {
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
    amenities,
    description: desc,
    images: imgs,
  }
}

function validateApartmentsComItem(item: Record<string, unknown>): ScrapedListing | null {
  // parseforge/apartments-com-scraper returns no id/propertyId field — use url as stable key
  const externalId = String(item.url || '')
  if (!externalId) return null

  // Actor returns imageUrl (singular string), not a photos array
  const imageUrl = item.imageUrl ? String(item.imageUrl) : null

  return {
    externalId,
    source: 'apartments_com',
    url: String(item.url || ''),
    title: String(item.propertyName || item.name || item.title || ''),
    address: String(item.address || ''),
    city: String(item.city || ''),
    state: String(item.state || ''),
    neighborhood: null,
    zipCode: item.zipCode ? String(item.zipCode) : null,
    // Actor returns rentMin/rentMax (not minRent/rent); use lower bound for comparison
    rent: Math.round((Number(item.rentMin ?? item.minRent ?? item.rent) || 0) * 100),
    // Actor returns bedroomsMin/bedroomsMax (not beds)
    bedrooms: item.bedroomsMin != null ? Number(item.bedroomsMin) : (item.beds != null ? Number(item.beds) : null),
    bathrooms: item.bathrooms != null ? Number(item.bathrooms) : null,
    // Actor returns sqftMin/sqftMax (not sqft)
    sqft: sanitizeSqft((item.sqftMin ?? item.sqft) as number | null),
    availableDate: item.availableDate ? String(item.availableDate) : null,
    amenities: Array.isArray(item.amenities) ? item.amenities.map(String) : [],
    description: item.description ? String(item.description) : null,
    images: imageUrl ? [imageUrl] : (Array.isArray(item.photos) ? item.photos.map(String) : []),
  }
}

function validateCraigslistItem(item: Record<string, unknown>): ScrapedListing | null {
  // automation-lab/craigslist-scraper uses listingId (not id/postId)
  const postId = item.listingId || item.id || item.postId
  if (!postId) return null

  // Drop posts older than 30 days — Craigslist keeps URLs alive but content is gone
  const postedAt = item.postedAt ? String(item.postedAt) : null
  if (postedAt) {
    const posted = new Date(postedAt)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    if (posted < thirtyDaysAgo) {
      console.log(`[CRAIGSLIST] dropping stale post ${postId} (postedAt: ${postedAt})`)
      return null
    }
  }

  // bedrooms/bathrooms come as "2br/1ba" or "1BR / 1Ba" — parseInt handles the leading digit
  const bedroomStr = String(item.bedrooms || '')
  const bedrooms = bedroomStr ? parseInt(bedroomStr) : null
  const bathMatch = bedroomStr.match(/(\d+)\s*[Bb]a/)
  const bathrooms = bathMatch ? parseInt(bathMatch[1]) : null

  const sqftStr = String(item.sqft || '')
  const sqft = sqftStr ? (parseInt(sqftStr.replace(/[^0-9]/g, '')) || null) : null

  // Prefer priceNumeric (integer) over parsing the price string
  const rent = Math.round(
    (Number(item.priceNumeric) || parseFloat(String(item.price || '0').replace(/[^0-9.]/g, '')) || 0) * 100
  )

  const address = String(item.address || item.location || '')
  const { lat, lon } = extractLatLon(item)

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
    availableDate: postedAt ? postedAt.split('T')[0] : null,
    amenities: [],
    description: item.description ? String(item.description) : null,
    // Actor returns imageUrls (array), not images
    images: Array.isArray(item.imageUrls) ? item.imageUrls.map(String)
           : Array.isArray(item.images) ? item.images.map(String) : [],
    lat,
    lon,
  }
}

function validateTruliaItem(item: Record<string, unknown>): ScrapedListing | null {
  // igolaizola/trulia-scraper returns nested objects — access via typed casts
  type Loc = { city?: string; stateCode?: string; zipCode?: string; streetAddress?: string; formattedLocation?: string; neighborhoodName?: string | null }
  type Beds = { formattedValue?: string }
  type Floor = { formattedDimension?: string }
  type Meta = { typedHomeId?: string }
  type Media = { photos?: Array<{ url?: { large?: string } }> }
  type ActiveListing = { dateListed?: string }
  type CurrentStatus = { isActiveForRent?: boolean; isOffMarket?: boolean }
  type TrackingEntry = { key: string; value: string }
  type Tag = { formattedName: string }
  type GenericPrice = { formattedPrice?: string }

  const loc = item.location as Loc | undefined
  const status = item.currentStatus as CurrentStatus | undefined
  if (status?.isActiveForRent === false) return null
  if (status?.isOffMarket === true) return null

  const tracking = Array.isArray(item.tracking) ? (item.tracking as TrackingEntry[]) : []
  const trackingMap = Object.fromEntries(tracking.map(e => [e.key, e.value]))

  const externalId = trackingMap.zPID
    || String((item.metadata as Meta | undefined)?.typedHomeId || '').replace('_ZPID', '')
    || String(item.zpid || item.id || '')
  if (!externalId) return null

  // genericPrice.formattedPrice (e.g. "$2,100/mo") is the documented field; tracking.listingPrice is a fallback.
  // Use match(/\$([\d,]+)/) to grab only the FIRST dollar amount — ranges like "$3,500 - $4,200/mo"
  // previously caused the regex to concatenate both numbers into "$35004200", yielding $350M rents.
  const priceStr = (item.genericPrice as GenericPrice | undefined)?.formattedPrice || ''
  const firstPriceMatch = priceStr.match(/\$([\d,]+)/)
  const genericPriceNum = firstPriceMatch ? parseFloat(firstPriceMatch[1].replace(/,/g, '')) : 0
  const trackingPriceNum = parseFloat(trackingMap.listingPrice || '0') || 0
  const rent = Math.round((genericPriceNum || trackingPriceNum || parseFloat(String(item.price || item.rent || '0')) || 0) * 100)
  // Drop listings where parsed rent exceeds $50k/mo — these are sale prices leaking through
  if (rent > 5_000_000) {
    console.log(`[TRULIA] dropping high-rent listing ${externalId} (rent=${rent/100}, priceStr="${priceStr}")`)
    return null
  }

  const bedsStr = (item.bedrooms as Beds | undefined)?.formattedValue || ''
  const bathsStr = (item.bathrooms as Beds | undefined)?.formattedValue || ''
  const sqftStr = (item.floorSpace as Floor | undefined)?.formattedDimension || ''

  const bedrooms = parseInt(bedsStr) || null
  const bathrooms = parseFloat(bathsStr) || null
  const sqftRaw = parseInt(sqftStr.replace(/[^0-9]/g, '')) || null

  const amenities: string[] = []
  const itemStr = trackingMap.item || ''
  const tagNames = Array.isArray(item.largeTags) ? (item.largeTags as Tag[]).map(t => t.formattedName) : []

  if (tagNames.some(t => /pet.friendly|pets.allowed/i.test(t)) || /Pets Allowed[^;]*Yes/i.test(itemStr))
    amenities.push('pet_friendly')
  const laundryMatch = itemStr.match(/rental:Laundry:([^;]+)/)
  if (laundryMatch && !/contact manager/i.test(laundryMatch[1]))
    amenities.push(`laundry: ${laundryMatch[1].trim()}`)
  const parkingMatch = itemStr.match(/rental:Parking:([^;]+)/)
  if (parkingMatch && !/contact manager/i.test(parkingMatch[1]))
    amenities.push(`parking: ${parkingMatch[1].trim()}`)
  if (/Utilities Included[^;]*Yes/i.test(itemStr))
    amenities.push('utilities_included')
  // Additional signals from largeTags
  if (tagNames.some(t => /gym|fitness/i.test(t)))       amenities.push('gym')
  if (tagNames.some(t => /doorman|concierge/i.test(t))) amenities.push('doorman')
  if (tagNames.some(t => /pool/i.test(t)))              amenities.push('pool')
  if (tagNames.some(t => /elevator/i.test(t)))          amenities.push('elevator')
  if (tagNames.some(t => /rooftop/i.test(t)))           amenities.push('rooftop')

  // Log amenitiesList if present — structure not documented; helps us map it in a follow-on
  if (item.amenitiesList) console.log('[TRULIA] amenitiesList:', JSON.stringify(item.amenitiesList, null, 2))

  const photos = (item.media as Media | undefined)?.photos || []
  const images = photos.map(p => p.url?.large).filter((u): u is string => !!u)

  // Raw actor output uses location.neighborhoodName (verified against live dataset July 2026)
  const neighborhood = loc?.neighborhoodName || null

  return {
    externalId,
    source: 'trulia',
    url: String(item.url || ''),
    title: String(loc?.formattedLocation || ''),
    address: String(loc?.streetAddress || ''),
    city: String(loc?.city || ''),
    state: String(loc?.stateCode || ''),
    neighborhood,
    zipCode: loc?.zipCode ? String(loc.zipCode) : null,
    rent,
    bedrooms,
    bathrooms,
    sqft: sanitizeSqft(sqftRaw),
    availableDate: (item.activeListing as ActiveListing | undefined)?.dateListed
      ? String((item.activeListing as ActiveListing).dateListed).split('T')[0]
      : null,
    amenities,
    description: null,
    images,
  }
}

function mapListings(items: Record<string, unknown>[], source: string): ScrapedListing[] {
  if (source === 'zillow') {
    if (items.length > 0) logRawSample('zillow', items[0])
    return items.flatMap(item => {
      const listing = validateZillowItem(item)
      return listing && isScoreable(listing) ? [listing] : []
    })
  }

  if (source === 'apartments_com') {
    if (items.length > 0) logRawSample('apartments_com', items[0])
    return items.flatMap(item => {
      const listing = validateApartmentsComItem(item)
      return listing && isScoreable(listing) ? [listing] : []
    })
  }

  if (source === 'craigslist') {
    if (items.length > 0) logRawSample('craigslist', items[0])
    return items.flatMap(item => {
      const listing = validateCraigslistItem(item)
      return listing && isScoreable(listing) ? [listing] : []
    })
  }

  if (source === 'trulia') {
    if (items.length > 0) logRawSample('trulia', items[0])
    return items.flatMap(item => {
      const listing = validateTruliaItem(item)
      return listing && isScoreable(listing) ? [listing] : []
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

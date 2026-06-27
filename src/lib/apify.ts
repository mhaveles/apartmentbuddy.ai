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
  // Use a geographic search URL instead of text searchQueries — this finds all apartments
  // in the zip code radius rather than doing a keyword match which returns very few results.
  const searchUrl = buildCraigslistUrl(first, preferences)
  console.log(`[CRAIGSLIST] search URL: ${searchUrl}`)
  return startActor('automation-lab/craigslist-scraper', {
    startUrls: [{ url: searchUrl }],
    includeDetails: true,
    maxResults: 100,
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
  }
}

function validateTruliaItem(item: Record<string, unknown>): ScrapedListing | null {
  // igolaizola/trulia-scraper returns nested objects — access via typed casts
  type Loc = { city?: string; stateCode?: string; zipCode?: string; streetAddress?: string; formattedLocation?: string; neighborhood?: string | null }
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

  // Confirmed field name from actor docs: location.neighborhood (not .neighborhoodName)
  const neighborhood = loc?.neighborhood || null

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

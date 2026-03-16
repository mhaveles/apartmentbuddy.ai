import { ApifyClient } from 'apify-client'

const client = new ApifyClient({
  token: process.env.APIFY_API_TOKEN!,
})

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

export async function scrapeZillow(
  neighborhoods: Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null }>
): Promise<ScrapedListing[]> {
  const searchUrls = neighborhoods.map(n => {
    const query = n.zip_code || `${n.neighborhood} ${n.city} ${n.state}`
    return `https://www.zillow.com/homes/for_rent/${encodeURIComponent(query)}_rb/`
  })

  try {
    const run = await client.actor('maxcopell/zillow-scraper').call({
      startUrls: searchUrls.map(url => ({ url })),
      maxItems: 50,
      type: 'rent',
    })

    const { items } = await client.dataset(run.defaultDatasetId).listItems()

    return items.map((item: Record<string, unknown>) => ({
      externalId: String(item.zpid || item.id || Math.random()),
      source: 'zillow',
      url: String(item.detailUrl || item.url || ''),
      title: String(item.statusText || `${item.bedrooms}bd ${item.bathrooms}ba`),
      address: String(item.streetAddress || item.address || ''),
      city: String(item.city || ''),
      state: String(item.state || ''),
      neighborhood: item.neighborhood ? String(item.neighborhood) : null,
      zipCode: item.zipcode ? String(item.zipcode) : null,
      rent: Math.round((Number(item.price) || 0) * 100), // convert to cents
      bedrooms: item.bedrooms ? Number(item.bedrooms) : null,
      bathrooms: item.bathrooms ? Number(item.bathrooms) : null,
      sqft: item.livingArea ? Number(item.livingArea) : null,
      availableDate: null,
      amenities: [],
      description: item.description ? String(item.description) : null,
      images: Array.isArray(item.photos) ? item.photos.map(String) : [],
    }))
  } catch (error) {
    console.error('Zillow scrape error:', error)
    return []
  }
}

export async function scrapeCraigslist(
  neighborhoods: Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null }>
): Promise<ScrapedListing[]> {
  // Build Craigslist search URLs per neighborhood
  const searchUrls = neighborhoods.map(n => {
    const citySlug = n.city.toLowerCase().replace(/\s+/g, '')
    const query = encodeURIComponent(n.zip_code || `${n.neighborhood} ${n.city}`)
    return `https://${citySlug}.craigslist.org/search/apa?query=${query}&section=apa`
  })

  try {
    const run = await client.actor('dtrungtin/craigslist-scraper').call({
      startUrls: searchUrls.map(url => ({ url })),
      maxItems: 50,
    })

    const { items } = await client.dataset(run.defaultDatasetId).listItems()

    return items.map((item: Record<string, unknown>) => ({
      externalId: String(item.id || item.postId || Math.random()),
      source: 'craigslist',
      url: String(item.url || ''),
      title: String(item.title || ''),
      address: String(item.location || item.address || ''),
      city: String(item.city || neighborhoods[0]?.city || ''),
      state: String(item.state || neighborhoods[0]?.state || ''),
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
  } catch (error) {
    console.error('Craigslist scrape error:', error)
    return []
  }
}

export async function scrapeApartmentsCom(
  neighborhoods: Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null }>
): Promise<ScrapedListing[]> {
  const searchUrls = neighborhoods.map(n => {
    const location = n.zip_code || `${n.neighborhood.toLowerCase().replace(/\s+/g, '-')}-${n.city.toLowerCase()}-${n.state.toLowerCase()}`
    return `https://www.apartments.com/${location}/`
  })

  try {
    const run = await client.actor('novi/apartments-scraper').call({
      startUrls: searchUrls.map(url => ({ url })),
      maxItems: 50,
    })

    const { items } = await client.dataset(run.defaultDatasetId).listItems()

    return items.map((item: Record<string, unknown>) => ({
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
  } catch (error) {
    console.error('Apartments.com scrape error:', error)
    return []
  }
}

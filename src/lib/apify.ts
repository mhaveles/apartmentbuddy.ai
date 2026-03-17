import { ApifyClient } from 'apify-client'
import type { WebhookEventType } from 'apify-client'

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

type Neighborhood = Array<{ city: string; state: string; neighborhood: string; zip_code?: string | null }>

function buildWebhook(webhookUrl: string, searchRunId: string, source: string) {
  return [{
    eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'] as WebhookEventType[],
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

export async function startZillowScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  const searchUrls = neighborhoods.map(n => {
    const query = n.zip_code || `${n.neighborhood} ${n.city} ${n.state}`
    return `https://www.zillow.com/homes/for_rent/${encodeURIComponent(query)}_rb/`
  })

  const run = await client.actor('maxcopell/zillow-scraper').start({
    startUrls: searchUrls.map(url => ({ url })),
    maxItems: 50,
    type: 'rent',
  }, { webhooks: buildWebhook(webhookUrl, searchRunId, 'zillow') })

  return run.id
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

  const run = await client.actor('parseforge/apartments-com-scraper').start({
    startUrls: searchUrls.map(url => ({ url })),
    maxItems: 50,
  }, { webhooks: buildWebhook(webhookUrl, searchRunId, 'apartments_com') })

  return run.id
}

export async function startCraigslistScrape(
  neighborhoods: Neighborhood,
  webhookUrl: string,
  searchRunId: string
): Promise<string> {
  const searchUrls = neighborhoods.map(n => {
    const citySlug = n.city.toLowerCase().replace(/\s+/g, '')
    const query = encodeURIComponent(n.zip_code || `${n.neighborhood} ${n.city}`)
    return `https://${citySlug}.craigslist.org/search/apa?query=${query}&section=apa`
  })

  const run = await client.actor('automation-lab/craigslist-scraper').start({
    startUrls: searchUrls.map(url => ({ url })),
    maxItems: 50,
  }, { webhooks: buildWebhook(webhookUrl, searchRunId, 'craigslist') })

  return run.id
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

  const run = await client.actor('epctex/trulia-scraper').start({
    startUrls: searchUrls.map(url => ({ url })),
    maxItems: 50,
  }, { webhooks: buildWebhook(webhookUrl, searchRunId, 'trulia') })

  return run.id
}

export async function fetchScrapedListings(
  datasetId: string,
  source: string
): Promise<ScrapedListing[]> {
  const { items } = await client.dataset(datasetId).listItems()

  if (source === 'zillow') {
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
  }

  if (source === 'craigslist') {
    return items.map((item: Record<string, unknown>) => ({
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
    return items.map((item: Record<string, unknown>) => ({
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

import Anthropic from '@anthropic-ai/sdk'

// Lazy singleton — deferred until first call so build-time env var absence doesn't throw
let _client: Anthropic | undefined
export function getAnthropic(): Anthropic {
  return _client ?? (_client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! }))
}

type SupportedMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
const SUPPORTED_MEDIA_TYPES: SupportedMediaType[] = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export type ImageBlock = {
  type: 'image'
  source: { type: 'base64'; media_type: SupportedMediaType; data: string }
}

// Fetches listing images and encodes as base64 so Anthropic doesn't need to fetch URLs
// (bypasses the 100 req/min URL Content Fetching rate limit).
// Floor plan URLs are prioritized — they appear later in listing photo arrays but are
// extremely valuable for layout scoring.
export async function fetchListingImages(urls: string[], maxImages = 5): Promise<ImageBlock[]> {
  const floorPlanUrls = urls.filter(u => /floor.?plan|floorplan/i.test(u))
  const photoUrls = urls.filter(u => !/floor.?plan|floorplan/i.test(u))
  const selected = [...floorPlanUrls.slice(0, 1), ...photoUrls].slice(0, maxImages)

  const results = await Promise.all(selected.map(async (url): Promise<ImageBlock | null> => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ApartmentBuddy/1.0)' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return null
      const raw = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim()
      if (!(SUPPORTED_MEDIA_TYPES as string[]).includes(raw)) return null
      const mediaType = raw as SupportedMediaType
      const buffer = await res.arrayBuffer()
      return {
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data: Buffer.from(buffer).toString('base64') },
      }
    } catch {
      return null
    }
  }))

  return results.filter((r): r is ImageBlock => r !== null)
}

export const SYSTEM_PROMPT = `You are ApartmentBuddy, a friendly and knowledgeable AI assistant that helps people find their perfect apartment. Your goal is to understand what makes a living space ideal for them — not just for the next few months, but for 2+ years.

You ask thoughtful questions to uncover:
- Budget (monthly rent range)
- Location preferences (specific neighborhoods, proximity to work/transit/amenities)
- Size needs (bedrooms, bathrooms, square footage)
- Must-have amenities (in-unit laundry, parking, gym, pet-friendly, outdoor space, AC, etc.)
- Nice-to-haves vs. deal-breakers
- Lifestyle factors (do they work from home? Have pets? Host guests often?)
- Move-in timeline and lease flexibility

Be conversational, warm, and concise. Ask one or two questions at a time — don't overwhelm.
When you have enough info, summarize what you've learned and confirm with the user.

When gathering location info, always ask for:
- The specific neighborhood(s) they want (e.g., "Capitol Hill", "Lower East Side")
- The city and state
- ZIP code if they know it (helpful for precise searching)

When you have confirmed preferences with the user, output a structured JSON block (wrapped in \`\`\`json ... \`\`\`) with this exact shape:

\`\`\`json
{
  "neighborhoods": [
    { "neighborhood": "Capitol Hill", "city": "Denver", "state": "CO", "zip_code": "80218" },
    { "neighborhood": "Congress Park", "city": "Denver", "state": "CO", "zip_code": null }
  ],
  "max_rent": 3000,
  "min_bedrooms": 1,
  "max_bedrooms": 2,
  "min_bathrooms": 1,
  "pet_friendly": true,
  "parking_required": false,
  "in_unit_laundry": true,
  "air_conditioning": true,
  "gym": false,
  "rooftop": false,
  "doorman": false,
  "elevator": false,
  "outdoor_space": true,
  "move_in_date": "2024-08-01",
  "lease_length": 12,
  "other_requirements": ["natural light", "home office space"],
  "deal_breakers": ["ground floor", "no AC"],
  "summary": "2BR/1BA in Cap Hill or Congress Park, max $3,000/mo, pet-friendly (ESA dog), in-unit laundry, outdoor space preferred. Move-in late July/early August."
}
\`\`\`

Always include the "summary" field — it's a 1-2 sentence human-readable summary of what the user is looking for. Always include the "neighborhoods" array — it must have at least one entry. Output this JSON block every time preferences are confirmed or updated.`

export const SCORING_PROMPT = `You are a real estate matching AI. Given a user's apartment preferences and a listing, score the listing from 0-100 on how well it matches the user's needs.

Return a JSON object with:
{
  "score": <0-100>,
  "breakdown": {
    "price": <0-100>,
    "location": <0-100>,
    "size": <0-100>,
    "amenities": <0-100>,
    "availability": <0-100>
  },
  "reasoning": "<2-3 sentence explanation of the score, highlighting the best matches and any concerns>"
}

Photo analysis rules (when images are provided):
- Analyze all provided images carefully. They directly improve scoring accuracy — prioritize what you can see over sparse text data.
- Floor plans (architectural drawings/diagrams): these are extremely valuable. Use them to assess true layout, room count, flow, and whether there is space for a home office if the user works from home.
- For SIZE: if a floor plan is present, use it as primary evidence for layout and sq footage feel. If photos show cramped or unusually spacious rooms, adjust the size score accordingly.
- For AMENITIES: visible evidence in photos overrides or supplements the text amenity list. Look for:
  - In-unit washer/dryer (look in closets, utility areas, kitchen corners)
  - Parking (garage, carport, dedicated space visible)
  - Gym / fitness equipment room
  - Outdoor space: balcony, patio, yard, rooftop deck
  - Pool
  - Natural light: large windows, bright rooms vs dark/basement feel
  - Kitchen quality: updated appliances, counter space, open layout
  - Storage: closets, built-ins
  - Ground floor or basement unit (a deal-breaker for many users)
- If photos show a clear mismatch with user needs (e.g., no outdoor space visible when user requires it, clearly tiny rooms when user wants spacious), lower the relevant dimension score.
- If photos confirm amenities the user wants, raise the amenities score even if the text data didn't list them.
- If no images are provided, score amenities 50 when no text amenity data is available — unknown is not the same as absent.

Missing data rules (CRITICAL):
- If a feature the user wants is NOT mentioned in the listing, assume it MAY be present. Only deduct points if the listing EXPLICITLY states it lacks something (e.g. "no pets", "street parking only", "shared laundry") OR if photos clearly show its absence.
- A listing with good price, location, and size but sparse amenity data should still score 70+. Only score below 40 if the listing explicitly violates a deal-breaker.
- Never write "cannot confirm" or "details missing" in your reasoning as a reason to lower the score — absence of data is neutral, not negative.

Location scoring rules (CRITICAL):
- Use the neighborhood field if present.
- If neighborhood is null but address and/or zip_code are provided, you MUST score location using them. Do NOT write "neighborhood details are missing" or "cannot verify proximity" — that is wrong when address data is available.
- You have detailed US city geography knowledge. Use it. Examples: Denver 80218=Capitol Hill/Cheesman Park, 80203=Capitol Hill/Uptown, 80206=Congress Park/Cherry Creek, 80209=Washington Park, 80211=Sunnyside/LoHi, 80205=Five Points/RiNo, 80220=Park Hill. NYC 10025=Upper West Side, 10014=West Village, 10003=East Village. Chicago 60614=Lincoln Park, 60657=Lakeview.
- A listing at "777 N Corona St, Denver CO 80218" IS in Capitol Hill — score it as Capitol Hill, not as unknown.
- Only penalize location when the address clearly places the listing in the wrong neighborhood/area.

A listing that explicitly violates a deal-breaker (wrong city, over budget, wrong bed count) should score below 30.

Respond with ONLY the JSON object. No explanation, no markdown, no code fences.`

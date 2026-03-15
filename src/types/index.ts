export type Plan = 'free' | 'pro'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  plan: Plan
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  subscription_status: string | null
  searches_used: number
  created_at: string
  updated_at: string
}

export interface Preferences {
  id: string
  user_id: string
  max_rent: number | null
  min_bedrooms: number | null
  max_bedrooms: number | null
  min_bathrooms: number | null
  pet_friendly: boolean | null
  parking_required: boolean | null
  in_unit_laundry: boolean | null
  gym: boolean | null
  rooftop: boolean | null
  doorman: boolean | null
  elevator: boolean | null
  outdoor_space: boolean | null
  move_in_date: string | null
  lease_length: string | null
  other_requirements: string[] | null
  deal_breakers: string[] | null
  summary: string | null
}

export interface Neighborhood {
  id: string
  user_id: string
  city: string
  state: string
  neighborhood: string
  zip_code: string | null
  active: boolean
}

export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface Conversation {
  id: string
  user_id: string
  messages: Message[]
  preferences_extracted: boolean
}

export interface Listing {
  id: string
  external_id: string
  source: string
  url: string
  title: string | null
  address: string | null
  city: string
  state: string
  neighborhood: string | null
  zip_code: string | null
  rent: number
  bedrooms: number | null
  bathrooms: number | null
  sqft: number | null
  available_date: string | null
  amenities: string[] | null
  description: string | null
  images: string[] | null
  scraped_at: string
}

export interface UserListing {
  id: string
  user_id: string
  listing_id: string
  score: number
  score_breakdown: Record<string, number> | null
  score_reasoning: string | null
  is_saved: boolean
  is_dismissed: boolean
  listing?: Listing
}

export interface SearchRun {
  id: string
  user_id: string
  neighborhoods: string[]
  listings_found: number
  listings_scored: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  error: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

import { SupabaseClient } from '@supabase/supabase-js'

// Pulls the ```json ... ``` preferences block out of a Claude onboarding/refinement
// response. Shared by the authenticated chat route and the anonymous pre-login route
// so both stay in sync with the exact shape ONBOARDING_PROMPT/REFINEMENT_PROMPT emit.
export function extractPreferencesJson(text: string): Record<string, unknown> | null {
  const match = text.match(/```json\n([\s\S]*?)\n```/)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

export type ApplyPreferencesResult = {
  preferencesSaved: boolean
  // Reflects the user's actual current state after this call — true if they have at
  // least one active monitored neighborhood, whether it was touched this turn or already
  // existed. A run can't start without this, so callers should check it before telling
  // the user they're ready to search.
  hasNeighborhoods: boolean
}

// Upserts a parsed preferences JSON block into `preferences` and replaces the user's
// active `monitored_neighborhoods` with the extracted set (if valid).
export async function applyExtractedPreferences(
  supabase: SupabaseClient,
  userId: string,
  prefs: Record<string, unknown>
): Promise<ApplyPreferencesResult> {
  const p = prefs as {
    max_rent?: number
    min_bedrooms?: number
    max_bedrooms?: number
    min_bathrooms?: number
    pet_friendly?: boolean
    parking_required?: boolean
    in_unit_laundry?: boolean
    air_conditioning?: boolean
    gym?: boolean
    rooftop?: boolean
    doorman?: boolean
    elevator?: boolean
    outdoor_space?: boolean
    move_in_date?: string
    lease_length?: string
    other_requirements?: string[]
    deal_breakers?: string[]
    priorities?: unknown
    summary?: string
    neighborhoods?: Array<{ neighborhood: string; city: string; state: string; zip_code?: string | null }>
  }

  const { error: upsertError } = await supabase
    .from('preferences')
    .upsert({
      user_id: userId,
      max_rent: p.max_rent ? p.max_rent * 100 : null,
      min_bedrooms: p.min_bedrooms || null,
      max_bedrooms: p.max_bedrooms || null,
      min_bathrooms: p.min_bathrooms || null,
      pet_friendly: p.pet_friendly ?? null,
      parking_required: p.parking_required ?? null,
      in_unit_laundry: p.in_unit_laundry ?? null,
      air_conditioning: p.air_conditioning ?? null,
      gym: p.gym ?? null,
      rooftop: p.rooftop ?? null,
      doorman: p.doorman ?? null,
      elevator: p.elevator ?? null,
      outdoor_space: p.outdoor_space ?? null,
      move_in_date: p.move_in_date || null,
      lease_length: p.lease_length || null,
      other_requirements: p.other_requirements || [],
      deal_breakers: p.deal_breakers || [],
      priorities: p.priorities || null,
      summary: p.summary || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })

  if (upsertError) {
    console.error('Preferences upsert error:', upsertError)
    return { preferencesSaved: false, hasNeighborhoods: false }
  }

  // Validate before writing — a single malformed entry would otherwise fail the whole
  // insert (NOT NULL violation), and since we delete-then-insert, that means a bad model
  // turn wipes the user's existing neighborhoods and replaces them with nothing.
  const extractedNeighborhoods = Array.isArray(p.neighborhoods) ? p.neighborhoods : []
  const validNeighborhoods = extractedNeighborhoods.filter(n =>
    n && typeof n.neighborhood === 'string' && n.neighborhood.trim() &&
    typeof n.city === 'string' && n.city.trim() &&
    typeof n.state === 'string' && n.state.trim()
  )

  if (validNeighborhoods.length > 0) {
    await supabase.from('monitored_neighborhoods').delete().eq('user_id', userId)
    const { error: neighborhoodError } = await supabase
      .from('monitored_neighborhoods')
      .insert(validNeighborhoods.map(n => ({
        user_id: userId,
        neighborhood: n.neighborhood.trim(),
        city: n.city.trim(),
        state: n.state.trim().toUpperCase(),
        zip_code: n.zip_code || null,
        active: true,
      })))
    if (neighborhoodError) console.error('Neighborhoods upsert error:', neighborhoodError)
  } else if (extractedNeighborhoods.length > 0) {
    console.error('All extracted neighborhoods failed validation, leaving existing rows untouched:', extractedNeighborhoods)
  }

  const { count } = await supabase
    .from('monitored_neighborhoods')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('active', true)

  return { preferencesSaved: true, hasNeighborhoods: (count ?? 0) > 0 }
}

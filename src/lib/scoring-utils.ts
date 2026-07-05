// Listings scoring below this are considered poor fits and hidden from results.
export const MIN_DISPLAY_SCORE = 50

export function scoreTier(score: number): string {
  if (score >= 80) return 'Strong Match'
  if (score >= 60) return 'Good Match'
  if (score >= 40) return 'Possible'
  return 'Poor Fit'
}

export type VotedRow = { vote: number; score_breakdown: unknown; listing: unknown }

export function buildVotedContext(voted: VotedRow[]): string {
  const liked = voted.filter(v => v.vote === 1).slice(0, 5)
  const disliked = voted.filter(v => v.vote === -1).slice(0, 5)
  if (liked.length === 0 && disliked.length === 0) return ''

  const fmt = (v: VotedRow) => {
    const l = v.listing as Record<string, unknown> | null
    return {
      rent: l?.rent ? (l.rent as number) / 100 : null,
      bedrooms: l?.bedrooms,
      bathrooms: l?.bathrooms,
      sqft: l?.sqft,
      neighborhood: l?.neighborhood,
      city: l?.city,
      amenities: l?.amenities,
      score_breakdown: v.score_breakdown,
    }
  }

  const lines: string[] = [
    '\n\nExamples from this user\'s votes (use these as calibration examples — weight them alongside the user\'s stated preferences, not above them):',
  ]
  if (liked.length > 0) lines.push(`Listings this user liked:\n${JSON.stringify(liked.map(fmt), null, 2)}`)
  if (disliked.length > 0) lines.push(`Listings this user disliked:\n${JSON.stringify(disliked.map(fmt), null, 2)}`)
  return lines.join('\n')
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { migrateAnonSession } from '@/lib/migrate-anon-session'

// Supabase OAuth (Google) redirects here with a `code` to exchange for a session.
// Mirrors the email/password path in /api/auth/migrate-session, but runs server-side
// since the OAuth redirect leaves the page before any client code can call that route.
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')
  const sessionId = searchParams.get('sessionId')
  const next = searchParams.get('next') || '/search/loading'

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.exchangeCodeForSession(code)

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login?error=oauth`)
  }

  if (sessionId) {
    const service = await createServiceClient()
    const result = await migrateAnonSession(supabase, service, data.user.id, sessionId)
    if (result.ok && 'searchRunId' in result) {
      return NextResponse.redirect(`${origin}${next}?runId=${result.searchRunId}`)
    }
    if (result.ok && 'needsNeighborhood' in result) {
      return NextResponse.redirect(`${origin}/neighborhoods?onboarding=1`)
    }
    if (result.ok && 'searchError' in result) {
      // Migrated fine — only the scrape trigger failed. Send them to the retry surface.
      return NextResponse.redirect(`${origin}/listings?searchError=1`)
    }
    // 404/409 — nothing migrated. Flag it so /chat doesn't render an unexplained blank slate.
    return NextResponse.redirect(`${origin}/chat?intakeIssue=1`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}

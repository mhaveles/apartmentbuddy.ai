// Client-side cookie used to carry the anonymous chat session ID from the
// landing page widget (LandingChat.tsx) through to whichever signup path
// converts it (inline SignupModal or the standalone /signup page).
export const ANON_SESSION_COOKIE = 'ab_anon_session'

export function getAnonSessionId(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${ANON_SESSION_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

export function setAnonSessionId(value: string) {
  const oneYear = 60 * 60 * 24 * 365
  document.cookie = `${ANON_SESSION_COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${oneYear}; samesite=lax`
}

export function clearAnonSessionId() {
  document.cookie = `${ANON_SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`
}

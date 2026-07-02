'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

type Prefs = {
  max_rent?: number | null
  pet_friendly?: boolean | null
  parking_required?: boolean | null
  in_unit_laundry?: boolean | null
  gym?: boolean | null
  rooftop?: boolean | null
  doorman?: boolean | null
  elevator?: boolean | null
  outdoor_space?: boolean | null
  neighborhoods?: { neighborhood: string; city: string; state: string }[]
}

type SearchRun = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  listings_found: number | null
  listings_scored: number | null
  started_at: string
}

type Status = 'resolving' | 'running' | 'completed' | 'failed' | 'cancelled'

function buildMessages(prefs: Prefs | null): string[] {
  const n = prefs?.neighborhoods?.[0]
  const neighborhoodPhrase = n ? `${n.neighborhood}, ${n.city}` : 'your neighborhoods'
  const budget = prefs?.max_rent ? `$${Math.round(prefs.max_rent / 100).toLocaleString()}` : null

  const mustHaves: string[] = []
  if (prefs?.pet_friendly) mustHaves.push('pet-friendly buildings')
  if (prefs?.in_unit_laundry) mustHaves.push('in-unit laundry')
  if (prefs?.parking_required) mustHaves.push('parking')
  if (prefs?.gym) mustHaves.push('a gym')
  if (prefs?.doorman) mustHaves.push('doorman service')
  if (prefs?.elevator) mustHaves.push('an elevator')
  if (prefs?.outdoor_space) mustHaves.push('outdoor space')
  if (prefs?.rooftop) mustHaves.push('a rooftop')
  const [mustHave1, mustHave2] = mustHaves

  return [
    `Scanning listings in ${neighborhoodPhrase}...`,
    'Checking Zillow, Apartments.com, and Craigslist for new listings...',
    budget ? `Filtering by your ${budget}/mo budget...` : 'Filtering by your budget...',
    mustHave1 ? `Checking for ${mustHave1}...` : 'Cross-referencing amenities...',
    'Reading through listing descriptions and photos...',
    mustHave2 ? `Making sure listings have ${mustHave2}...` : 'Comparing against your must-haves...',
    'Scoring listings against your preferences with AI...',
    'Almost done — ranking your top matches...',
  ]
}

function LoadingScreen() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [runId, setRunId] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('resolving')
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [messageIndex, setMessageIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const [resultCount, setResultCount] = useState<number | null>(null)
  const [longWait, setLongWait] = useState(false)
  const pollStartRef = useRef<number | null>(null)

  const messages = useMemo(() => buildMessages(prefs), [prefs])

  // Resolve which search run to track, and fetch preferences for personalization.
  useEffect(() => {
    async function init() {
      const urlRunId = searchParams.get('runId')

      const prefsPromise = fetch('/api/preferences')
        .then(async r => {
          if (r.status === 401) {
            router.replace('/login')
            return null
          }
          return r.ok ? r.json() : {}
        })
        .catch(() => ({}))

      if (urlRunId) {
        setRunId(urlRunId)
        setStatus('running')
        pollStartRef.current = Date.now()
        const p = await prefsPromise
        if (p) setPrefs(p)
        return
      }

      const [runsRes, p] = await Promise.all([
        fetch('/api/search')
          .then(r => {
            if (r.status === 401) {
              router.replace('/login')
              return null
            }
            return r.ok ? r.json() : []
          })
          .catch(() => []),
        prefsPromise,
      ])
      if (p) setPrefs(p)

      const runs: SearchRun[] = Array.isArray(runsRes) ? runsRes : []
      const active = runs.find(r => r.status === 'running' || r.status === 'pending')
      if (active) {
        setRunId(active.id)
        setStatus('running')
        pollStartRef.current = Date.now()
      } else {
        const hasPrefs = !!p && Object.keys(p).length > 0
        router.replace(hasPrefs ? '/listings' : '/chat')
      }
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Poll search status every 4s until it resolves.
  useEffect(() => {
    if (!runId || status === 'completed' || status === 'failed' || status === 'cancelled') return
    const interval = setInterval(async () => {
      if (pollStartRef.current && Date.now() - pollStartRef.current > 2 * 60 * 1000) {
        setLongWait(true)
      }
      try {
        const res = await fetch(`/api/search?runId=${runId}`)
        if (res.status === 401) {
          router.replace('/login')
          return
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const run: SearchRun = await res.json()
        if (run.status === 'completed') {
          setResultCount(run.listings_scored ?? run.listings_found ?? 0)
          setStatus('completed')
        } else if (run.status === 'failed' || run.status === 'cancelled') {
          setStatus(run.status)
        }
      } catch (err) {
        console.warn('Poll error (will retry):', err)
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [runId, status, router])

  // Redirect to results shortly after completion.
  useEffect(() => {
    if (status !== 'completed') return
    const t = setTimeout(() => router.push('/listings'), 1500)
    return () => clearTimeout(t)
  }, [status, router])

  // Advance the narrated message on a ~90s pace, holding at the last message.
  useEffect(() => {
    if (status === 'completed' || status === 'failed' || status === 'cancelled') return
    const perMessageMs = 90_000 / messages.length
    const interval = setInterval(() => {
      setMessageIndex(i => Math.min(i + 1, messages.length - 1))
    }, perMessageMs)
    return () => clearInterval(interval)
  }, [status, messages.length])

  // Jump straight to the final message the instant results are ready.
  useEffect(() => {
    if (status === 'completed') setMessageIndex(messages.length - 1)
  }, [status, messages.length])

  // Fade transition on message change.
  useEffect(() => {
    setVisible(false)
    const t = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(t)
  }, [messageIndex])

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="w-full max-w-lg text-center">
        <div className="text-xl font-bold text-indigo-600 mb-10">ApartmentBuddy.ai</div>

        {status === 'running' || status === 'resolving' ? (
          <>
            <div className="flex gap-1.5 justify-center mb-8">
              {[0, 150, 300].map(delay => (
                <span
                  key={delay}
                  className="w-2 h-2 rounded-full bg-indigo-400 animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </div>

            <div className="h-16 flex items-center justify-center">
              <p
                className={`text-lg sm:text-xl text-gray-700 font-medium text-center px-6 transition-all duration-500 ease-out ${
                  visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                }`}
              >
                {messages[messageIndex]}
              </p>
            </div>

            <div className="my-8 flex justify-center">
              <div className="w-full max-w-md h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-600 rounded-full transition-[width] duration-[1500ms] ease-out"
                  style={{ width: `${((messageIndex + 1) / messages.length) * 100}%` }}
                />
              </div>
            </div>

            <p className="text-sm text-gray-400">
              {longWait
                ? 'Still working — some sources take longer than others. Hang tight.'
                : "This usually takes 1-2 minutes. We're scanning real listings right now."}
            </p>
          </>
        ) : status === 'completed' ? (
          <div className="transition-all duration-500 ease-out opacity-100">
            <div className="w-14 h-14 rounded-full bg-green-100 text-green-600 flex items-center justify-center mx-auto mb-4 text-2xl">
              ✓
            </div>
            <p className="text-2xl font-bold text-gray-900">
              Found {resultCount ?? 0} match{resultCount === 1 ? '' : 'es'}!
            </p>
            <p className="text-sm text-gray-400 mt-2">Taking you to your results...</p>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8">
            <p className="text-lg font-semibold text-gray-900 mb-2">
              {status === 'cancelled' ? 'Search cancelled' : 'We hit a snag finding listings'}
            </p>
            <p className="text-sm text-gray-500 mb-6">
              {status === 'cancelled'
                ? 'No worries — you can start a new search any time.'
                : "Some of our sources didn't respond in time. You can retry from your listings page."}
            </p>
            <button
              onClick={() => router.push('/listings')}
              className="bg-indigo-600 text-white px-6 py-3 rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              Go to Listings
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function SearchLoadingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-white" />}>
      <LoadingScreen />
    </Suspense>
  )
}

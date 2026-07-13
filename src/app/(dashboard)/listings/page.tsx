'use client'

import { Suspense, useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { UserListing, Neighborhood, SearchRun } from '@/types'
import { scoreTier, MIN_DISPLAY_SCORE } from '@/lib/scoring-utils'

function ListingsContent() {
  const searchParams = useSearchParams()
  const hadSearchError = searchParams.get('searchError') === '1'
  const [listings, setListings] = useState<UserListing[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchRunId, setSearchRunId] = useState<string | null>(null)
  const [savedOnly, setSavedOnly] = useState(false)
  const [plan, setPlan] = useState('free')
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([])
  const [selectedNeighborhoodId, setSelectedNeighborhoodId] = useState('')
  const [activeNeighborhoodTab, setActiveNeighborhoodTab] = useState('all')
  const [searchStatus, setSearchStatus] = useState<string | null>(null)
  const [searchTimedOut, setSearchTimedOut] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [scraperWarnings, setScraperWarnings] = useState<string[]>([])
  const [rescoring, setRescoring] = useState(false)
  const [showPaywall, setShowPaywall] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [prioritySuggestion, setPrioritySuggestion] = useState<Record<string, string> | null>(null)
  const [priorityInsight, setPriorityInsight] = useState<string | null>(null)
  const [checkInSessionId, setCheckInSessionId] = useState<string | null>(null)
  const [checkInConversationId, setCheckInConversationId] = useState<string | null>(null)
  const [checkInMessages, setCheckInMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string }>>([])
  const [checkInInput, setCheckInInput] = useState('')
  const [checkInSending, setCheckInSending] = useState(false)
  const [checkInMinimized, setCheckInMinimized] = useState(false)
  const [deepDiveListing, setDeepDiveListing] = useState<UserListing | null>(null)
  const pollStartRef = useRef<number | null>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)

  const loadListings = useCallback(async () => {
    const res = await fetch(`/api/listings${savedOnly ? '?saved=true' : ''}`)
    const data = await res.json()
    setListings(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [savedOnly])

  const checkAvailability = useCallback(async () => {
    try {
      const res = await fetch('/api/listings/check-availability', { method: 'POST' })
      const { removed } = await res.json()
      if (removed > 0) loadListings()
    } catch {
      // non-critical — silently ignore
    }
  }, [loadListings])

  useEffect(() => {
    loadListings().then(() => checkAvailability())
    fetch('/api/preferences').then(r => r.json()).then(prefs => {
      if (prefs?.priorities_suggestion) {
        setPrioritySuggestion(prefs.priorities_suggestion)
        setPriorityInsight(prefs.priorities_insight ?? null)
      }
    }).catch(() => { /* non-critical */ })
  }, [loadListings, checkAvailability])

  // On load: fetch monitored neighborhoods + plan (for the single-neighborhood picker),
  // resume polling if there's an in-progress search (up to 12 min old), and default the
  // picker to whichever neighborhood was searched most recently.
  useEffect(() => {
    async function init() {
      const [neighData, runs] = await Promise.all([
        fetch('/api/neighborhoods').then(r => r.json()),
        fetch('/api/search').then(r => r.json()),
      ])

      const list: Neighborhood[] = neighData?.neighborhoods || []
      setNeighborhoods(list)
      setPlan(neighData?.plan || 'free')

      if (Array.isArray(runs) && runs.length > 0) setHasSearched(true)

      const lastWithNeighborhood = Array.isArray(runs)
        ? (runs as SearchRun[]).find(r => r.neighborhood_id)
        : null
      const preferredId = lastWithNeighborhood?.neighborhood_id
      const validPreferred = preferredId && list.some(n => n.id === preferredId) ? preferredId : null
      setSelectedNeighborhoodId(validPreferred || list[0]?.id || '')

      const twelveMinAgo = new Date(Date.now() - 12 * 60 * 1000).toISOString()
      const running = Array.isArray(runs)
        ? runs.find((r: { status: string; id: string; started_at: string }) =>
            (r.status === 'running' || r.status === 'pending') && r.started_at > twelveMinAgo)
        : null
      if (running) {
        setSearching(true)
        setSearchStatus('running')
        setSearchRunId(running.id)
        pollStartRef.current = Date.now()
      }
    }
    init()
  }, [])

  // Poll search run status — bail after 12 min, retry on transient errors
  useEffect(() => {
    if (!searchRunId) return
    const interval = setInterval(async () => {
      if (pollStartRef.current && Date.now() - pollStartRef.current > 12 * 60 * 1000) {
        clearInterval(interval)
        setSearching(false)
        setSearchRunId(null)
        setSearchTimedOut(true)
        return
      }
      try {
        const res = await fetch(`/api/search?runId=${searchRunId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const run = await res.json()
        setSearchStatus(run.status)
        if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
          clearInterval(interval)
          setSearching(false)
          setSearchRunId(null)
          setSearchTimedOut(false)
          setHasSearched(true)
          if (run.status === 'completed') loadListings()
        }
      } catch (err) {
        console.warn('Poll error (will retry):', err)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [searchRunId, loadListings])

  async function cancelSearch() {
    if (!searchRunId) return
    await fetch(`/api/search?runId=${searchRunId}`, { method: 'DELETE' })
    setSearching(false)
    setSearchRunId(null)
    setSearchStatus(null)
  }

  async function rescoreListings() {
    setRescoring(true)
    await checkAvailability() // clear dead listings before re-scoring
    await fetch('/api/listings/rescore', { method: 'POST' })
    // Scoring runs in background — poll until scores change or 90s passes
    const start = Date.now()
    const poll = setInterval(async () => {
      if (Date.now() - start > 90_000) { clearInterval(poll); setRescoring(false); return }
      await loadListings()
    }, 4000)
    setTimeout(() => { clearInterval(poll); setRescoring(false); loadListings() }, 90_000)
  }

  async function runSearch() {
    setSearching(true)
    setSearchStatus('running')
    setScraperWarnings([])
    setSearchTimedOut(false)
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(plan !== 'pro' ? { neighborhoodId: selectedNeighborhoodId } : {}),
    })
    const data = await res.json()
    if (data.error) {
      if (data.paywall) {
        setShowPaywall(true)
        setSearching(false)
        return
      }
      const detail = Array.isArray(data.details) && data.details.length
        ? `\n\n${data.details.join('\n')}`
        : ''
      alert(data.error + detail)
      setSearching(false)
      return
    }
    // Surface partial failures as a dismissible warning, not a blocking alert
    if (Array.isArray(data.failures) && data.failures.length > 0) {
      setScraperWarnings(data.failures)
    }
    pollStartRef.current = Date.now()
    setSearchRunId(data.searchRunId)
  }

  async function buyCredits() {
    setPurchasing(true)
    const res = await fetch('/api/stripe/create-checkout', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setPurchasing(false)
  }

  async function updateListing(id: string, updates: { is_saved?: boolean; is_dismissed?: boolean; vote?: number | null }) {
    const res = await fetch('/api/listings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      console.error('Failed to update listing:', res.status, body)
      return
    }
    if (updates.is_dismissed) {
      setListings(prev => prev.filter(l => l.id !== id))
    } else {
      setListings(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    }
    // Check if a new priority suggestion was generated after this vote
    if (updates.vote !== undefined) {
      fetch('/api/preferences').then(r => r.json()).then(prefs => {
        if (prefs?.priorities_suggestion) {
          setPrioritySuggestion(prefs.priorities_suggestion)
          setPriorityInsight(prefs.priorities_insight ?? null)
        }
      }).catch(() => { /* non-critical */ })
    }
  }

  // Create a check-in session and seed the opening message when a suggestion first appears
  useEffect(() => {
    if (!prioritySuggestion || checkInSessionId) return
    fetch('/api/chat/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'check-in', context: { insight: priorityInsight, suggestion: prioritySuggestion } }),
    }).then(r => r.json()).then(s => setCheckInSessionId(s.id)).catch(() => {})
    setCheckInMessages(priorityInsight ? [{ role: 'assistant' as const, content: priorityInsight }] : [])
    setCheckInMinimized(false)
  }, [prioritySuggestion, checkInSessionId, priorityInsight])

  useEffect(() => {
    if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
  }, [checkInMessages])

  // Reset to "All" if the selected neighborhood tab no longer has any listings
  useEffect(() => {
    if (activeNeighborhoodTab === 'all') return
    const stillExists = listings.some(ul => ul.search_run?.neighborhood_label === activeNeighborhoodTab)
    if (!stillExists) setActiveNeighborhoodTab('all')
  }, [listings, activeNeighborhoodTab])

  async function sendCheckIn() {
    const text = checkInInput.trim()
    if (!text || checkInSending) return
    setCheckInInput('')
    setCheckInMessages(prev => [...prev, { role: 'user', content: text }])
    setCheckInSending(true)
    try {
      const messageToSend = !checkInConversationId && priorityInsight
        ? `Scoring insight from my votes: ${priorityInsight}\n\nMy response: ${text}`
        : text
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageToSend, conversationId: checkInConversationId, intent: 'check-in' }),
      })
      const data = await res.json()
      if (data.message?.content) setCheckInMessages(prev => [...prev, { role: 'assistant', content: data.message.content }])
      if (data.conversationId && !checkInConversationId) setCheckInConversationId(data.conversationId)
    } catch (err) {
      console.error('Check-in send error:', err)
    } finally {
      setCheckInSending(false)
    }
  }

  async function applyCheckIn() {
    const lastUserReply = [...checkInMessages].reverse().find(m => m.role === 'user')?.content
    await fetch('/api/preferences/apply-priorities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastUserReply ? { reply: lastUserReply } : {}),
    })
    if (checkInSessionId) {
      fetch(`/api/chat/sessions/${checkInSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      }).catch(() => {})
    }
    setPrioritySuggestion(null)
    setPriorityInsight(null)
    setCheckInSessionId(null)
    setCheckInConversationId(null)
    setCheckInMessages([])
    setCheckInMinimized(false)
  }

  async function dismissCheckIn() {
    if (checkInSessionId) {
      fetch(`/api/chat/sessions/${checkInSessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      }).catch(() => {})
    }
    setPrioritySuggestion(null)
    setPriorityInsight(null)
    setCheckInSessionId(null)
    setCheckInConversationId(null)
    setCheckInMessages([])
    setCheckInMinimized(false)
  }

  return (
    <>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Listings</h1>
          <p className="text-gray-500 text-sm mt-1">Apartments scored against your preferences.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setSavedOnly(!savedOnly)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${savedOnly ? 'bg-indigo-600 text-white' : 'border border-gray-300 text-gray-600'}`}
          >
            {savedOnly ? 'All listings' : 'Saved only'}
          </button>
          <button
            onClick={rescoreListings}
            disabled={rescoring || searching}
            className="border border-gray-300 text-gray-600 px-4 py-1.5 rounded-lg text-sm font-medium hover:border-gray-400 disabled:opacity-50"
          >
            {rescoring ? 'Re-scoring…' : 'Re-score'}
          </button>
          {plan !== 'pro' && neighborhoods.length > 0 && (
            <select
              value={selectedNeighborhoodId}
              onChange={e => setSelectedNeighborhoodId(e.target.value)}
              disabled={searching}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {neighborhoods.map(n => (
                <option key={n.id} value={n.id}>{n.neighborhood}, {n.city}</option>
              ))}
            </select>
          )}
          {plan !== 'pro' && neighborhoods.length === 0 && (
            <Link href="/neighborhoods" className="text-xs text-indigo-600 self-center hover:underline">
              Add a neighborhood first
            </Link>
          )}
          <button
            onClick={runSearch}
            disabled={searching || (plan !== 'pro' && neighborhoods.length === 0)}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Run search'}
          </button>
        </div>
      </div>

      {hadSearchError && !searching && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800 flex items-center justify-between">
          <span>We saved your preferences, but couldn&apos;t start your first search automatically.</span>
          <button
            onClick={runSearch}
            className="ml-4 text-xs font-medium text-amber-700 hover:text-amber-900 underline shrink-0"
          >
            Retry search
          </button>
        </div>
      )}

      {searching && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-700 flex items-center justify-between">
          <span>
            Searching listings and scoring them with AI… this takes 1-2 minutes.
            {searchStatus && <span className="ml-2 font-medium capitalize">{searchStatus}</span>}
          </span>
          <button
            onClick={cancelSearch}
            className="ml-4 text-xs text-indigo-500 hover:text-red-600 underline shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {scraperWarnings.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-800 flex items-start justify-between">
          <div>
            <p className="font-medium mb-1">Some sources failed to start:</p>
            <ul className="list-disc list-inside space-y-0.5">
              {scraperWarnings.map((w, i) => (
                <li key={i} className="text-yellow-700">{w}</li>
              ))}
            </ul>
            <p className="mt-1 text-yellow-600 text-xs">Results from working sources will still appear.</p>
          </div>
          <button
            onClick={() => setScraperWarnings([])}
            className="ml-4 text-yellow-500 hover:text-yellow-700 text-xs underline shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {searchTimedOut && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          The search is taking longer than expected — some sources may have failed to return results. Try running a new search.
        </div>
      )}

      {showPaywall && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-900 flex items-center justify-between gap-4">
          <p>You&apos;ve used your 3 free searches. Get 3 more for $5.</p>
          <button
            onClick={buyCredits}
            disabled={purchasing}
            className="shrink-0 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {purchasing ? 'Redirecting…' : 'Get 3 more for $5'}
          </button>
        </div>
      )}

      {loading && <div className="text-sm text-gray-400">Loading…</div>}

      {!loading && listings.length === 0 && !searching && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          {hasSearched ? (
            <>
              <p className="text-gray-400 text-sm mb-1">No listings found.</p>
              <p className="text-gray-400 text-xs mb-4">Try adjusting your neighborhoods or run another search.</p>
              <button
                onClick={runSearch}
                disabled={searching}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Run search again
              </button>
            </>
          ) : (
            <>
              <p className="text-gray-400 text-sm mb-4">No listings yet.</p>
              <button
                onClick={runSearch}
                disabled={searching}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                Run your first search
              </button>
            </>
          )}
        </div>
      )}

      {deepDiveListing && (
        <DeepDiveModal listing={deepDiveListing} onClose={() => setDeepDiveListing(null)} />
      )}

      {!loading && listings.length > 0 && (() => {
        const hiddenCount = listings.filter(ul => ul.score != null && ul.score < MIN_DISPLAY_SCORE).length
        return hiddenCount > 0 ? (
          <p className="text-xs text-gray-400">{hiddenCount} weaker match{hiddenCount === 1 ? '' : 'es'} hidden</p>
        ) : null
      })()}

      {!loading && listings.length > 0 && (() => {
        const labels = Array.from(new Set(
          listings.map(ul => ul.search_run?.neighborhood_label).filter((l): l is string => !!l)
        ))
        if (labels.length === 0) return null
        const tabClass = (active: boolean) =>
          `px-3 py-2 text-sm font-medium border-b-2 -mb-px ${
            active ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'
          }`
        return (
          <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
            <button onClick={() => setActiveNeighborhoodTab('all')} className={tabClass(activeNeighborhoodTab === 'all')}>
              All
            </button>
            {labels.map(label => (
              <button key={label} onClick={() => setActiveNeighborhoodTab(label)} className={tabClass(activeNeighborhoodTab === label)}>
                {label}
              </button>
            ))}
          </div>
        )
      })()}

      <div className="space-y-4">
        {(() => {
          const visibleListings = listings.filter(ul =>
            (ul.score == null || ul.score >= MIN_DISPLAY_SCORE) &&
            (activeNeighborhoodTab === 'all' || ul.search_run?.neighborhood_label === activeNeighborhoodTab)
          )
          const sourceTopIds = new Set<string>()
          const seenSources = new Set<string>()
          visibleListings.forEach(ul => {
            const source = ul.listing?.source
            if (source && !seenSources.has(source)) {
              seenSources.add(source)
              sourceTopIds.add(ul.id)
            }
          })
          return visibleListings.map(ul => {
          const l = ul.listing!
          const isSourceTop = sourceTopIds.has(ul.id)
          return (
            <div key={ul.id} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <ScoreBadge score={ul.score} />
                    <span className="text-xs text-gray-400">
                      {ul.rank != null && ul.total != null ? `#${ul.rank} of ${ul.total} · ` : ''}
                      {sourceLabel(l?.source)}
                      {isSourceTop ? ' · Top match' : ''}
                    </span>
                  </div>
                  <p className="font-semibold text-gray-900 truncate">{l?.address || l?.title || 'Listing'}</p>
                  <p className="text-sm text-gray-500">
                    ${((l?.rent || 0) / 100).toLocaleString()}/mo
                    {l?.bedrooms ? ` · ${l.bedrooms}bd` : ''}
                    {l?.bathrooms ? ` ${l.bathrooms}ba` : ''}
                    {l?.sqft ? ` · ${l.sqft.toLocaleString()} sqft` : ''}
                  </p>
                  {l?.neighborhood && (
                    <p className="text-xs text-gray-400 mt-0.5">{l.neighborhood}, {l.city}</p>
                  )}
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <a
                    href={l?.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-indigo-600 hover:underline whitespace-nowrap"
                  >
                    View listing →
                  </a>
                  <div className="flex gap-1.5 flex-wrap justify-end">
                    <button
                      onClick={() => updateListing(ul.id, { vote: ul.vote === 1 ? null : 1 })}
                      className={`text-xs px-2 py-1 rounded border ${ul.vote === 1 ? 'bg-green-100 text-green-700 border-green-200' : 'border-gray-200 text-gray-400 hover:border-green-300 hover:text-green-600'}`}
                      title="Good fit"
                    >
                      Good fit
                    </button>
                    <button
                      onClick={() => updateListing(ul.id, { vote: ul.vote === -1 ? null : -1 })}
                      className={`text-xs px-2 py-1 rounded border ${ul.vote === -1 ? 'bg-red-50 text-red-600 border-red-200' : 'border-gray-200 text-gray-400 hover:border-red-200 hover:text-red-500'}`}
                      title="Bad fit"
                    >
                      Bad fit
                    </button>
                    <button
                      onClick={() => updateListing(ul.id, { is_saved: !ul.is_saved })}
                      className={`text-xs px-2 py-1 rounded ${ul.is_saved ? 'bg-green-100 text-green-700' : 'border border-gray-200 text-gray-500 hover:border-gray-300'}`}
                    >
                      {ul.is_saved ? 'Saved' : 'Save'}
                    </button>
                    <button
                      onClick={() => updateListing(ul.id, { is_dismissed: true })}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
              {ul.score != null && (
                <button
                  onClick={() => setDeepDiveListing(ul)}
                  className="mt-3 pt-3 border-t border-gray-100 text-xs text-indigo-400 hover:text-indigo-600"
                >
                  Why this score?
                </button>
              )}
            </div>
          )
        })
        })()}
      </div>
    </div>

    {prioritySuggestion && (
      <div className="fixed bottom-6 right-6 z-40 w-[calc(100vw-3rem)] max-w-sm">
        {checkInMinimized ? (
          <button
            onClick={() => setCheckInMinimized(false)}
            className="ml-auto flex items-center gap-2 bg-violet-600 text-white pl-3 pr-4 py-2.5 rounded-full shadow-lg hover:bg-violet-700 text-sm font-medium"
          >
            <span className="shrink-0 w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold">AI</span>
            Scoring insight ready
          </button>
        ) : (
          <div className="bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm space-y-3 shadow-2xl max-h-[75vh] overflow-y-auto">
            <div className="flex items-center gap-2">
              <span className="shrink-0 w-6 h-6 rounded-full bg-violet-200 text-violet-700 flex items-center justify-center text-xs font-bold">AI</span>
              <p className="font-medium text-violet-800 flex-1">Scoring insight based on your votes</p>
              <button
                onClick={() => setCheckInMinimized(true)}
                className="shrink-0 text-violet-400 hover:text-violet-700 text-lg leading-none px-1"
                aria-label="Minimize"
                title="Minimize"
              >
                ×
              </button>
            </div>
            <div className="flex gap-2 flex-wrap pl-8">
              {Object.entries(prioritySuggestion).map(([dim, level]) => (
                <span key={dim} className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                  level === 'high' ? 'bg-violet-100 text-violet-700 border-violet-200' :
                  level === 'low'  ? 'bg-gray-50 text-gray-500 border-gray-200' :
                                     'bg-white text-violet-600 border-violet-100'
                }`}>
                  {dim}: {level}
                </span>
              ))}
            </div>
            <div ref={chatScrollRef} className="pl-8 space-y-2 max-h-60 overflow-y-auto">
              {checkInMessages.map((msg, i) => (
                msg.role === 'assistant' ? (
                  <p key={i} className="text-violet-700 leading-relaxed">{msg.content}</p>
                ) : (
                  <p key={i} className="text-gray-700 bg-white rounded-lg px-3 py-2 border border-violet-100">{msg.content}</p>
                )
              ))}
              {checkInSending && <p className="text-violet-400 text-xs animate-pulse">Thinking…</p>}
            </div>
            <div className="flex gap-2 items-center pl-8">
              <input
                value={checkInInput}
                onChange={e => setCheckInInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !checkInSending) { e.preventDefault(); sendCheckIn() } }}
                placeholder="Reply to the AI…"
                className="flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-400"
                disabled={checkInSending}
              />
              <button
                onClick={sendCheckIn}
                disabled={checkInSending || !checkInInput.trim()}
                className="shrink-0 text-xs bg-violet-600 text-white px-3 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-50 font-medium"
              >
                Send
              </button>
            </div>
            <div className="flex gap-2 pl-8">
              <button
                onClick={applyCheckIn}
                className="text-xs bg-violet-600 text-white px-3 py-1 rounded-lg hover:bg-violet-700 font-medium"
              >
                Apply these weights
              </button>
              <button
                onClick={dismissCheckIn}
                className="text-xs text-violet-500 hover:text-violet-700 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    )}
    </>
  )
}

export default function ListingsPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <ListingsContent />
    </Suspense>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const scoreColor = score >= 80 ? 'bg-green-100 text-green-700' : score >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'
  const tierColor = score >= 80 ? 'bg-green-50 text-green-600 border-green-100' : score >= 60 ? 'bg-yellow-50 text-yellow-600 border-yellow-100' : score >= 40 ? 'bg-gray-50 text-gray-500 border-gray-100' : 'bg-red-50 text-red-500 border-red-100'
  return (
    <span className="inline-flex items-center gap-1.5 flex-shrink-0">
      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreColor}`}>{score}/100</span>
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${tierColor}`}>{scoreTier(score)}</span>
    </span>
  )
}

function sourceLabel(source?: string): string {
  if (!source) return 'this source'
  const map: Record<string, string> = {
    apartments_com: 'Apartments.com',
    craigslist: 'Craigslist',
    trulia: 'Trulia',
    zillow: 'Zillow',
  }
  return map[source] ?? source.replace('_', '.')
}

type ChatMessage = { role: 'user' | 'assistant'; content: string }

function DeepDiveModal({ listing, onClose }: { listing: UserListing; onClose: () => void }) {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, sending])

  useEffect(() => {
    async function init() {
      setSending(true)
      try {
        const sessionRes = await fetch('/api/chat/sessions/deep-dive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_listing_id: listing.id }),
        })
        const session = await sessionRes.json()
        if (!session.id) return
        setSessionId(session.id)

        if (Array.isArray(session.messages) && session.messages.length > 0) {
          // Resuming an existing thread for this listing — don't re-send the opener.
          setMessages(session.messages)
          return
        }

        const openingMessage = [
          `Explain why this listing scored ${listing.score}/100.`,
          `Score breakdown: ${JSON.stringify(listing.score_breakdown ?? {})}`,
          `Reasoning: ${listing.score_reasoning ?? 'No reasoning provided.'}`,
        ].join('\n\n')

        const chatRes = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: openingMessage, sessionId: session.id }),
        })
        const data = await chatRes.json()
        if (data.message?.content) setMessages([{ role: 'assistant', content: data.message.content }])
      } catch (err) {
        console.error('Deep-dive init error:', err)
      } finally {
        setSending(false)
      }
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleClose() {
    if (sessionId) {
      fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved' }),
      }).catch(() => {})
    }
    onClose()
  }

  async function send() {
    const text = input.trim()
    if (!text || sending) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setSending(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      })
      const data = await res.json()
      if (data.message?.content) setMessages(prev => [...prev, { role: 'assistant', content: data.message.content }])
    } catch (err) {
      console.error('Deep-dive send error:', err)
    } finally {
      setSending(false)
    }
  }

  const l = listing.listing!
  const title = l?.address || l?.title || 'Listing'

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={handleClose} />
      <div className="w-full max-w-lg bg-white shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate text-sm">{title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <ScoreBadge score={listing.score} />
            </div>
          </div>
          <button
            onClick={handleClose}
            className="ml-4 shrink-0 text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.length === 0 && sending && (
            <p className="text-sm text-gray-400 animate-pulse">Analyzing…</p>
          )}
          {messages.map((msg, i) =>
            msg.role === 'assistant' ? (
              <div key={i} className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{msg.content}</div>
            ) : (
              <div key={i} className="flex justify-end">
                <div className="bg-indigo-600 text-white text-sm px-3 py-2 rounded-xl max-w-xs leading-relaxed">{msg.content}</div>
              </div>
            )
          )}
          {messages.length > 0 && sending && (
            <p className="text-xs text-gray-400 animate-pulse">Thinking…</p>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !sending) { e.preventDefault(); send() } }}
            placeholder="Ask a follow-up question…"
            disabled={sending}
            className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="shrink-0 bg-indigo-600 text-white text-sm px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { UserListing } from '@/types'

export default function ListingsPage() {
  const [listings, setListings] = useState<UserListing[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [searchRunId, setSearchRunId] = useState<string | null>(null)
  const [savedOnly, setSavedOnly] = useState(false)
  const [searchStatus, setSearchStatus] = useState<string | null>(null)

  const loadListings = useCallback(async () => {
    const res = await fetch(`/api/listings${savedOnly ? '?saved=true' : ''}`)
    const data = await res.json()
    setListings(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [savedOnly])

  useEffect(() => { loadListings() }, [loadListings])

  // On load, check if there's already a running search and resume polling
  useEffect(() => {
    async function checkRunning() {
      const res = await fetch('/api/search')
      const runs = await res.json()
      const running = Array.isArray(runs) ? runs.find((r: { status: string; id: string }) => r.status === 'running') : null
      if (running) {
        setSearching(true)
        setSearchStatus('running')
        setSearchRunId(running.id)
      }
    }
    checkRunning()
  }, [])

  // Poll search run status
  useEffect(() => {
    if (!searchRunId) return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/search?runId=${searchRunId}`)
      const run = await res.json()
      setSearchStatus(run.status)
      if (run.status === 'completed' || run.status === 'failed') {
        clearInterval(interval)
        setSearching(false)
        setSearchRunId(null)
        if (run.status === 'completed') loadListings()
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [searchRunId, loadListings])

  async function runSearch() {
    setSearching(true)
    setSearchStatus('running')
    const res = await fetch('/api/search', { method: 'POST' })
    const data = await res.json()
    if (data.error) {
      if (data.upgrade) {
        window.location.href = '/upgrade'
        return
      }
      alert(data.error)
      setSearching(false)
      return
    }
    setSearchRunId(data.searchRunId)
  }

  async function updateListing(id: string, updates: { is_saved?: boolean; is_dismissed?: boolean }) {
    await fetch('/api/listings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...updates }),
    })
    if (updates.is_dismissed) {
      setListings(prev => prev.filter(l => l.id !== id))
    } else {
      setListings(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l))
    }
  }

  return (
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
            onClick={runSearch}
            disabled={searching}
            className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {searching ? 'Searching…' : 'Run search'}
          </button>
        </div>
      </div>

      {searching && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4 text-sm text-indigo-700">
          Scraping listings and scoring them with AI… this takes 1-2 minutes.
          {searchStatus && <span className="ml-2 font-medium capitalize">{searchStatus}</span>}
        </div>
      )}

      {loading && <div className="text-sm text-gray-400">Loading…</div>}

      {!loading && listings.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm mb-4">No listings yet.</p>
          <button
            onClick={runSearch}
            disabled={searching}
            className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            Run your first search
          </button>
        </div>
      )}

      <div className="space-y-4">
        {listings.map(ul => {
          const l = ul.listing!
          return (
            <div key={ul.id} className="bg-white border border-gray-200 rounded-xl p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <ScoreBadge score={ul.score} />
                    <span className="text-xs text-gray-400 capitalize">{l?.source?.replace('_', '.')}</span>
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
                  <div className="flex gap-2">
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
              {ul.score_reasoning && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-500 leading-relaxed">{ul.score_reasoning}</p>
                </div>
              )}
              {ul.score_breakdown && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {Object.entries(ul.score_breakdown).map(([key, val]) => (
                    <span key={key} className="text-xs bg-gray-50 border border-gray-100 px-2 py-0.5 rounded text-gray-500">
                      {key}: <strong>{val}</strong>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-100 text-green-700' : score >= 60 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>{score}/100</span>
  )
}

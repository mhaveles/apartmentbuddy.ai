'use client'

import { useState, useEffect } from 'react'
import { Neighborhood } from '@/types'

export default function NeighborhoodsPage() {
  const [neighborhoods, setNeighborhoods] = useState<Neighborhood[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ neighborhood: '', city: '', state: '', zip_code: '' })
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/neighborhoods')
      .then(r => r.json())
      .then(data => { setNeighborhoods(data); setLoading(false) })
  }, [])

  async function addNeighborhood(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    const res = await fetch('/api/neighborhoods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (data.error) {
      setError(data.error)
    } else {
      setNeighborhoods(prev => [data, ...prev])
      setForm({ neighborhood: '', city: '', state: '', zip_code: '' })
    }
    setSaving(false)
  }

  async function removeNeighborhood(id: string) {
    await fetch(`/api/neighborhoods?id=${id}`, { method: 'DELETE' })
    setNeighborhoods(prev => prev.filter(n => n.id !== id))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Neighborhoods</h1>
        <p className="text-gray-500 text-sm mt-1">Add areas to monitor for new listings.</p>
      </div>

      {/* Add form */}
      <div className="bg-white border border-gray-200 rounded-xl p-6">
        <h2 className="font-semibold text-gray-900 mb-4">Add a neighborhood</h2>
        <form onSubmit={addNeighborhood} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 md:col-span-1">
            <label className="block text-xs font-medium text-gray-600 mb-1">Neighborhood</label>
            <input
              value={form.neighborhood}
              onChange={e => setForm(p => ({ ...p, neighborhood: e.target.value }))}
              placeholder="e.g. Williamsburg"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">City</label>
            <input
              value={form.city}
              onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
              placeholder="e.g. Brooklyn"
              required
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">State</label>
            <input
              value={form.state}
              onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
              placeholder="e.g. NY"
              required
              maxLength={2}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">ZIP code (optional)</label>
            <input
              value={form.zip_code}
              onChange={e => setForm(p => ({ ...p, zip_code: e.target.value }))}
              placeholder="e.g. 11211"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          {error && <p className="col-span-2 text-red-500 text-sm">{error}</p>}
          <div className="col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Adding…' : 'Add neighborhood'}
            </button>
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100">
        {loading && (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        )}
        {!loading && neighborhoods.length === 0 && (
          <div className="p-6 text-sm text-gray-400">No neighborhoods yet. Add one above.</div>
        )}
        {neighborhoods.map(n => (
          <div key={n.id} className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-gray-900">{n.neighborhood}</p>
              <p className="text-xs text-gray-500">{n.city}, {n.state}{n.zip_code ? ` · ${n.zip_code}` : ''}</p>
            </div>
            <button
              onClick={() => removeNeighborhood(n.id)}
              className="text-sm text-red-400 hover:text-red-600"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

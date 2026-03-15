'use client'

import { useState } from 'react'

export default function UpgradePage() {
  const [loading, setLoading] = useState(false)

  async function handleUpgrade() {
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', { method: 'POST' })
    const data = await res.json()
    if (data.url) window.location.href = data.url
    else setLoading(false)
  }

  return (
    <div className="max-w-xl mx-auto py-12">
      <h1 className="text-3xl font-bold text-gray-900 text-center mb-3">Upgrade to Pro</h1>
      <p className="text-gray-500 text-center mb-10">Get continuous monitoring so you never miss the perfect apartment.</p>

      <div className="bg-indigo-600 rounded-2xl p-8 text-white mb-6">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h2 className="text-xl font-bold">Pro Plan</h2>
            <p className="text-indigo-200 text-sm mt-1">Everything you need to find home</p>
          </div>
          <div className="text-right">
            <span className="text-4xl font-black">$29</span>
            <span className="text-indigo-300">/mo</span>
          </div>
        </div>
        <ul className="space-y-3 text-sm">
          {[
            'Listings checked every 6 hours',
            'New matches delivered instantly',
            'Unlimited neighborhoods',
            'AI-powered scoring on every listing',
            'Save & track your favorites',
            'Cancel anytime',
          ].map(f => (
            <li key={f} className="flex items-center gap-2">
              <span className="text-indigo-300">✓</span> {f}
            </li>
          ))}
        </ul>
      </div>

      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="w-full bg-indigo-600 text-white py-4 rounded-xl text-base font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-lg shadow-indigo-200"
      >
        {loading ? 'Redirecting to checkout…' : 'Start Pro — $29/month'}
      </button>
      <p className="text-xs text-gray-400 text-center mt-3">Secure checkout via Stripe. Cancel anytime.</p>
    </div>
  )
}

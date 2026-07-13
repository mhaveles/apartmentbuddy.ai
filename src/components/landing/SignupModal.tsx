'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { clearAnonSessionId } from '@/lib/anon-session-cookie'

export default function SignupModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [needsConfirm, setNeedsConfirm] = useState(false)

  async function migrateAndRedirect() {
    try {
      const res = await fetch('/api/auth/migrate-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const data = await res.json()

      if (res.ok && data.searchRunId) {
        clearAnonSessionId()
        router.push(`/search/loading?runId=${data.searchRunId}`)
        return
      }
      if (res.ok && data.needsNeighborhood) {
        clearAnonSessionId()
        router.push('/neighborhoods?onboarding=1')
        return
      }
      if (res.ok && data.searchError) {
        // Conversation + preferences + neighborhoods migrated fine — only the
        // scrape trigger failed. Send them to the retry surface, not a blind redirect.
        clearAnonSessionId()
        router.push('/listings?searchError=1')
        return
      }
      // 404 (session not found) or 409 (already converted elsewhere) — nothing
      // migrated here. Flag it so /chat doesn't render an unexplained blank slate.
      router.push('/chat?intakeIssue=1')
    } catch {
      router.push('/chat?intakeIssue=1')
    }
  }

  async function handleEmailSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const supabase = createClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else if (data.session) {
      await migrateAndRedirect()
    } else {
      setNeedsConfirm(true)
      setLoading(false)
    }
  }

  async function handleGoogleSignup() {
    setLoading(true)
    setError('')
    const supabase = createClient()
    const redirectTo = `${window.location.origin}/auth/callback?sessionId=${encodeURIComponent(sessionId)}&next=/search/loading`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/20 backdrop-blur-[2px] flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-lg border border-gray-100 w-full max-w-md p-8 relative"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <h2 className="text-2xl font-bold text-gray-900 mb-2">Save your search</h2>

        {needsConfirm ? (
          <p className="text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg px-3 py-2">
            Check your email for a confirmation link, then sign in to see your matches.
          </p>
        ) : (
          <>
            <p className="text-gray-500 text-sm mb-6">
              Create a free account so we can save what you told us and start searching for matches —
              everything from this chat carries over, so you won&apos;t repeat yourself. We never sell
              or share your info. No credit card required.
            </p>

            <button
              onClick={handleGoogleSignup}
              disabled={loading}
              className="w-full border border-gray-300 rounded-lg py-2.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50 mb-4"
            >
              Continue with Google
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <form onSubmit={handleEmailSignup} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {loading ? 'Creating account…' : 'Create free account'}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}

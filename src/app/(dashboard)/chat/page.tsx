'use client'

import { Suspense, useState, useEffect, useRef, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Message } from '@/types'

const INITIAL_MESSAGE: Message = {
  role: 'assistant',
  content: "Hi! I'm ApartmentBuddy. Let's get your search set up — tell me what you're looking for:\n\n- Budget (monthly rent)\n- Location (city, neighborhood, or ZIP)\n- Bedrooms / bathrooms\n- Must-haves (parking, in-unit laundry, pets, etc.)\n- Any deal-breakers\n\nFeel free to answer all of this in one message — whatever you don't mention yet, I'll ask about.",
  timestamp: new Date().toISOString(),
}

function ChatContent() {
  const searchParams = useSearchParams()
  const hadIntakeIssue = searchParams.get('intakeIssue') === '1'
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [preferencesExtracted, setPreferencesExtracted] = useState(false)
  const [hasNeighborhoods, setHasNeighborhoods] = useState(true)
  const [restoring, setRestoring] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [input])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    async function restore() {
      let hasPreferences = false

      let prefs: Record<string, unknown> | null = null
      try {
        const prefsRes = await fetch('/api/preferences')
        if (prefsRes.ok) prefs = await prefsRes.json()
      } catch {}
      const neighborhoodsList = Array.isArray(prefs?.neighborhoods) ? prefs!.neighborhoods as unknown[] : []
      setHasNeighborhoods(neighborhoodsList.length > 0)
      if (prefs && Object.keys(prefs).length > 0) hasPreferences = true

      try {
        const res = await fetch('/api/chat/sessions/preferences', { method: 'POST' })
        if (res.ok) {
          const data = await res.json()
          setSessionId(data.id)
          if (Array.isArray(data.messages) && data.messages.length > 0) {
            setMessages(data.messages)
          }
          if (data.intent === 'refinement') hasPreferences = true
        }
      } catch {}

      setPreferencesExtracted(hasPreferences)
      setRestoring(false)
    }
    restore()
  }, [])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${data.error || res.statusText}`,
          timestamp: new Date().toISOString(),
        }])
      } else {
        setMessages(prev => [...prev, data.message])
        if (typeof data.hasNeighborhoods === 'boolean') setHasNeighborhoods(data.hasNeighborhoods)
        if (data.preferencesExtracted) setPreferencesExtracted(true)
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setLoading(false)
    }
  }, [loading, sessionId])

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    sendMessage(input)
  }

  if (restoring) {
    return (
      <div className="flex flex-col h-[calc(100vh-4rem)] items-center justify-center">
        <p className="text-sm text-gray-400">Loading your conversation…</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Preferences</h1>
          <p className="text-gray-500 text-sm">Chat with AI to set your apartment criteria.</p>
        </div>
        {sessionId && (
          <Link
            href="/chat"
            className="text-xs text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg px-3 py-1.5"
          >
            Start fresh
          </Link>
        )}
      </div>

      {hadIntakeIssue && !sessionId && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 text-sm text-gray-600 mb-4">
          We couldn&apos;t recover the answers from your earlier chat — no worries, let&apos;s pick up here.
        </div>
      )}

      {preferencesExtracted && hasNeighborhoods && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 mb-4 flex items-center justify-between">
          <span><span className="mr-1">✓</span> Got your preferences. <a href="/listings" className="font-medium underline">Run your first search</a> to see matching listings.</span>
          <Link href="/chat" className="text-xs text-green-600 hover:text-green-800 underline ml-4 shrink-0">Update preferences</Link>
        </div>
      )}

      {preferencesExtracted && !hasNeighborhoods && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 mb-4 flex items-center justify-between">
          <span><span className="mr-1">⚠</span> Got your other preferences, but I still need at least one neighborhood to search. <a href="/neighborhoods" className="font-medium underline">Add one</a> to get started.</span>
          <Link href="/chat" className="text-xs text-amber-700 hover:text-amber-900 underline ml-4 shrink-0">Update preferences</Link>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-indigo-600 text-white rounded-tr-sm'
                : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm'
            }`}>
              {msg.content.replace(/```json[\s\S]*?```/g, '').trim()}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1.5">
                <div className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-3 pt-4 border-t border-gray-200 items-end">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type your message… (Shift+Enter for new line)"
          disabled={loading}
          rows={1}
          className="flex-1 border border-gray-300 rounded-xl px-4 py-3 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-none overflow-hidden leading-relaxed"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-indigo-600 text-white px-5 py-3 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shrink-0"
        >
          Send
        </button>
      </form>
    </div>
  )
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="text-sm text-gray-400">Loading…</div>}>
      <ChatContent />
    </Suspense>
  )
}

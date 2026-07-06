'use client'

import { useEffect, useRef, useState } from 'react'
import SignupModal from './SignupModal'
import { getAnonSessionId, setAnonSessionId } from '@/lib/anon-session-cookie'

type ChatMessage = { role: 'user' | 'assistant'; content: string }

export default function LandingChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: "Hi! I'm ApartmentBuddy. Tell me about the apartment you're looking for:\n\n- Budget (monthly rent)\n- Location (city or neighborhood)\n- Bedrooms / bathrooms\n- Must-haves (parking, in-unit laundry, pets, etc.)\n- Any deal-breakers\n\nFeel free to answer all at once, or just start with what you know." },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [showSignup, setShowSignup] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, loading])

  async function sendMessage(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return

    let currentSessionId = sessionId
    if (!currentSessionId) {
      currentSessionId = getAnonSessionId() || crypto.randomUUID()
      setAnonSessionId(currentSessionId)
      setSessionId(currentSessionId)
    }

    setMessages(prev => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/chat/anonymous', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSessionId, message: trimmed }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong. Please try again.')
        return
      }

      setMessages(prev => [...prev, { role: 'assistant', content: data.message.content }])
      if (data.promptSignup) {
        setShowSignup(true)
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleInput(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm max-w-2xl mx-auto flex flex-col h-[70vh] max-h-[560px] min-h-[360px]">
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 text-gray-400 rounded-2xl px-4 py-2.5 text-sm">Thinking…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <p className="text-red-500 text-sm px-6">{error}</p>}

      <form onSubmit={sendMessage} className="border-t border-gray-100 p-4 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder="Type your answer…"
          disabled={loading}
          className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-none overflow-y-auto max-h-32 leading-relaxed"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          Send
        </button>
      </form>

      {showSignup && sessionId && (
        <SignupModal sessionId={sessionId} onClose={() => setShowSignup(false)} />
      )}
    </div>
  )
}

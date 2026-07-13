import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropic, getSystemPrompt, ChatIntent } from '@/lib/anthropic'
import { extractPreferencesJson, applyExtractedPreferences } from '@/lib/preferences'
import { Message } from '@/types'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized — not logged in' }, { status: 401 })
    }

    const { message, sessionId, conversationId, intent }: {
      message: string
      sessionId?: string
      conversationId?: string
      intent?: ChatIntent
    } = await req.json()

    // A sessionId (chat_sessions.id) means this is a durable preferences or
    // deep-dive thread — the session, not the client, owns which conversation
    // and which intent/prompt apply. check-in keeps using conversationId/intent
    // directly, since it's deliberately not persisted this way.
    let session: { id: string; intent: ChatIntent; conversation_id: string | null } | null = null
    if (sessionId) {
      const { data } = await supabase
        .from('chat_sessions')
        .select('id, intent, conversation_id')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .single()
      if (!data) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 })
      }
      session = data
    }

    const effectiveIntent: ChatIntent | undefined = session ? session.intent : intent

    // Get or create conversation
    let conversation
    let linkedNewConversation = false
    const resolvedConversationId = session?.conversation_id ?? conversationId

    if (resolvedConversationId) {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', resolvedConversationId)
        .eq('user_id', user.id)
        .single()
      conversation = data
    }

    if (!conversation) {
      const { data } = await supabase
        .from('conversations')
        .insert({ user_id: user.id, messages: [] })
        .select()
        .single()
      conversation = data
      if (session) linkedNewConversation = true
    }

    if (!conversation) {
      return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
    }

    const messages: Message[] = conversation.messages || []
    const newUserMessage: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    }
    messages.push(newUserMessage)

    // Call Claude
    const response = await getAnthropic().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: getSystemPrompt(effectiveIntent),
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    })

    const assistantContent = response.content[0].type === 'text' ? response.content[0].text : ''

    const newAssistantMessage: Message = {
      role: 'assistant',
      content: assistantContent,
      timestamp: new Date().toISOString(),
    }
    messages.push(newAssistantMessage)

    // Check if preferences JSON is in the response (only relevant for onboarding/refinement)
    let preferencesExtracted = conversation.preferences_extracted
    let hasNeighborhoods: boolean | undefined
    const shouldExtractPrefs = !effectiveIntent || effectiveIntent === 'onboarding' || effectiveIntent === 'refinement'
    const prefs = shouldExtractPrefs ? extractPreferencesJson(assistantContent) : null
    if (prefs) {
      const applied = await applyExtractedPreferences(supabase, user.id, prefs)
      if (applied.preferencesSaved) preferencesExtracted = true
      hasNeighborhoods = applied.hasNeighborhoods
    }

    // Save updated conversation
    await supabase
      .from('conversations')
      .update({
        messages,
        preferences_extracted: preferencesExtracted,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversation.id)

    // Keep the chat_sessions pointer in sync in one write: link a newly-created
    // conversation, flip onboarding -> refinement once preferences are extracted,
    // and stamp last_message_at for a future retention job.
    if (session) {
      const sessionUpdates: Record<string, unknown> = { last_message_at: new Date().toISOString() }
      if (linkedNewConversation) sessionUpdates.conversation_id = conversation.id
      if (session.intent === 'onboarding' && preferencesExtracted) sessionUpdates.intent = 'refinement'
      await supabase.from('chat_sessions').update(sessionUpdates).eq('id', session.id)
    }

    return NextResponse.json({
      message: newAssistantMessage,
      conversationId: conversation.id,
      sessionId: session?.id,
      preferencesExtracted,
      ...(hasNeighborhoods !== undefined && { hasNeighborhoods }),
    })
  } catch (err) {
    console.error('Chat error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

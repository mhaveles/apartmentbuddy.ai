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

    const { message, conversationId, intent }: { message: string; conversationId?: string; intent?: ChatIntent } = await req.json()

    // Get or create conversation
    let conversation
    if (conversationId) {
      const { data } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
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
      system: getSystemPrompt(intent),
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
    const shouldExtractPrefs = !intent || intent === 'onboarding' || intent === 'refinement'
    const prefs = shouldExtractPrefs ? extractPreferencesJson(assistantContent) : null
    if (prefs) {
      const applied = await applyExtractedPreferences(supabase, user.id, prefs)
      if (applied) preferencesExtracted = true
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

    return NextResponse.json({
      message: newAssistantMessage,
      conversationId: conversation.id,
      preferencesExtracted,
    })
  } catch (err) {
    console.error('Chat error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    )
  }
}

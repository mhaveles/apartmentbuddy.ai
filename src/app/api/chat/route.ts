import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, SYSTEM_PROMPT } from '@/lib/anthropic'
import { Message } from '@/types'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { message, conversationId } = await req.json()

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

  const messages: Message[] = conversation.messages || []
  const newUserMessage: Message = {
    role: 'user',
    content: message,
    timestamp: new Date().toISOString(),
  }
  messages.push(newUserMessage)

  // Call Claude
  const response = await anthropic.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  })

  const assistantContent = response.content[0].type === 'text' ? response.content[0].text : ''

  const newAssistantMessage: Message = {
    role: 'assistant',
    content: assistantContent,
    timestamp: new Date().toISOString(),
  }
  messages.push(newAssistantMessage)

  // Check if preferences JSON is in the response
  let preferencesExtracted = conversation.preferences_extracted
  const jsonMatch = assistantContent.match(/```json\n([\s\S]*?)\n```/)
  if (jsonMatch) {
    try {
      const prefs = JSON.parse(jsonMatch[1])
      await supabase
        .from('preferences')
        .upsert({
          user_id: user.id,
          max_rent: prefs.max_rent ? prefs.max_rent * 100 : null, // store in cents
          min_bedrooms: prefs.min_bedrooms || null,
          max_bedrooms: prefs.max_bedrooms || null,
          min_bathrooms: prefs.min_bathrooms || null,
          pet_friendly: prefs.pet_friendly || null,
          parking_required: prefs.parking_required || null,
          in_unit_laundry: prefs.in_unit_laundry || null,
          gym: prefs.gym || null,
          rooftop: prefs.rooftop || null,
          doorman: prefs.doorman || null,
          elevator: prefs.elevator || null,
          outdoor_space: prefs.outdoor_space || null,
          move_in_date: prefs.move_in_date || null,
          lease_length: prefs.lease_length || null,
          other_requirements: prefs.other_requirements || [],
          deal_breakers: prefs.deal_breakers || [],
          summary: prefs.summary || null,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })
      preferencesExtracted = true
    } catch {}
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
}

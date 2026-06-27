import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAnthropic, getSystemPrompt, ChatIntent } from '@/lib/anthropic'
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
    const jsonMatch = shouldExtractPrefs ? assistantContent.match(/```json\n([\s\S]*?)\n```/) : null
    if (jsonMatch) {
      try {
        const prefs = JSON.parse(jsonMatch[1])
        const { error: upsertError } = await supabase
          .from('preferences')
          .upsert({
            user_id: user.id,
            max_rent: prefs.max_rent ? prefs.max_rent * 100 : null,
            min_bedrooms: prefs.min_bedrooms || null,
            max_bedrooms: prefs.max_bedrooms || null,
            min_bathrooms: prefs.min_bathrooms || null,
            pet_friendly: prefs.pet_friendly ?? null,
            parking_required: prefs.parking_required ?? null,
            in_unit_laundry: prefs.in_unit_laundry ?? null,
            air_conditioning: prefs.air_conditioning ?? null,
            gym: prefs.gym ?? null,
            rooftop: prefs.rooftop ?? null,
            doorman: prefs.doorman ?? null,
            elevator: prefs.elevator ?? null,
            outdoor_space: prefs.outdoor_space ?? null,
            move_in_date: prefs.move_in_date || null,
            lease_length: prefs.lease_length || null,
            other_requirements: prefs.other_requirements || [],
            deal_breakers: prefs.deal_breakers || [],
            priorities: prefs.priorities || null,
            summary: prefs.summary || null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
        if (upsertError) {
          console.error('Preferences upsert error:', upsertError)
        } else {
          preferencesExtracted = true
        }

        // Sync neighborhoods: replace all active neighborhoods with the newly extracted ones
        type NeighborhoodInput = { neighborhood: string; city: string; state: string; zip_code?: string | null }
        const extractedNeighborhoods: NeighborhoodInput[] = Array.isArray(prefs.neighborhoods) ? prefs.neighborhoods : []
        if (extractedNeighborhoods.length > 0) {
          await supabase.from('monitored_neighborhoods').delete().eq('user_id', user.id)
          const { error: neighborhoodError } = await supabase
            .from('monitored_neighborhoods')
            .insert(extractedNeighborhoods.map(n => ({
              user_id: user.id,
              neighborhood: n.neighborhood,
              city: n.city,
              state: n.state.toUpperCase(),
              zip_code: n.zip_code || null,
              active: true,
            })))
          if (neighborhoodError) console.error('Neighborhoods upsert error:', neighborhoodError)
        }
      } catch (parseErr) {
        console.error('Preferences parse error:', parseErr)
      }
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

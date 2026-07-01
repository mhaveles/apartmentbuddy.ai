import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { stripe, CREDIT_PACK_SIZE } from '@/lib/stripe'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', user.id)
    .single()

  let customerId = profile?.stripe_customer_id

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email!,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await supabase
      .from('profiles')
      .update({ stripe_customer_id: customerId })
      .eq('id', user.id)
  }

  // Resolve credit amount from the Price's metadata now, at checkout-creation time,
  // and stamp it onto the session itself. This way the webhook (which fires after
  // payment, potentially much later) never needs a follow-up API call back to Stripe
  // to learn how many credits to grant — it just reads session.metadata directly.
  const price = await stripe.prices.retrieve(process.env.STRIPE_PRICE_ID!)
  const priceCredits = Number(price.metadata?.credits)
  const credits = Number.isFinite(priceCredits) && priceCredits > 0 ? priceCredits : CREDIT_PACK_SIZE

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      price: process.env.STRIPE_PRICE_ID!,
      quantity: 1,
    }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/listings?credits=purchased`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/listings`,
    metadata: { supabase_user_id: user.id, credits: String(credits) },
  })

  return NextResponse.json({ url: session.url })
}

import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
})

export const CREDIT_PACK_SIZE = 3
export const CREDIT_PACK_PRICE_USD = 5

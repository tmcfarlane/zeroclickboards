import Stripe from 'stripe'
import { getUserFromRequest, getHeader, jsonResponse } from '../_lib/auth'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_PRICE_ID
  if (!stripeKey || !priceId) return jsonResponse(500, { error: 'Stripe not configured' })

  const stripe = new Stripe(stripeKey)

  try {
    const origin = getHeader(req, 'origin') || 'https://boards.zeroclickdev.ai'

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/app?checkout=success`,
      cancel_url: `${origin}/app?checkout=cancel`,
      metadata: { userId: user.userId },
      client_reference_id: user.userId,
    })

    return jsonResponse(200, { url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonResponse(500, { error: message })
  }
}

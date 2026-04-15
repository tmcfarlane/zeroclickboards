import Stripe from 'stripe'
import { getUserFromRequest, getHeader, jsonResponse, logStep } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: Request) {
  const route = 'stripe/create-checkout'
  const t0 = Date.now()
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  logStep(route, 'after-auth', t0, { authed: !!user })
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_PRICE_ID
  if (!stripeKey || !priceId) {
    logStep(route, 'missing-stripe-env', t0, { hasKey: !!stripeKey, hasPriceId: !!priceId })
    return jsonResponse(500, { error: 'Stripe not configured' })
  }

  const stripe = new Stripe(stripeKey, { timeout: 8_000, maxNetworkRetries: 1 })

  try {
    const origin = getHeader(req, 'origin') || 'https://board.zeroclickdev.ai'

    const tStripe = Date.now()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/app?checkout=success`,
      cancel_url: `${origin}/app?checkout=cancel`,
      metadata: { userId: user.userId },
      client_reference_id: user.userId,
    })
    logStep(route, 'stripe:session-created', tStripe, { totalMs: Date.now() - t0 })

    return jsonResponse(200, { url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logStep(route, 'stripe:error', t0, { error: message })
    return jsonResponse(500, { error: message })
  }
}

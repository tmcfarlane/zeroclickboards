import Stripe from 'stripe'
import { getUserFromRequest, getHeader, createAuthenticatedClient, sendJson, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: unknown, res: NodeRes) {
  const method = (req as { method?: string }).method
  if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return sendJson(res, 500, { error: 'Stripe not configured' })

  const stripe = new Stripe(stripeKey, { timeout: 8_000, maxNetworkRetries: 1 })

  const client = createAuthenticatedClient(user.token)

  // Get customer ID from profiles
  const { data: profile } = await client
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.userId)
    .single()

  if (!profile?.stripe_customer_id) {
    return sendJson(res, 400, { error: 'No subscription found' })
  }

  try {
    const origin = getHeader(req, 'origin') || 'https://board.zeroclickdev.ai'

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/app`,
    })

    return sendJson(res, 200, { url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return sendJson(res, 500, { error: message })
  }
}

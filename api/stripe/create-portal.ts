import Stripe from 'stripe'
import { getUserFromRequest, createServiceClient, jsonResponse } from '../_lib/auth'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request) {
  if (req.method !== 'POST') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return jsonResponse(500, { error: 'Stripe not configured' })

  const stripe = new Stripe(stripeKey)
  const service = createServiceClient()

  // Get customer ID from profiles
  const { data: profile } = await service
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', user.userId)
    .single()

  if (!profile?.stripe_customer_id) {
    return jsonResponse(400, { error: 'No subscription found' })
  }

  try {
    const origin = req.headers.get('origin') || 'https://boards.zeroclickdev.ai'

    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${origin}/app`,
    })

    return jsonResponse(200, { url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return jsonResponse(500, { error: message })
  }
}

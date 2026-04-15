import Stripe from 'stripe'
import { getUserFromRequest, getHeader, sendJson, logStep, createAuthenticatedClient, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

const TRIAL_DAYS = 7

export default async function handler(req: unknown, res: NodeRes) {
  const route = 'stripe/create-checkout'
  const t0 = Date.now()
  const method = (req as { method?: string }).method
  logStep(route, 'handler:entered', t0, { method })
  if (method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  logStep(route, 'after-auth', t0, { authed: !!user })
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' })

  const stripeKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_PRICE_ID
  if (!stripeKey || !priceId) {
    logStep(route, 'missing-stripe-env', t0, { hasKey: !!stripeKey, hasPriceId: !!priceId })
    return sendJson(res, 500, { error: 'Stripe not configured' })
  }

  // "New user" = no prior subscription row for this user in our DB.
  // Any existing row (active, canceled, past_due, etc.) disqualifies them from a fresh trial.
  const tTrial = Date.now()
  const supabase = createAuthenticatedClient(user.token)
  const { data: priorSub, error: priorSubError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('user_id', user.userId)
    .limit(1)
    .maybeSingle()
  const isNewUser = !priorSubError && !priorSub
  logStep(route, 'trial-eligibility', tTrial, { isNewUser, hadError: !!priorSubError })

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
      subscription_data: isNewUser
        ? {
            trial_period_days: TRIAL_DAYS,
            trial_settings: { end_behavior: { missing_payment_method: 'cancel' } },
            metadata: { userId: user.userId, trial: 'new_user_7d' },
          }
        : { metadata: { userId: user.userId } },
    })
    logStep(route, 'stripe:session-created', tStripe, { totalMs: Date.now() - t0, trial: isNewUser })

    return sendJson(res, 200, { url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    logStep(route, 'stripe:error', t0, { error: message })
    return sendJson(res, 500, { error: message })
  }
}

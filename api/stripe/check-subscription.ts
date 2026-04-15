import { getUserFromRequest, hasActiveSubscription, createAuthenticatedClient, sendJson, logStep, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: unknown, res: NodeRes) {
  const route = 'stripe/check-subscription'
  const t0 = Date.now()
  const method = (req as { method?: string }).method
  logStep(route, 'handler:entered', t0, { method })
  if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  logStep(route, 'after-auth', t0, { authed: !!user })
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' })

  const priceId = process.env.STRIPE_PRICE_ID

  const tActive = Date.now()
  const active = await hasActiveSubscription(user.token, user.userId, priceId)
  logStep(route, 'has-active', tActive)

  const client = createAuthenticatedClient(user.token)
  let query = client
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.userId)
  if (priceId) query = query.eq('stripe_price_id', priceId)

  const tQuery = Date.now()
  const [subResult, anyPriorResult] = await Promise.all([
    query.order('created_at', { ascending: false }).limit(1).maybeSingle(),
    client.from('subscriptions').select('id').eq('user_id', user.userId).limit(1).maybeSingle(),
  ])
  const subscription = subResult.data
  const trialEligible = !anyPriorResult.error && !anyPriorResult.data
  logStep(route, 'subscription-query', tQuery, { totalMs: Date.now() - t0, trialEligible })

  return sendJson(res, 200, {
    hasActiveSubscription: active,
    subscription: subscription ?? null,
    trialEligible,
  })
}

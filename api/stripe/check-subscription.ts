import { getUserFromRequest, hasActiveSubscription, createAuthenticatedClient, jsonResponse } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: Request) {
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  const priceId = process.env.STRIPE_PRICE_ID
  const [active, client] = [
    await hasActiveSubscription(user.token, user.userId, priceId),
    createAuthenticatedClient(user.token),
  ]

  let query = client
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.userId)
  if (priceId) query = query.eq('stripe_price_id', priceId)
  const { data: subscription } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return jsonResponse(200, {
    hasActiveSubscription: active,
    subscription: subscription ?? null,
  })
}

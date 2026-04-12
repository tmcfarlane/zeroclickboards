import { getUserFromRequest, hasActiveSubscription, createServiceClient, jsonResponse } from '../_lib/auth'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request) {
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  const active = await hasActiveSubscription(user.userId)

  const service = createServiceClient()
  const { data: subscription } = await service
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return jsonResponse(200, {
    hasActiveSubscription: active,
    subscription: subscription ?? null,
  })
}

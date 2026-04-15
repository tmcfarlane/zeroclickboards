import { getUserFromRequest, isAdmin, createServiceClient, sendJson, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: unknown, res: NodeRes) {
  const method = (req as { method?: string }).method
  if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' })

  if (!isAdmin(user.email)) {
    return sendJson(res, 403, { error: 'Forbidden' })
  }

  const service = createServiceClient()
  const priceId = process.env.STRIPE_PRICE_ID

  // Build price-filtered subscription queries
  function subsQuery() {
    let q = service.from('subscriptions').select('*', { count: 'exact', head: true })
    if (priceId) q = q.eq('stripe_price_id', priceId)
    return q
  }

  // Fetch stats in parallel
  const [usersResult, subsResult, activeSubsResult, recentUsersResult, recentSubsResult] = await Promise.all([
    service.from('profiles').select('*', { count: 'exact', head: true }),
    subsQuery(),
    subsQuery().eq('status', 'active'),
    service
      .from('profiles')
      .select('id, email, full_name, avatar_url, created_at')
      .order('created_at', { ascending: false })
      .limit(20),
    (() => {
      let q = service
        .from('subscriptions')
        .select('id, user_id, status, current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at')
      if (priceId) q = q.eq('stripe_price_id', priceId)
      return q.order('created_at', { ascending: false }).limit(20)
    })(),
  ])

  // Enrich subscriptions with user emails
  const recentSubs = recentSubsResult.data ?? []
  const subUserIds = recentSubs.map(s => s.user_id)
  const { data: subProfiles } = subUserIds.length > 0
    ? await service.from('profiles').select('id, email, full_name').in('id', subUserIds)
    : { data: [] }

  const profileMap = new Map((subProfiles ?? []).map(p => [p.id, p as { email?: string; full_name?: string }]))
  const enrichedSubs = recentSubs.map(s => ({
    ...s,
    user_email: profileMap.get(s.user_id)?.email ?? 'Unknown',
    user_name: profileMap.get(s.user_id)?.full_name ?? null,
  }))

  return sendJson(res, 200, {
    isAdmin: true,
    stats: {
      totalUsers: usersResult.count ?? 0,
      totalSubscriptions: subsResult.count ?? 0,
      activeSubscriptions: activeSubsResult.count ?? 0,
    },
    recentUsers: recentUsersResult.data ?? [],
    recentSubscriptions: enrichedSubs,
  })
}

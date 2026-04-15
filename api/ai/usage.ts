import { getUserFromRequest, hasActiveSubscription, getDailyAIUsage, isAdmin, sendJson, logStep, FREE_DAILY_AI_LIMIT, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 15 }

export default async function handler(req: unknown, res: NodeRes) {
  const route = 'ai/usage'
  const t0 = Date.now()
  const method = (req as { method?: string }).method
  logStep(route, 'handler:entered', t0, { method })
  if (method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' })
  }

  const authUser = await getUserFromRequest(req)
  logStep(route, 'after-auth', t0, { authed: !!authUser })
  if (!authUser) {
    return sendJson(res, 401, { error: 'Unauthorized' })
  }

  // Admins have no caps — treat as paid
  const admin = isAdmin(authUser.email)

  try {
    const tParallel = Date.now()
    const [subscribed, dailyUsage] = await Promise.all([
      hasActiveSubscription(authUser.token, authUser.userId, process.env.STRIPE_PRICE_ID),
      getDailyAIUsage(authUser.token, authUser.userId),
    ])
    logStep(route, 'parallel-queries', tParallel, { totalMs: Date.now() - t0 })

    const uncapped = subscribed || admin

    // Calculate next midnight Pacific in UTC
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowPacific = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date())
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8'
    const offsetHours = parseInt(offsetPart.replace('GMT', ''), 10)
    const resetsAtDate = new Date(tomorrowPacific + 'T00:00:00Z')
    resetsAtDate.setUTCHours(resetsAtDate.getUTCHours() - offsetHours)

    return sendJson(res, 200, {
      used: dailyUsage.charged,
      limit: uncapped ? null : FREE_DAILY_AI_LIMIT,
      resetsAt: resetsAtDate.toISOString(),
    })
  } catch {
    return sendJson(res, 500, { error: 'Failed to fetch AI usage' })
  }
}

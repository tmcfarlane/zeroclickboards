import { getUserFromRequest, hasActiveSubscription, getDailyAIUsage, jsonResponse, FREE_DAILY_AI_LIMIT } from '../_lib/auth'

export const config = { runtime: 'nodejs' }

export default async function handler(req: Request) {
  if (req.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed' })
  }

  const authUser = await getUserFromRequest(req)
  if (!authUser) {
    return jsonResponse(401, { error: 'Unauthorized' })
  }

  try {
    const [subscribed, used] = await Promise.all([
      hasActiveSubscription(authUser.token, authUser.userId),
      getDailyAIUsage(authUser.token, authUser.userId),
    ])

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

    return jsonResponse(200, {
      used,
      limit: subscribed ? null : FREE_DAILY_AI_LIMIT,
      resetsAt: resetsAtDate.toISOString(),
    })
  } catch {
    return jsonResponse(500, { error: 'Failed to fetch AI usage' })
  }
}

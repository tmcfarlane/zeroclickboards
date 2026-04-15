import { getUserFromRequest, isAdmin, sendJson, logStep, type NodeRes } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 10 }

export default async function handler(req: unknown, res: NodeRes) {
  const route = 'admin/check'
  const t0 = Date.now()
  const method = (req as { method?: string }).method
  logStep(route, 'handler:entered', t0, { method })
  if (method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  logStep(route, 'after-auth', t0, { authed: !!user })
  if (!user) return sendJson(res, 401, { error: 'Unauthorized' })

  return sendJson(res, 200, { isAdmin: isAdmin(user.email) })
}

import { getUserFromRequest, isAdmin, jsonResponse, logStep } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 10 }

export default async function handler(req: Request) {
  const route = 'admin/check'
  const t0 = Date.now()
  logStep(route, 'handler:entered', t0, { method: req.method })
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  logStep(route, 'after-auth', t0, { authed: !!user })
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  return jsonResponse(200, { isAdmin: isAdmin(user.email) })
}

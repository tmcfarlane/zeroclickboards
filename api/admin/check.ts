import { getUserFromRequest, isAdmin, jsonResponse } from '../_lib/auth.js'

export const config = { runtime: 'nodejs', maxDuration: 10 }

export default async function handler(req: Request) {
  if (req.method !== 'GET') return jsonResponse(405, { error: 'Method not allowed' })

  const user = await getUserFromRequest(req)
  if (!user) return jsonResponse(401, { error: 'Unauthorized' })

  return jsonResponse(200, { isAdmin: isAdmin(user.email) })
}

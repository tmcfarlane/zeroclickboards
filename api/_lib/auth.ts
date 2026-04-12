import { createClient } from '@supabase/supabase-js'

export function createServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key)
}

export function createAnonClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  return createClient(url, key)
}

export async function getUserFromRequest(req: Request): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null

  const client = createClient(url, key)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null

  return { userId: data.user.id }
}

export async function hasActiveSubscription(userId: string): Promise<boolean> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .single()

  return !error && !!data
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

export { jsonResponse }

import { createClient, SupabaseClient } from '@supabase/supabase-js'

const FETCH_TIMEOUT_MS = 8_000

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  return fetch(input, { ...init, signal })
}

// Only used by Stripe webhook (server-to-server, no user JWT)
export function createServiceClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { global: { fetch: fetchWithTimeout } })
}

export function createAuthenticatedClient(token: string): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  return createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchWithTimeout },
  })
}

export function createAnonClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  return createClient(url, key, { global: { fetch: fetchWithTimeout } })
}

export function getHeader(req: unknown, name: string): string | null {
  const r = req as Record<string, unknown>
  // Web Request API (production Vercel)
  if (r.headers && typeof (r.headers as Record<string, unknown>).get === 'function') {
    return (r.headers as Headers).get(name)
  }
  // Node.js IncomingMessage (vercel dev)
  if (r.headers && typeof r.headers === 'object') {
    const val = (r.headers as Record<string, string | string[] | undefined>)[name]
    return typeof val === 'string' ? val : null
  }
  return null
}

export async function getUserFromRequest(req: Request): Promise<{ userId: string; token: string } | null> {
  const authHeader = getHeader(req, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null

  const client = createClient(url, key, { global: { fetch: fetchWithTimeout } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null

  return { userId: data.user.id, token }
}

export async function hasActiveSubscription(token: string, userId: string): Promise<boolean> {
  const client = createAuthenticatedClient(token)
  const { data, error } = await client
    .from('subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .eq('status', 'active')
    .limit(1)
    .maybeSingle()

  return !error && !!data
}

function getMidnightPacificUTC(): string {
  const pacificDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date())
  const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT-8'
  const offsetHours = parseInt(offsetPart.replace('GMT', ''), 10)

  const midnightUTC = new Date(pacificDate + 'T00:00:00Z')
  midnightUTC.setUTCHours(midnightUTC.getUTCHours() - offsetHours)
  return midnightUTC.toISOString()
}

export async function getDailyAIUsage(token: string, userId: string): Promise<number> {
  const client = createAuthenticatedClient(token)
  const midnight = getMidnightPacificUTC()

  const { count, error } = await client
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', midnight)

  if (error) return 0
  return count ?? 0
}

export async function logAIUsage(token: string, userId: string, queryText: string, commandType?: string): Promise<void> {
  const client = createAuthenticatedClient(token)
  await client
    .from('ai_usage')
    .insert({ user_id: userId, query_text: queryText, command_type: commandType })
}

export const FREE_DAILY_AI_LIMIT = 5
export const AI_WARNING_THRESHOLD = 3

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

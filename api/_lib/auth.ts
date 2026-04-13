import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Support both vercel dev (SUPABASE_URL from project settings)
// and vite dev (VITE_SUPABASE_URL from .env)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const FETCH_TIMEOUT_MS = 8_000

function fetchWithTimeout(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  return fetch(input, { ...init, signal })
}

// Serverless functions are stateless — disable auto-refresh and session
// persistence so the Supabase client doesn't keep the event loop alive.
const SERVERLESS_AUTH = {
  autoRefreshToken: false,
  persistSession: false,
} as const

// Only used by Stripe webhook (server-to-server, no user JWT)
export function createServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: SERVERLESS_AUTH, global: { fetch: fetchWithTimeout } })
}

export function createAuthenticatedClient(token: string): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: SERVERLESS_AUTH,
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchWithTimeout },
  })
}

export function createAnonClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY')
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: SERVERLESS_AUTH, global: { fetch: fetchWithTimeout } })
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

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: SERVERLESS_AUTH, global: { fetch: fetchWithTimeout } })
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

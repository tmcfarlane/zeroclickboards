import { createClient, SupabaseClient } from '@supabase/supabase-js'

console.log(JSON.stringify({ step: 'auth-module:loaded', ts: Date.now() }))

// Support both vercel dev (SUPABASE_URL from project settings)
// and vite dev (VITE_SUPABASE_URL from .env)
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log(JSON.stringify({
  step: 'auth-module:env',
  hasUrl: !!SUPABASE_URL,
  hasAnonKey: !!SUPABASE_ANON_KEY,
  hasServiceKey: !!SUPABASE_SERVICE_ROLE_KEY,
  urlHost: SUPABASE_URL ? (() => { try { return new URL(SUPABASE_URL).host } catch { return 'invalid-url' } })() : null,
}))

const FETCH_TIMEOUT_MS = 8_000
const AUTH_FETCH_TIMEOUT_MS = 3_000

function makeFetchWithTimeout(timeoutMs: number) {
  return function fetchWithTimeout(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    const signal = AbortSignal.timeout(timeoutMs)
    return fetch(input, { ...init, signal })
  }
}

const fetchWithTimeout = makeFetchWithTimeout(FETCH_TIMEOUT_MS)
const authFetchWithTimeout = makeFetchWithTimeout(AUTH_FETCH_TIMEOUT_MS)

function logStep(route: string, step: string, startedAt: number, extra?: Record<string, unknown>) {
  const durationMs = Date.now() - startedAt
  console.log(JSON.stringify({ route, step, durationMs, ...extra }))
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

export async function getUserFromRequest(req: unknown): Promise<{ userId: string; email: string; token: string } | null> {
  const authHeader = getHeader(req, 'authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.log(JSON.stringify({ step: 'auth:missing-env', hasUrl: !!SUPABASE_URL, hasAnonKey: !!SUPABASE_ANON_KEY }))
    return null
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: SERVERLESS_AUTH, global: { fetch: authFetchWithTimeout } })
  const startedAt = Date.now()
  try {
    const { data, error } = await client.auth.getUser(token)
    const durationMs = Date.now() - startedAt
    if (error || !data.user) {
      console.log(JSON.stringify({ step: 'auth:getUser', durationMs, ok: false, error: error?.message ?? 'no-user' }))
      return null
    }
    if (durationMs > 500) {
      console.log(JSON.stringify({ step: 'auth:getUser', durationMs, ok: true, slow: true }))
    }
    return { userId: data.user.id, email: data.user.email ?? '', token }
  } catch (err) {
    const durationMs = Date.now() - startedAt
    console.log(JSON.stringify({ step: 'auth:getUser', durationMs, ok: false, error: err instanceof Error ? err.message : 'unknown' }))
    return null
  }
}

export function isAdmin(email: string): boolean {
  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
  return adminEmails.includes(email.toLowerCase())
}

export async function hasActiveSubscription(token: string, userId: string, priceId?: string): Promise<boolean> {
  const client = createAuthenticatedClient(token)
  let query = client
    .from('subscriptions')
    .select('id, status')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing'])
  if (priceId) query = query.eq('stripe_price_id', priceId)
  const { data, error } = await query.limit(1).maybeSingle()

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

export async function getDailyAIUsage(token: string, userId: string): Promise<{ charged: number; total: number }> {
  const client = createAuthenticatedClient(token)
  const midnight = getMidnightPacificUTC()

  const [allResult, unknownResult] = await Promise.all([
    client
      .from('ai_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', midnight),
    client
      .from('ai_usage')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', midnight)
      .eq('command_type', 'unknown'),
  ])

  const total = allResult.error ? 0 : (allResult.count ?? 0)
  const unknown = unknownResult.error ? 0 : (unknownResult.count ?? 0)
  return { charged: total - unknown, total }
}

export async function logAIUsage(token: string, userId: string, queryText: string, commandType?: string): Promise<void> {
  const client = createAuthenticatedClient(token)
  await client
    .from('ai_usage')
    .insert({ user_id: userId, query_text: queryText, command_type: commandType })
}

export const FREE_DAILY_AI_LIMIT = 5
export const AI_WARNING_THRESHOLD = 3
export const FREE_DAILY_AI_ABUSE_LIMIT = 15

export interface NodeRes {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body?: string | Buffer): unknown
}

export function sendJson(res: NodeRes, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

export async function readRawBody(req: unknown): Promise<string> {
  const r = req as AsyncIterable<Buffer | string> & { body?: unknown }
  // If Vercel already parsed the body (object), re-stringify.
  if (r.body !== undefined && typeof r.body === 'object' && r.body !== null && !(r.body instanceof Buffer)) {
    return JSON.stringify(r.body)
  }
  if (typeof r.body === 'string') return r.body
  if (r.body instanceof Buffer) return r.body.toString('utf8')
  const chunks: Buffer[] = []
  for await (const chunk of r) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export async function readJsonBody(req: unknown): Promise<unknown> {
  const r = req as { body?: unknown }
  if (r.body !== undefined && typeof r.body !== 'string' && !(r.body instanceof Buffer)) {
    return r.body
  }
  const raw = await readRawBody(req)
  if (!raw) return undefined
  return JSON.parse(raw)
}

export { logStep }

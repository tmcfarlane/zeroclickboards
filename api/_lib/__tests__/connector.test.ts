// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import { PassThrough } from 'node:stream'
import { brotliCompressSync, deflateSync, gzipSync } from 'node:zlib'
import { createHash, randomBytes } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { createConnectorHandler } from '../../connector.js'
import { createConnectorRuntime } from '../connector-runtime.js'
import { readConnectorConfig, type ConnectorConfig } from '../connector-config.js'
import { sessionExpiry, SqlSessionVault } from '../connector-vault.js'
import { SqlOAuthStore } from '../../../mcp-server/src/oauth-store.js'

vi.unmock('@supabase/supabase-js')

const alice = '11111111-1111-4111-8111-111111111111'
const bob = '22222222-2222-4222-8222-222222222222'
const jwt = (userId: string, exp = Math.floor(Date.now() / 1000) + 3600) => `header.${Buffer.from(JSON.stringify({ sub: userId, exp })).toString('base64url')}.signature`
const aliceToken = jwt(alice)
const bobToken = jwt(bob)
const client = { client_id: 'chatgpt-fixture', client_name: 'ChatGPT fixture', redirect_uris: ['https://chatgpt.test/callback'], token_endpoint_auth_method: 'none' as const }
const nativeClient = { client_id: 'codex-native-fixture', client_name: 'Codex native fixture', redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' as const }
const baseEnv = (): NodeJS.ProcessEnv => ({ ZEROBOARD_CONNECTOR_ENABLED: 'true', ZEROBOARD_CONNECTOR_ISSUER: 'https://connector.test',
  ZEROBOARD_CONNECTOR_DATABASE_URL: 'postgres://connector:password@db.test/postgres', ZEROBOARD_CONNECTOR_VAULT_KEY: randomBytes(32).toString('base64'),
  ZEROBOARD_CONNECTOR_PROPOSAL_KEY: 'fixture-proposal-key-with-at-least-32-bytes', ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([client]),
  SUPABASE_URL: 'https://supabase.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture', ZEROBOARD_CONNECTOR_ALLOWED_ORIGINS: '["https://chatgpt.test"]' })
const config = (): ConnectorConfig => readConnectorConfig(baseEnv())!
const board = (id: string, userId: string, name: string) => ({ id, user_id: userId, name, data: { columns: [] }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_public: true, embed_enabled: true })
const rows = [board('owned', alice, 'Owned'), board('viewer', bob, 'Read only'), board('unrelated-public', bob, 'Unrelated')]

async function database() {
  const pg = new PGlite()
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${alice}'),('${bob}');`)
  const directory = new URL('../../../supabase/migrations/', import.meta.url)
  for (const suffix of ['plugin_oauth_records.sql', 'plugin_connector_vault.sql']) {
    const filename = (await readdir(directory)).find(name => name.endsWith(suffix))!
    await pg.exec(await readFile(new URL(filename, directory), 'utf8'))
  }
  return pg
}
const cleanup: (() => Promise<unknown> | void)[] = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); vi.unstubAllGlobals() })
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const token = new Headers(init?.headers).get('authorization')?.replace(/^Bearer /, '')
    if (url.pathname === '/auth/v1/user') {
      const userId = token === aliceToken ? alice : token === bobToken ? bob : null
      return new Response(JSON.stringify(userId ? { id: userId, email: 'fixture@example.test' } : { message: 'Invalid token' }), { status: userId ? 200 : 401, headers: { 'content-type': 'application/json' } })
    }
    if (url.pathname === '/rest/v1/boards') {
      const wanted = url.searchParams.get('id')
      const selected = wanted?.startsWith('eq.') ? rows.filter(row => row.id === wanted.slice(3)) :
        wanted?.startsWith('in.(') ? rows.filter(row => wanted.slice(4,-1).split(',').includes(row.id)) : rows
      return Response.json(selected)
    }
    if (url.pathname === '/rest/v1/board_members') {
      const memberships = token === aliceToken ? [{ board_id: 'viewer', user_id: alice, role: 'viewer' }] : []
      const wanted = url.searchParams.get('board_id')
      return Response.json(wanted ? memberships.filter(member => `eq.${member.board_id}` === wanted) : memberships)
    }
    throw new Error(`Unexpected fixture request ${url.pathname}`)
  }))
})

async function setup(preparsed: boolean | 'restored' | 'raw-buffer' = false, connectorConfig = config()) {
  const pg = await database(); cleanup.push(() => pg.close())
  await pg.exec('set role zeroboard_connector')
  const runtime = createConnectorRuntime(connectorConfig, pg)
  const handler = createConnectorHandler({ runtime: () => runtime, authenticate: async (req) => {
    const token = (req as IncomingMessage).headers.authorization?.replace(/^Bearer /, '')
    if (!token) return null
    const client = runtime.accountClient(token, alice)
    const { data, error } = await client.auth.getUser(token)
    return error || !data.user ? null : { token, userId: data.user.id, email: '' }
  } })
  const bodyObservations: { path: string; getterReads: number; recoveredBytes: number[] }[] = []
  const server = createServer(async (req, res) => {
    const observation = { path: req.url!, getterReads: 0, recoveredBytes: [] as number[] }
    bodyObservations.push(observation)
    if (preparsed && req.method !== 'GET' && req.method !== 'HEAD') {
      const buffers: Buffer[] = []; for await (const chunk of req) buffers.push(Buffer.from(chunk))
      const bytes = Buffer.concat(buffers)
      if (preparsed === 'raw-buffer') Object.defineProperty(req, 'rawBody', { value: bytes })
      const mediaType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase()
      if (preparsed === 'restored') {
        // Vercel's helper consumes the original IncomingMessage, then restores
        // read/data/end on a PassThrough while the original ended flags remain.
        const replica = new PassThrough()
        const originalOn = req.on.bind(req)
        req.read = replica.read.bind(replica)
        req.on = req.addListener = ((event: string, callback: (...args: unknown[]) => void) =>
          event === 'data' || event === 'end' ? replica.on(event, callback) : originalOn(event, callback)) as typeof req.on
        replica.write(bytes); replica.end()
      }
      const property = { configurable: true, enumerable: true }
      Object.defineProperty(req, 'body', { ...property, get: () => {
        observation.getterReads++
        const text = bytes.toString()
        const value: unknown = mediaType === 'application/json' ? (text ? JSON.parse(text) : {}) :
          mediaType === 'application/x-www-form-urlencoded' ? Object.fromEntries(new URLSearchParams(text)) :
          mediaType === 'application/octet-stream' ? bytes : mediaType === 'text/plain' ? text : undefined
        Object.defineProperty(req, 'body', { ...property, writable: true, value })
        return value
      }, set: (value: unknown) => { Object.defineProperty(req, 'body', { ...property, writable: true, value }) } })
    }
    const originalRead = req.read.bind(req)
    req.read = (size?: number) => {
      const bytes: unknown = originalRead(size)
      if (size === 1024 * 1024 + 1) observation.recoveredBytes.push(Buffer.isBuffer(bytes) ? bytes.length : 0)
      return bytes
    }
    // Exercise accepted Express aliases directly as well as canonical API rewrites.
    if (req.url?.startsWith('/direct/')) {
      req.url = req.url.slice('/direct'.length)
      runtime.app(req as ExpressRequest, res as ExpressResponse)
    } else await handler(req, res)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address() as { port: number }
  const request = (path: string, init: { method?: string; headers?: Record<string,string | string[]>; body?: string | Buffer } = {}) => new Promise<{ status: number; headers: IncomingMessage['headers']; body: string; json(): Record<string,unknown> }>((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${address.port}${path}`, { method: init.method ?? 'GET', headers: { host: 'connector.test', ...init.headers } }, res => {
      const buffers: Buffer[] = []; res.on('data', chunk => buffers.push(Buffer.from(chunk))); res.on('end', () => {
        const body = Buffer.concat(buffers).toString(); resolve({ status: res.statusCode!, headers: res.headers, body, json: () => JSON.parse(body) })
      })
    })
    req.on('error', reject); if (init.body) req.write(init.body); req.end()
  })
  const post = (body: unknown, token = aliceToken, origin = 'https://connector.test') => request('/api/connector', { method: 'POST', headers: { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const authorize = async (scope = 'boards:read cards:add') => {
    const verifier = randomBytes(32).toString('base64url')
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'), resource: runtime.config.resource.href, scope, state: 'expected-state' })
    const response = await request(`/api/connector?route=authorize&${params}`)
    expect(response.status).toBe(302)
    return { request: new URL(response.headers.location!).searchParams.get('request')!, verifier }
  }
  return { pg, runtime, request, post, authorize, bodyObservations }
}

describe('connector configuration and encrypted account vault', () => {
  it('requires explicit deployment setup and exact public-client configuration', () => {
    expect(readConnectorConfig({})).toBeNull()
    for (const change of [ { ZEROBOARD_CONNECTOR_ISSUER: 'http://connector.test' }, { ZEROBOARD_CONNECTOR_VAULT_KEY: 'unsafe' },
      { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_no' }, { ZEROBOARD_CONNECTOR_CLIENTS: '[]' }, { ZEROBOARD_CONNECTOR_ALLOWED_ORIGINS: '["https://evil.test/path"]' } ]) {
      expect(() => readConnectorConfig({ ...baseEnv(), ...change })).toThrow()
    }
    expect(config().consentUrl.href).toBe('https://connector.test/auth/connector')
    expect(readConnectorConfig({ ...baseEnv(), ZEROBOARD_CONNECTOR_ALLOWED_ORIGINS: '["https://chatgpt.test/"]' })?.allowedOrigins).toContain('https://chatgpt.test')
    expect(readConnectorConfig({ ...baseEnv(), ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([{ ...client, redirect_uris: ['https://chatgpt.test/callback?connector=fixture'] }]) })?.clients[0].redirect_uris[0]).toBe('https://chatgpt.test/callback?connector=fixture')
    expect(sessionExpiry(jwt(alice, Math.floor(Date.now()/1000) + 60)) - Date.now()).toBeLessThanOrEqual(60000)
    expect(() => sessionExpiry(jwt(alice, 0))).toThrow()
  })
  it('accepts separate native public clients but rejects aliases, credentials, fragments and non-loopback HTTP', () => {
    const env = baseEnv()
    const configured = readConnectorConfig({ ...env, ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([client, nativeClient]) })!
    expect(configured.clients.map(entry => entry.client_id)).toEqual([client.client_id, nativeClient.client_id])
    expect(configured.clients[1].redirect_uris).toEqual(['http://127.0.0.1/callback'])
    for (const callback of ['http://evil.test/callback', 'http://localhost/callback', 'http://[::1]/callback',
      'http://2130706433/callback', 'http://0x7f000001/callback', 'http://127.1/callback',
      'http://user:pass@127.0.0.1/callback', 'http://@127.0.0.1/callback', 'http://127.0.0.1/callback#',
      'http://127.0.0.1:0/callback', 'http://127.0.0.1:65536/callback', 'http://127.0.0.1/other/../callback']) {
      expect(() => readConnectorConfig({ ...env, ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([{ ...nativeClient, redirect_uris: [callback] }]) }), callback).toThrow()
    }
  })
  it('stores ciphertext, rejects tampering/expiry and denies browser roles', async () => {
    const pg = await database(); cleanup.push(() => pg.close())
    const vault = new SqlSessionVault(pg, randomBytes(32))
    const session = { accessToken: aliceToken, userId: alice, expires: Date.now() + 60000 }
    const ref = await vault.save(session)
    expect(await vault.load(ref)).toEqual(session)
    const record = (await pg.query<{ encrypted_session: string }>('select encrypted_session from zeroboard_oauth.sessions')).rows[0]
    expect(record.encrypted_session).not.toContain(aliceToken)
    await pg.query("update zeroboard_oauth.sessions set user_id = $1 where account_ref = $2", [bob, ref])
    await expect(vault.load(ref)).rejects.toThrow()
    await pg.query('update zeroboard_oauth.sessions set expires_at = now() - interval \'1 minute\'')
    await expect(vault.load(ref)).rejects.toThrow(/expired/)
    for (const role of ['anon','authenticated']) {
      await pg.exec(`set role ${role}`)
      await expect(pg.query('select * from zeroboard_oauth.sessions')).rejects.toThrow(/permission denied/)
      await expect(new SqlOAuthStore(pg).get('grant','any')).rejects.toThrow(/permission denied/)
      await pg.exec('reset role')
    }
  })
  it('requires every storage privilege and matching backend policies for availability', async () => {
    const { pg, runtime, request } = await setup()
    await expect(runtime.health()).resolves.toBeUndefined()
    await pg.exec('reset role; revoke insert on zeroboard_oauth.sessions from zeroboard_connector; set role zeroboard_connector')
    await expect(runtime.health()).rejects.toThrow(/unavailable/)
    const unavailable = await request('/api/connector', { headers: { authorization: `Bearer ${aliceToken}` } })
    expect(unavailable.status).toBe(200)
    expect(unavailable.json()).toMatchObject({ available: false, endpoint: null })
    await pg.exec('reset role; grant insert on zeroboard_oauth.sessions to zeroboard_connector; drop policy connector_backend_sessions on zeroboard_oauth.sessions; set role zeroboard_connector')
    await expect(runtime.health()).rejects.toThrow(/unavailable/)
  })
})

describe('account connector API and durable OAuth flow', () => {
  it.each(['not-a-route', 'constructor', 'toString', '__proto__'])('rejects unknown protocol route %s as JSON without probing storage', async route => {
    const runtime = { health: vi.fn() } as unknown as ReturnType<typeof createConnectorRuntime>
    const handler = createConnectorHandler({ runtime: () => runtime, authenticate: vi.fn() })
    let body = ''; const res = { setHeader: vi.fn(), end: (value: string) => { body = value }, statusCode: 0 } as unknown as ServerResponse
    await handler({ url: `/api/connector?route=${route}`, method: 'GET' } as IncomingMessage, res)
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(body)).toEqual({ error: 'Unknown connector route' })
    expect(runtime.health).not.toHaveBeenCalled()
  })

  it('authenticates status and reports unavailable configuration honestly', async () => {
    const { request } = await setup()
    expect((await request('/api/connector')).status).toBe(401)
    const status = await request('/api/connector', { headers: { authorization: `Bearer ${aliceToken}` } })
    expect(status.json()).toMatchObject({ available: true, endpoint: 'https://connector.test/mcp', connections: [] })
    expect(status.body).not.toContain(aliceToken)
    expect((await request('/api/connector?route=mcp', { method: 'POST', headers: { host: 'evil.test' } })).status).toBe(421)
    expect((await request('/api/connector?route=mcp', { method: 'POST', headers: { origin: 'https://evil.test' } })).status).toBe(403)
    const metadata = await request('/api/connector?route=resource-metadata')
    expect(metadata.json()).toMatchObject({ resource: 'https://connector.test/mcp', authorization_servers: ['https://connector.test/'] })
    const handler = createConnectorHandler({ runtime: () => null, authenticate: async () => ({ userId: alice, email: '', token: aliceToken }) })
    let body = ''; const res = { setHeader: vi.fn(), end: (value: string) => { body = value }, statusCode: 0 } as unknown as ServerResponse
    await handler({ url: '/api/connector', method: 'GET' } as IncomingMessage, res)
    expect(JSON.parse(body)).toMatchObject({ available: false, endpoint: null, connections: [] })
  })
  it('reports callback capabilities without relying on public client names or exposing callbacks', async () => {
    const configured = { ...config(), clients: [
      { ...client, client_name: 'Codex misleading name', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] },
      { ...nativeClient, client_name: 'ChatGPT misleading name' },
      { ...client, client_id: 'custom', client_name: 'ChatGPT', redirect_uris: ['https://other.test/callback'] },
    ] }
    const { request } = await setup(false, configured)
    const response = await request('/api/connector', { headers: { authorization: `Bearer ${aliceToken}` } })
    expect(response.json().clients).toEqual([
      { name: 'Codex misleading name', clientId: client.client_id, callbackKinds: ['chatgpt'] },
      { name: 'ChatGPT misleading name', clientId: nativeClient.client_id, callbackKinds: ['native'] },
      { name: 'ChatGPT', clientId: 'custom', callbackKinds: [] },
    ])
    expect(response.body).not.toContain('redirect_uris')
    expect(response.body).not.toContain('connector_platform_oauth_redirect')
    expect(response.body).not.toContain(aliceToken)
  })
  it('shows only owned/member boards, denies foreign/viewer writes, cross-site approval and refresh-token input', async () => {
    const { request, post, authorize } = await setup()
    const pending = await authorize()
    const consent = await request(`/api/connector?action=consent&request=${pending.request}`, { headers: { authorization: `Bearer ${aliceToken}` } })
    expect(consent.json()).toMatchObject({ clientName: 'ChatGPT fixture', scopes: ['boards:read','cards:add'], boards: [{ id: 'owned', canAddCards: true }, { id: 'viewer', canAddCards: false }] })
    expect((await post({ action: 'approve', request: pending.request, boardIds: ['owned'] }, aliceToken, 'https://evil.test')).status).toBe(403)
    expect((await post({ action: 'approve', request: pending.request, boardIds: ['owned'], refreshToken: 'must-not-store' })).status).toBe(400)
    expect((await post({ action: 'approve', request: pending.request, boardIds: ['unrelated-public'] })).status).toBe(400)
    expect((await post({ action: 'approve', request: pending.request, boardIds: ['viewer'] })).status).toBe(400)
  })
  it.each([false,true])('persists consent/token flow, one-time PKCE exchange and authenticated revocation (preparsed=%s)', async preparsed => {
    const { pg, runtime, request, post, authorize } = await setup(preparsed)
    const pending = await authorize()
    const approved = await post({ action: 'approve', request: pending.request, boardIds: ['owned'] })
    expect(approved.status).toBe(200)
    const redirect = new URL(approved.json().redirectUrl as string)
    expect(redirect.origin + redirect.pathname).toBe(client.redirect_uris[0]); expect(redirect.searchParams.get('state')).toBe('expected-state')
    // Settings report approved access even before a client exchanges its code.
    expect((await request('/api/connector', { headers: { authorization: `Bearer ${aliceToken}` } })).json().connections).toHaveLength(1)
    expect((await pg.query<{ value: number }>("select count(*)::int as value from zeroboard_oauth.records where kind = 'token'")).rows[0].value).toBe(0)
    expect((await post({ action: 'approve', request: pending.request, boardIds: ['owned'] })).status).toBe(400)
    const exchange = (verifier: string) => request('/api/connector?route=token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id,
      grant_type: 'authorization_code', code: redirect.searchParams.get('code')!, code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: runtime.config.resource.href }).toString() })
    expect((await exchange(randomBytes(32).toString('base64url'))).status).toBe(400)
    const tokenResponse = await exchange(pending.verifier); expect(tokenResponse.status).toBe(200)
    const access = tokenResponse.json().access_token as string; expect(tokenResponse.json().expires_in).toBeLessThanOrEqual(900)
    expect((await exchange(pending.verifier)).status).toBe(400)
    // A new runtime/SQL-store instance can authorize the already-issued token.
    const restarted = createConnectorRuntime(runtime.config, pg)
    expect((await restarted.oauth.accountForToken(access)).user.id).toBe(alice)
    const mcp = (method: string, params?: unknown) => request('/api/connector?route=mcp', { method: 'POST',
      headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }) })
    const initialized = await mcp('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'connector-fixture', version: '1' } })
    expect(initialized.status).toBe(200)
    const toolsResponse = await mcp('tools/list')
    expect(toolsResponse.status).toBe(200)
    const tools = (toolsResponse.json().result as { tools: { name: string; securitySchemes: unknown[] }[] }).tools
    expect(tools).toHaveLength(8)
    expect(tools.map(tool => tool.name)).toContain('commit_cards')
    expect(tools.every(tool => Array.isArray(tool.securitySchemes))).toBe(true)
    expect(tools.some(tool => /delete|archive|move|generate/.test(tool.name))).toBe(false)
    const listed = await mcp('tools/call', { name: 'list_boards', arguments: {} })
    const result = listed.json().result as { content: { text: string }[] }
    expect(JSON.parse(result.content[0].text).map((row: { id: string }) => row.id)).toEqual(['owned'])
    const denied = await mcp('tools/call', { name: 'get_board', arguments: { boardId: 'unrelated-public' } })
    expect(denied.json().result).toMatchObject({ isError: true })
    const connections = (await request('/api/connector', { headers: { authorization: `Bearer ${aliceToken}` } })).json().connections as { id: string }[]
    expect(connections).toHaveLength(1)
    expect((await post({ action: 'revoke', connectionId: connections[0].id }, bobToken)).status).toBe(404)
    expect((await post({ action: 'revoke', connectionId: connections[0].id })).status).toBe(200)
    await expect(restarted.oauth.accountForToken(access)).rejects.toThrow(/revoked/)
    expect((await pg.query('select account_ref from zeroboard_oauth.sessions')).rows).toHaveLength(0)
  })
  it.each([false,true])('native form authorization and approval preserve active callback ports through the Vercel adapter (preparsed=%s)', async preparsed => {
    const nativeConfig = readConnectorConfig({ ...baseEnv(), ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([client, nativeClient]) })!
    const { runtime, request, post } = await setup(preparsed, nativeConfig)
    const verifier = randomBytes(32).toString('base64url')
    const redirectUri = 'http://127.0.0.1:54321/callback'
    const params = new URLSearchParams({ client_id: nativeClient.client_id, redirect_uri: redirectUri, response_type: 'code',
      code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      resource: runtime.config.resource.href, scope: 'boards:read', state: 'native-adapter-state' })
    const authorizeForm = (body: URLSearchParams) => request('/api/connector?route=authorize', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    const malicious = new URLSearchParams(params)
    malicious.set('redirect_uri', 'http://user:pass@127.0.0.1:54321/callback#fragment')
    malicious.set('response_type', 'token')
    const rejected = await authorizeForm(malicious)
    expect(rejected.status).toBe(400); expect(rejected.headers.location).toBeUndefined()
    expect(rejected.json()).toMatchObject({ error: 'invalid_request' })
    const protocolError = new URLSearchParams(params); protocolError.set('response_type', 'token')
    const error = await authorizeForm(protocolError)
    expect(error.status).toBe(302)
    const errorCallback = new URL(error.headers.location!)
    expect(errorCallback.origin + errorCallback.pathname).toBe(redirectUri)
    expect(errorCallback.searchParams.get('iss')).toBe(runtime.config.issuer.href)
    expect(errorCallback.searchParams.get('state')).toBe('native-adapter-state')
    expect(errorCallback.searchParams.has('code')).toBe(false)
    const authorized = await authorizeForm(params)
    expect(authorized.status).toBe(302)
    const pending = new URL(authorized.headers.location!).searchParams.get('request')!
    const approved = await post({ action: 'approve', request: pending, boardIds: ['owned'] })
    expect(approved.status).toBe(200)
    const callback = new URL(approved.json().redirectUrl as string)
    expect(callback.origin + callback.pathname).toBe(redirectUri)
    expect(callback.searchParams.get('iss')).toBe(runtime.config.issuer.href)
    expect(callback.searchParams.get('state')).toBe('native-adapter-state')
    const exchange = (actualRedirect = redirectUri) => request('/api/connector?route=token', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: nativeClient.client_id,
        grant_type: 'authorization_code', code: callback.searchParams.get('code')!, code_verifier: verifier,
        redirect_uri: actualRedirect, resource: runtime.config.resource.href }).toString() })
    expect((await exchange('http://127.0.0.1:54322/callback')).status).toBe(400)
    const tokens = await exchange(); expect(tokens.status).toBe(200)
    expect((await runtime.oauth.accountForToken(tokens.json().access_token as string)).grant.boardIds).toEqual(['owned'])
    expect((await exchange()).status).toBe(400)
  })
  it('cancels once and returns only the stored callback with state and access_denied', async () => {
    const { post, authorize } = await setup()
    const pending = await authorize()
    const cancelled = await post({ action: 'cancel', request: pending.request })
    expect(cancelled.status).toBe(200)
    const redirect = new URL(cancelled.json().redirectUrl as string)
    expect(redirect.origin + redirect.pathname).toBe(client.redirect_uris[0]); expect(redirect.searchParams.get('state')).toBe('expected-state')
    expect(redirect.searchParams.get('error')).toBe('access_denied'); expect(redirect.searchParams.has('code')).toBe(false)
    expect((await post({ action: 'cancel', request: pending.request })).status).toBe(400)
  })
  it('rejects durable pending requests and codes after their exact registered callback is removed', async () => {
    const { pg, runtime, post, authorize } = await setup()
    const pending = await authorize()
    const changedClient = { ...client, redirect_uris: ['https://chatgpt.test/new-callback'] }
    const reconfigured = createConnectorRuntime({ ...runtime.config, clients: [changedClient] }, pg)
    await expect(reconfigured.oauth.approveConsent(pending.request, 'unavailable', ['owned'])).rejects.toThrow(/callback/)
    const moved = createConnectorRuntime({ ...runtime.config, issuer: new URL('https://moved.test'), resource: new URL('https://moved.test/mcp') }, pg)
    await expect(moved.oauth.consentRequest(pending.request)).rejects.toThrow(/resource/)
    await expect(moved.oauth.approveConsent(pending.request, 'unavailable', ['owned'])).rejects.toThrow(/resource/)
    const approved = await post({ action: 'approve', request: pending.request, boardIds: ['owned'] })
    const code = new URL(approved.json().redirectUrl as string).searchParams.get('code')!
    await expect(reconfigured.oauth.challengeForAuthorizationCode(changedClient, code)).rejects.toThrow(/callback/)
    await expect(moved.oauth.challengeForAuthorizationCode(client, code)).rejects.toThrow(/resource/)
  })
})

describe('authenticated MCP JSON adapter boundaries', () => {
  it.each([false, true, 'restored', 'raw-buffer'] as const)('bounds valid SDK payloads and preserves OAuth forms (preparsed=%s)', async preparsed => {
    const { runtime, request, post, bodyObservations } = await setup(preparsed)
    const verifier = randomBytes(32).toString('base64url')
    const params = new URLSearchParams({ client_id: client.client_id, redirect_uri: client.redirect_uris[0], response_type: 'code',
      state: 'body-boundary-state', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      resource: runtime.config.resource.href, scope: 'boards:read' })
    const authorized = await request('/api/connector?route=authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() })
    expect(authorized.status).toBe(302)
    const pending = new URL(authorized.headers.location!).searchParams.get('request')!
    const approved = await post({ action: 'approve', request: pending, boardIds: ['owned'] })
    expect(approved.status).toBe(200)
    const callback = new URL(approved.json().redirectUrl as string)
    expect(callback.searchParams.get('state')).toBe('body-boundary-state')
    const tokenResponse = await request('/api/connector?route=token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, grant_type: 'authorization_code', code: callback.searchParams.get('code')!,
        code_verifier: verifier, redirect_uri: client.redirect_uris[0], resource: runtime.config.resource.href }).toString() })
    expect(tokenResponse.status).toBe(200)
    const access = tokenResponse.json().access_token as string
    const headers = { authorization: `Bearer ${access}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
    const rpc = (body: string | Buffer, extras: Record<string, string> = {}, path = '/api/connector?route=mcp') => request(path, { method: 'POST', headers: { ...headers, ...extras }, body })
    expect((await rpc(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'body-boundary-fixture', version: '1' } } }))).status).toBe(200)
    const ping = (padding: string) => JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: { _meta: { padding } } })
    const limit = 1024 * 1024
    const remaining = limit - Buffer.byteLength(ping(''))
    const padding = '🙂'.repeat(Math.floor(remaining / 4)) + 'x'.repeat(remaining % 4)
    const exact = ping(padding)
    expect(Buffer.byteLength(exact)).toBe(limit)
    expect(exact.length).toBeLessThan(limit)
    const small = ping('fixture')
    const whitespace = ' '.repeat(1_200_000) + small
    const escaped = ping('a'.repeat(210_000)).replace(/a/g, '\\u0061')
    expect(Buffer.byteLength(escaped)).toBeGreaterThan(limit)
    expect(Buffer.byteLength(JSON.stringify(JSON.parse(escaped)))).toBeLessThan(limit)
    const cases: [string, string, number, Record<string, string>?][] = [
      ['small', small, 200], ['exact UTF-8 limit', exact, 200], ['one UTF-8 byte over limit', ping(padding + 'x'), 413],
      ['large metadata', ping('x'.repeat(1_200_000)), 413], ['large multi-byte metadata', ping('🙂'.repeat(300_000)), 413],
      ['chunked whitespace', whitespace, preparsed === true ? 200 : 413],
      ['chunked Unicode escapes', escaped, preparsed === true ? 200 : 413],
      ['declared whitespace bytes', whitespace, 413, { 'content-length': String(Buffer.byteLength(whitespace)) }],
      ['normal JSON parameters', small, 200, { 'content-type': 'application/json; charset=utf-8' }],
      ['normalized JSON media type', small, 200, { 'content-type': 'Application/JSON; charset=UTF-8' }],
      ['JSON-looking media type', small, 415, { 'content-type': 'application/jsonp' }],
      ['large JSON-looking media type', ping('x'.repeat(1_200_000)), 415, { 'content-type': 'text/application/json' }],
      ['wrong Accept', small, 406, { accept: 'application/json' }],
    ]
    for (const [label, body, status, extras] of cases) {
      const response = await rpc(body, extras)
      expect(response.status, label).toBe(status)
      if (status === 200) expect(response.json().result, label).toEqual({})
      if (status === 413) expect(response.json(), label).toEqual({ jsonrpc: '2.0', error: { code: -32600, message: 'MCP request exceeds the 1 MiB JSON limit' }, id: null })
      if (status === 415) expect(response.json(), label).toEqual({ jsonrpc: '2.0', error: { code: -32600, message: 'Invalid MCP request' }, id: null })
    }
    const duplicateType = await request('/api/connector?route=mcp', { method: 'POST',
      headers: { ...headers, 'content-type': ['application/json', 'application/jsonp'] }, body: small })
    expect(duplicateType.status).toBe(415)
    const malformed = await rpc('{fixture-private-malformed-body')
    expect(malformed.status).toBe(400)
    expect(malformed.json()).toEqual({ jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON request' }, id: null })
    expect(malformed.body).not.toMatch(/fixture-private|SyntaxError|node_modules|DOCTYPE/)
    for (const [encoding, compress] of [['gzip', gzipSync], ['deflate', deflateSync], ['br', brotliCompressSync]] as const) {
      const compressed = await rpc(compress(small), { 'content-encoding': encoding })
      expect(compressed.status, encoding).toBe(preparsed ? 415 : 200)
      if (!preparsed) expect(compressed.json().result).toEqual({})
      const expanded = await rpc(compress(ping('x'.repeat(1_200_000))), { 'content-encoding': encoding })
      expect(expanded.status, encoding).toBe(preparsed ? 415 : 413)
      if (preparsed) expect(bodyObservations.at(-1)?.getterReads, encoding).toBe(0)
    }
    expect((await rpc(small, { 'content-encoding': 'identity' })).status).toBe(200)
    if (preparsed) {
      // Even a supplied decoded object is ambiguous when an encoding header remains.
      expect((await rpc(small, { 'content-encoding': 'gzip' })).status).toBe(415)
      expect(bodyObservations.at(-1)?.getterReads).toBe(0)
    }
    for (const path of ['/direct/mcp/', '/direct/MCP', '/direct/MCP/']) {
      expect((await rpc(small, {}, path)).status, path).toBe(200)
      expect((await rpc(whitespace, {}, path)).status, path).toBe(preparsed === true ? 200 : 413)
      expect((await rpc(whitespace, { 'content-length': String(Buffer.byteLength(whitespace)) }, path)).status, path).toBe(413)
      expect((await rpc(gzipSync(small), { 'content-encoding': 'gzip' }, path)).status, path).toBe(preparsed ? 415 : 200)
      const malformedAlias = await rpc('{alias-private-malformed-body', {}, path)
      expect(malformedAlias.status, path).toBe(400)
      expect(malformedAlias.json(), path).toEqual({ jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON request' }, id: null })
      expect(malformedAlias.body).not.toMatch(/alias-private|SyntaxError|node_modules|DOCTYPE/)
    }
    for (const method of ['GET', 'POST']) {
      const response = await request('/api/connector?route=mcp', { method, headers: { 'content-type': 'application/json' }, ...(method === 'POST' ? { body: small } : {}) })
      expect(response.status).toBe(401)
      expect(response.headers['www-authenticate']).toContain('oauth-protected-resource/mcp')
      expect(bodyObservations.at(-1)?.getterReads).toBe(0)
    }
    for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
      const methodBody = preparsed && method !== 'GET' && method !== 'HEAD' ? '{method-must-not-read-lazy-body' : undefined
      const response = await request('/api/connector?route=mcp', { method,
        headers: methodBody ? { ...headers, 'content-length': String(Buffer.byteLength(methodBody)) } : headers, body: methodBody })
      expect(response.status, method).toBe(405)
      expect(response.headers.allow, method).toBe('POST, OPTIONS')
      expect(bodyObservations.at(-1)?.getterReads, method).toBe(0)
    }
    const unauthenticatedMalformed = await request('/api/connector?route=mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{fixture-private-malformed-body' })
    expect(unauthenticatedMalformed.status).toBe(preparsed ? 401 : 400)
    expect(bodyObservations.at(-1)?.getterReads).toBe(0)
    const deniedHeaders: Record<string, string>[] = [{ host: 'evil.test' }, { origin: 'https://evil.test' }]
    for (const extras of deniedHeaders) {
      const response = await rpc('{fixture-private-malformed-body', extras)
      expect(response.status).toBe('host' in extras ? 421 : 403)
      expect(bodyObservations.at(-1)?.getterReads).toBe(0)
    }
    expect((await request('/api/connector?route=mcp', { method: 'OPTIONS', headers: { origin: 'https://chatgpt.test' } })).status).toBe(204)
    const isMcpObservation = (observation: { path: string }) => observation.path === '/api/connector?route=mcp' || /^\/direct\/mcp\/?$/i.test(observation.path)
    const mcpObservations = bodyObservations.filter(isMcpObservation)
    if (preparsed === 'restored') {
      expect(mcpObservations.some(observation => observation.recoveredBytes.includes(limit + 1))).toBe(true)
      expect(mcpObservations.flatMap(observation => observation.recoveredBytes).every(bytes => bytes <= limit + 1)).toBe(true)
    } else if (!preparsed || preparsed === 'raw-buffer') expect(mcpObservations.flatMap(observation => observation.recoveredBytes)).toEqual([])
    expect(bodyObservations.filter(observation => !isMcpObservation(observation)).flatMap(observation => observation.recoveredBytes)).toEqual([])
    const revoked = await request('/api/connector?route=revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, token: access }).toString() })
    expect(revoked.status).toBe(200)
    expect((await rpc(small)).status).toBe(401)
  }, 15_000)
})

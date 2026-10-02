// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { request as httpRequest, type Server } from 'node:http'
import type { Response as ExpressResponse } from 'express'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { createConnectorRuntime } from '/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci/api/_lib/connector-runtime.ts'
import type { ConnectorConfig } from '/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci/api/_lib/connector-config.ts'
import type { OAuthRecords } from '/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci/mcp-server/src/oauth.ts'
import { SqlOAuthStore, type SqlExecutor } from '/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci/mcp-server/src/oauth-store.ts'

// The full app suite supplies browser SDK mocks; these are actual-SDK tests.
vi.unmock('@supabase/supabase-js')

const diagnosticStart = process.hrtime.bigint()
const mark = (stage: string) => console.error('LIFECYCLE_PHASE', JSON.stringify({ stage, elapsedMs: Number(process.hrtime.bigint() - diagnosticStart) / 1e6 }))
const userId = '11111111-1111-4111-8111-111111111111'
const boardId = '22222222-2222-4222-8222-222222222222'
const client: OAuthClientInformationFull = { client_id: 'lifecycle-fixture', client_name: 'Lifecycle fixture',
  redirect_uris: ['https://client.fixture.invalid/callback'], token_endpoint_auth_method: 'none' }
const digest = (value: string) => createHash('sha256').update(value).digest('hex')

function deferred<T>() {
  let settle!: (value: T) => void
  const promise = new Promise<T>(resolve => { settle = resolve })
  return { promise, resolve: settle }
}

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  }
})

async function fixture() {
  mark('fixture:start')
  const pg = new PGlite()
  let server: Server | undefined
  const pending = new Set<Promise<unknown>>()
  const releases: (() => void)[] = []
  cleanups.push(async () => {
    for (const release of releases) release()
    await Promise.allSettled([...pending])
    try {
      if (server) await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve()))
    } finally {
      await pg.close()
    }
  })
  await pg.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values ('${userId}');`)
  mark('initial-catalog-ready')
  for (const filename of ['20261001142109_plugin_oauth_records.sql', '20261002030041_plugin_connector_vault.sql']) {
    await pg.exec(await readFile(new URL(`file:///Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/work/zeroboard-ai-ci/supabase/migrations/${filename}`), 'utf8'))
    mark('migration:'+filename)
  }
  const clock = { now: Date.now() }
  vi.spyOn(Date, 'now').mockImplementation(() => clock.now)
  const accountToken = `fixture.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(clock.now / 1000) + 3600 })).toString('base64url')}.fixture`
  const config: ConnectorConfig = {
    issuer: new URL('https://lifecycle.fixture.invalid'), resource: new URL('https://lifecycle.fixture.invalid/mcp'),
    consentUrl: new URL('https://lifecycle.fixture.invalid/auth/connector'), databaseUrl: 'postgres://fixture:fixture@fixture.invalid/fixture',
    vaultKey: Buffer.alloc(32, 1), proposalKey: 'disposable-lifecycle-proposal-key-at-least-32-bytes',
    supabaseUrl: 'https://supabase.fixture.invalid', publishableKey: 'fixture-public-key',
    clients: [client], allowedOrigins: [],
  }
  let consumeHold: { kind: 'pending' | 'code'; reached: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined
  let grantHold: { reached: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined
  const sql: SqlExecutor = { async query(statement, values) {
    const result = await pg.query<{ value: unknown }>(statement, values)
    // Hold only delivery of the real database result: the DELETE already ran.
    if (consumeHold && statement.trimStart().toLowerCase().startsWith('delete from zeroboard_oauth.records') && values[0] === consumeHold.kind) {
      const hold = consumeHold
      consumeHold = undefined
      hold.reached.resolve(undefined)
      await hold.release.promise
    }
    if (grantHold && statement.trimStart().toLowerCase().startsWith('select value from zeroboard_oauth.records') && values[0] === 'grant') {
      const hold = grantHold
      grantHold = undefined
      hold.reached.resolve(undefined)
      await hold.release.promise
    }
    return { rows: result.rows }
  } }
  const runtime = createConnectorRuntime(config, sql)
  mark('runtime-ready')
  const store = new SqlOAuthStore(sql)
  let authHold: { reached: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined
  let boardHold: { reached: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> } | undefined
  let authRequests = 0
  const boardRequests: string[] = []
  const row = { id: boardId, user_id: userId, name: 'Lifecycle fixture board', description: null,
    data: { columns: [] }, created_at: new Date(clock.now).toISOString(), updated_at: new Date(clock.now).toISOString(),
    is_public: false, embed_enabled: false }
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    expect(url.origin).toBe('https://supabase.fixture.invalid')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${accountToken}`)
    if (url.pathname === '/auth/v1/user') {
      authRequests++
      if (authHold) {
        const hold = authHold
        authHold = undefined
        hold.reached.resolve(undefined)
        await hold.release.promise
      }
      return Response.json({ id: userId, email: 'lifecycle@fixture.invalid' })
    }
    if (url.pathname === '/rest/v1/boards') {
      boardRequests.push(init?.method ?? 'GET')
      expect(init?.method ?? 'GET').toBe('GET')
      expect(url.searchParams.get('id')).toBe(`eq.${boardId}`)
      if (boardHold) {
        const hold = boardHold
        boardHold = undefined
        hold.reached.resolve(undefined)
        await hold.release.promise
      }
      return Response.json([row])
    }
    throw new Error(`Unexpected lifecycle fixture transport: ${url.pathname}`)
  }))
  function track<T>(promise: Promise<T>): Promise<T> {
    pending.add(promise)
    void promise.then(() => pending.delete(promise), () => pending.delete(promise))
    return promise
  }
  async function start() {
    server = await new Promise<Server>((resolve, reject) => {
      const listener = runtime.app.listen(0, '127.0.0.1', () => resolve(listener))
      listener.once('error', reject)
    })
  }
  function mcp(token: string) {
    if (!server) throw new Error('Fixture server not started')
    const port = (server.address() as { port: number }).port
    return track(new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_board', arguments: { boardId } } })
      const request = httpRequest(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: {
        host: config.resource.host, authorization: `Bearer ${token}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'content-length': Buffer.byteLength(body),
      } }, response => {
        const chunks: Buffer[] = []
        response.on('data', chunk => chunks.push(Buffer.from(chunk)))
        response.on('error', reject)
        response.on('end', () => resolve({ status: response.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString()) }))
      })
      request.on('error', reject)
      request.end(body)
    }))
  }
  function holdAuth() {
    const hold = { reached: deferred<void>(), release: deferred<void>() }
    authHold = hold
    releases.push(() => hold.release.resolve(undefined))
    return hold
  }
  function holdConsume(kind: 'pending' | 'code') {
    const hold = { kind, reached: deferred<void>(), release: deferred<void>() }
    consumeHold = hold
    releases.push(() => hold.release.resolve(undefined))
    return hold
  }
  function holdGrant() {
    const hold = { reached: deferred<void>(), release: deferred<void>() }
    grantHold = hold
    releases.push(() => hold.release.resolve(undefined))
    return hold
  }
  function holdBoard() {
    const hold = { reached: deferred<void>(), release: deferred<void>() }
    boardHold = hold
    releases.push(() => hold.release.resolve(undefined))
    return hold
  }
  async function seed(options: { tokenExpires?: number; grantExpires?: number; accountExpires?: number } = {}) {
    const accountRef = await runtime.vault.save({ accessToken: accountToken, userId, expires: options.accountExpires ?? clock.now + 300_000 })
    const grant: OAuthRecords['grant'] = { id: 'fixture-grant', userId, clientId: client.client_id, boardIds: [boardId],
      scopes: ['boards:read', 'cards:add'], accountRef, issuer: config.issuer.href, resource: config.resource.href,
      expires: options.grantExpires ?? clock.now + 300_000, revoked: false }
    await store.put('grant', grant.id, grant)
    const token = 'fixture-opaque-token'
    await store.put('token', digest(token), { grantId: grant.id, expires: options.tokenExpires ?? grant.expires })
    return { token, grant, accountRef }
  }
  async function authorize() {
    let location = ''
    await runtime.oauth.authorize(client, { redirectUri: client.redirect_uris[0], codeChallenge: 'a'.repeat(43),
      resource: config.resource, scopes: ['boards:read', 'cards:add'] }, {
      redirect(url: string) { location = url },
    } as unknown as ExpressResponse)
    return new URL(location).searchParams.get('request')!
  }
  async function count(kind: keyof OAuthRecords) {
    return (await pg.query<{ count: number }>('select count(*)::integer as count from zeroboard_oauth.records where kind=$1', [kind])).rows[0].count
  }
  return { pg, runtime, store, clock, boardRequests, get authRequests() { return authRequests }, track, start, mcp,
    holdAuth, holdConsume, holdGrant, holdBoard, seed, authorize, count, accountToken }
}

describe('MCP authority after awaited account resolution', () => {
  it('allows a current account to dispatch the actual hosted board tool', async () => {
    const f = await fixture()
    const { token } = await f.seed()
    mark('seed-ready')
    await f.start()
    mark('listener-ready')
    const response = await f.mcp(token)
    mark('tool-response')
    expect(response.status).toBe(200)
    expect(response.body.result).not.toHaveProperty('isError', true)
    expect(f.authRequests).toBe(1)
    expect(f.boardRequests).toEqual(['GET'])
  })

  it('does not construct new tool authority after revocation settles during held getUser', async () => {
    const f = await fixture()
    const { token, grant, accountRef } = await f.seed()
    await f.start()
    const hold = f.holdAuth()
    const response = f.mcp(token)
    await hold.reached.promise
    await f.runtime.oauth.revokeConnection(grant.id, userId)
    await f.runtime.vault.remove(accountRef)
    expect((await f.store.get('grant', grant.id))?.revoked).toBe(true)
    await expect(f.runtime.vault.load(accountRef)).rejects.toThrow(/expired/)
    // A genuinely new request after completed revoke is already denied.
    expect((await f.mcp(token)).status).toBe(401)
    expect(f.boardRequests).toEqual([])
    hold.release.resolve(undefined)
    expect.soft((await response).status).toBe(401)
    expect.soft(f.boardRequests).toEqual([])
  })

  it.each(['token', 'grant', 'account'] as const)('rejects %s expiry crossed during held getUser before tool dispatch', async expired => {
    const f = await fixture()
    // Independent seeded guards deliberately isolate token/grant/account expiry;
    // this does not claim normal issuance grants a lifetime beyond its session.
    const deadline = f.clock.now + 30_000
    const { token } = await f.seed({ tokenExpires: expired === 'token' ? deadline : f.clock.now + 300_000,
      grantExpires: expired === 'grant' ? deadline : f.clock.now + 300_000,
      accountExpires: expired === 'account' ? deadline : f.clock.now + 300_000 })
    await f.start()
    const hold = f.holdAuth()
    const response = f.mcp(token)
    await hold.reached.promise
    f.clock.now = deadline
    hold.release.resolve(undefined)
    expect.soft((await response).status).toBe(401)
    expect.soft(f.boardRequests).toEqual([])
  })
})

describe('Single-use pending/code consumption', () => {
  it.each(['pending', 'code'] as const)('does not return an already-expired %s from the actual consume statement', async kind => {
    const f = await fixture()
    const value = kind === 'pending'
      ? { clientId: client.client_id, params: { redirectUri: client.redirect_uris[0], codeChallenge: 'a'.repeat(43),
        resource: f.runtime.config.resource.href, scopes: ['boards:read'] }, expires: f.clock.now - 60_000 }
      : { grantId: 'fixture-grant', clientId: client.client_id, redirectUri: client.redirect_uris[0], challenge: 'a'.repeat(43),
        resource: f.runtime.config.resource.href, expires: f.clock.now - 60_000 }
    if (kind === 'pending') await f.store.put('pending', 'expired-record', value as OAuthRecords['pending'])
    else await f.store.put('code', 'expired-record', value as OAuthRecords['code'])
    expect(await f.store.take(kind, 'expired-record')).toBeUndefined()
  })

  it.each(['pending', 'code'] as const)('keeps exactly one winner for concurrent valid %s consumption', async kind => {
    const f = await fixture()
    const value = kind === 'pending'
      ? { clientId: client.client_id, params: { redirectUri: client.redirect_uris[0], codeChallenge: 'a'.repeat(43),
        resource: f.runtime.config.resource.href, scopes: ['boards:read'] }, expires: f.clock.now + 60_000 }
      : { grantId: 'fixture-grant', clientId: client.client_id, redirectUri: client.redirect_uris[0], challenge: 'a'.repeat(43),
        resource: f.runtime.config.resource.href, expires: f.clock.now + 60_000 }
    if (kind === 'pending') await f.store.put('pending', 'valid-record', value as OAuthRecords['pending'])
    else await f.store.put('code', 'valid-record', value as OAuthRecords['code'])
    const results = await Promise.all([f.store.take(kind, 'valid-record'), f.store.take(kind, 'valid-record')])
    expect(results.filter(Boolean)).toEqual([value])
    expect(await f.store.get(kind, 'valid-record')).toBeUndefined()
  })

  it.each(['pending', 'code'] as const)('uses current SQL clock instead of the earlier transaction time for %s consumption', async kind => {
    const f = await fixture()
    await f.pg.exec('begin')
    try {
      // PGlite's WASI clock uses Date.now. Advancing it after BEGIN controls the
      // actual SQL clock while transaction_timestamp remains the earlier time.
      f.clock.now += 60_000
      const value = kind === 'pending'
        ? { clientId: client.client_id, params: { redirectUri: client.redirect_uris[0], codeChallenge: 'a'.repeat(43),
          resource: f.runtime.config.resource.href, scopes: ['boards:read'] }, expires: f.clock.now - 1 }
        : { grantId: 'fixture-grant', clientId: client.client_id, redirectUri: client.redirect_uris[0], challenge: 'a'.repeat(43),
          resource: f.runtime.config.resource.href, expires: f.clock.now - 1 }
      if (kind === 'pending') await f.store.put('pending', 'transaction-expired', value as OAuthRecords['pending'])
      else await f.store.put('code', 'transaction-expired', value as OAuthRecords['code'])
      const actual = await f.pg.query<{ afterStart: boolean; expired: boolean }>(
        'select expires_at > transaction_timestamp() as "afterStart", expires_at <= clock_timestamp() as expired from zeroboard_oauth.records where kind=$1 and key=$2',
        [kind, 'transaction-expired'])
      expect(actual.rows).toEqual([{ afterStart: true, expired: true }])
      expect(await f.store.take(kind, 'transaction-expired')).toBeUndefined()
    } finally {
      await f.pg.exec('rollback')
    }
  })

  it('does not issue a grant/code when pending consumption settles after its returned record expires', async () => {
    const f = await fixture()
    const accountRef = await f.runtime.vault.save({ accessToken: f.accountToken, userId, expires: f.clock.now + 300_000 })
    const requestId = await f.authorize()
    const record = (await f.store.get('pending', digest(requestId)))!
    const deadline = f.clock.now + 30_000
    await f.store.put('pending', digest(requestId), { ...record, expires: deadline })
    const hold = f.holdConsume('pending')
    const approval = f.track(f.runtime.oauth.approveConsent(requestId, accountRef, [boardId]))
    // Observe rejection immediately too, so an intended failure cannot be unhandled.
    const result = approval.then(value => ({ value }), error => ({ error }))
    await hold.reached.promise
    expect(await f.store.get('pending', digest(requestId))).toBeUndefined()
    f.clock.now = deadline
    hold.release.resolve(undefined)
    const outcome = await result
    expect.soft(outcome).toHaveProperty('error')
    if ('error' in outcome) expect(outcome.error).toHaveProperty('message', expect.stringMatching(/expired/i))
    expect.soft(await f.count('grant')).toBe(0)
    expect.soft(await f.count('code')).toBe(0)
  })

  it('does not issue a token when code consumption settles after its returned record expires', async () => {
    const f = await fixture()
    const { grant } = await f.seed()
    // Remove the seed token so only authority issued by this exchange is counted.
    await f.pg.query("delete from zeroboard_oauth.records where kind='token'")
    const code = 'fixture-single-use-code'
    const deadline = f.clock.now + 30_000
    await f.store.put('code', digest(code), { grantId: grant.id, clientId: client.client_id, redirectUri: client.redirect_uris[0],
      challenge: 'a'.repeat(43), resource: f.runtime.config.resource.href, expires: deadline })
    const hold = f.holdConsume('code')
    const exchange = f.track(f.runtime.oauth.exchangeAuthorizationCode(client, code, undefined, client.redirect_uris[0], f.runtime.config.resource))
    const result = exchange.then(value => ({ value }), error => ({ error }))
    await hold.reached.promise
    expect(await f.store.get('code', digest(code))).toBeUndefined()
    f.clock.now = deadline
    hold.release.resolve(undefined)
    const outcome = await result
    expect.soft(outcome).toHaveProperty('error')
    if ('error' in outcome) expect(outcome.error).toHaveProperty('message', expect.stringMatching(/expired/i))
    expect.soft(await f.count('token')).toBe(0)
  })

  it('does not issue grant/code when the resolved account expires during a held board-access read', async () => {
    const f = await fixture()
    const deadline = f.clock.now + 30_000
    const accountRef = await f.runtime.vault.save({ accessToken: f.accountToken, userId, expires: deadline })
    const requestId = await f.authorize()
    const hold = f.holdBoard()
    const approval = f.track(f.runtime.oauth.approveConsent(requestId, accountRef, [boardId]))
    const result = approval.then(value => ({ value }), error => ({ error }))
    await hold.reached.promise
    expect(f.authRequests).toBe(1)
    expect((await f.store.get('pending', digest(requestId)))!.expires).toBeGreaterThan(deadline)
    f.clock.now = deadline
    hold.release.resolve(undefined)
    const outcome = await result
    expect.soft(outcome).toHaveProperty('error')
    if ('error' in outcome) expect(outcome.error).toHaveProperty('message', expect.stringMatching(/expired/i))
    expect.soft(await f.count('grant')).toBe(0)
    expect.soft(await f.count('code')).toBe(0)
  })

  it('does not issue a token when a consumed code expires during the later held grant lookup', async () => {
    const f = await fixture()
    const { grant } = await f.seed()
    await f.pg.query("delete from zeroboard_oauth.records where kind='token'")
    const code = 'fixture-code-held-grant'
    const deadline = f.clock.now + 30_000
    await f.store.put('code', digest(code), { grantId: grant.id, clientId: client.client_id, redirectUri: client.redirect_uris[0],
      challenge: 'a'.repeat(43), resource: f.runtime.config.resource.href, expires: deadline })
    const hold = f.holdGrant()
    const exchange = f.track(f.runtime.oauth.exchangeAuthorizationCode(client, code, undefined, client.redirect_uris[0], f.runtime.config.resource))
    const result = exchange.then(value => ({ value }), error => ({ error }))
    await hold.reached.promise
    expect(await f.store.get('code', digest(code))).toBeUndefined()
    f.clock.now = deadline
    hold.release.resolve(undefined)
    const outcome = await result
    expect.soft(outcome).toHaveProperty('error')
    if ('error' in outcome) expect(outcome.error).toHaveProperty('message', expect.stringMatching(/expired/i))
    expect.soft(await f.count('token')).toBe(0)
  })

  it('retains ordinary approval, valid code exchange and new token account resolution', async () => {
    const f = await fixture()
    const accountRef = await f.runtime.vault.save({ accessToken: f.accountToken, userId, expires: f.clock.now + 300_000 })
    const requestId = await f.authorize()
    const redirect = new URL(await f.runtime.oauth.approveConsent(requestId, accountRef, [boardId]))
    const tokens = await f.runtime.oauth.exchangeAuthorizationCode(client, redirect.searchParams.get('code')!, undefined,
      client.redirect_uris[0], f.runtime.config.resource)
    expect(tokens.expires_in).toBeGreaterThan(0)
    expect(tokens.expires_in).toBeLessThanOrEqual(300)
    expect((await f.runtime.oauth.accountForToken(tokens.access_token)).user.id).toBe(userId)
    expect(await f.count('grant')).toBe(1)
    expect(await f.count('code')).toBe(0)
    expect(await f.count('token')).toBe(1)
  })
})

// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import postgres from 'postgres'
import { readFile, readdir } from 'node:fs/promises'
import { createServer, type Socket } from 'node:net'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createConnectorSqlExecutor } from '../connector-sql.js'
import { createConnectorRuntime } from '../connector-runtime.js'
import { readConnectorConfig } from '../connector-config.js'

function frame(type: string, body: Buffer) {
  const header = Buffer.alloc(5)
  header[0] = type.charCodeAt(0)
  header.writeInt32BE(body.length + 4, 1)
  return Buffer.concat([header, body])
}
const handshake = Buffer.concat([
  frame('R', Buffer.alloc(4)),
  frame('S', Buffer.from('server_version\x0017.5\x00')),
  frame('S', Buffer.from('client_encoding\x00UTF8\x00')),
  frame('S', Buffer.from('integer_datetimes\x00on\x00')),
  frame('Z', Buffer.from('I')),
])

async function catalogFixture(pg: PGlite) {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key); create table auth.sessions(id uuid);
    revoke create on schema public from public;
    create role connector_fixture login nosuperuser nobypassrls;`)
  const directory = new URL('../../../supabase/migrations/', import.meta.url)
  const files = await readdir(directory)
  for (const suffix of ['plugin_oauth_records.sql', 'plugin_connector_vault.sql']) {
    await pg.exec(await readFile(new URL(files.find(name => name.endsWith(suffix))!, directory), 'utf8'))
  }
  await pg.exec('grant zeroboard_connector to connector_fixture; set session authorization connector_fixture')
}

/** Only the startup handshake is synthetic; statement packets execute in real PG. */
async function wireFixture() {
  const engines = new Set<PGlite>()
  const sockets = new Set<Socket>()
  const pending = new Set<Promise<unknown>>()
  const errors: unknown[] = []
  const stats = { overlaps: 0, started: 0, completed: 0, active: 0, maximumActive: 0 }
  const server = createServer(socket => {
    sockets.add(socket)
    const pg = new PGlite()
    engines.add(pg)
    let chain: Promise<unknown> = catalogFixture(pg)
    let buffer = Buffer.alloc(0)
    let startup = true
    let active = 0
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk])
      while (buffer.length >= 5) {
        const length = startup ? buffer.readInt32BE(0) : buffer.readInt32BE(1) + 1
        if (buffer.length < length) break
        const message = buffer.subarray(0, length)
        buffer = buffer.subarray(length)
        if (startup) {
          startup = false
          chain = chain.then(() => { socket.write(handshake) })
          continue
        }
        const type = String.fromCharCode(message[0])
        if (type === 'X') { socket.end(); continue }
        // A Query or Parse starts a new statement. Bind/Describe/Execute/Flush
        // may follow before Sync, particularly while the driver learns types.
        if (type === 'Q' || type === 'P') {
          if (active > 0) stats.overlaps++
          active++
          stats.started++
          stats.active++
          stats.maximumActive = Math.max(stats.maximumActive, stats.active)
        }
        chain = chain.then(async () => {
          const answer = Buffer.from(await pg.execProtocolRaw(message))
          // Let another socket make progress before sending the reply, as a
          // real network can do. Do not change or fabricate statement results.
          await nextTurn()
          for (let offset = 0; offset < answer.length;) {
            if (answer[offset] === 90) {
              active--
              stats.active--
              stats.completed++
            }
            offset += answer.readInt32BE(offset + 1) + 1
          }
          if (answer.length) socket.write(answer)
        }).catch(error => { errors.push(error); socket.destroy() })
        const current = chain
        pending.add(current)
        void current.finally(() => { pending.delete(current) })
      }
    })
    socket.on('error', error => { errors.push(error) })
    socket.on('close', () => { sockets.delete(socket) })
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP fixture')
  return { port: address.port, stats, errors, async close() {
    for (const socket of sockets) socket.destroy()
    await new Promise<void>(resolve => server.close(() => resolve()))
    await Promise.all(pending)
    for (const pg of engines) await pg.close()
  } }
}

function config() {
  return readConnectorConfig({ ZEROBOARD_CONNECTOR_ENABLED: 'true', ZEROBOARD_CONNECTOR_ISSUER: 'https://connector.test',
    ZEROBOARD_CONNECTOR_DATABASE_URL: 'postgres://connector:fixture@db.test/postgres',
    ZEROBOARD_CONNECTOR_VAULT_KEY: Buffer.alloc(32, 1).toString('base64'),
    ZEROBOARD_CONNECTOR_PROPOSAL_KEY: 'fixture-proposal-key-with-at-least-32-bytes',
    ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([{ client_id: 'fixture', client_name: 'Fixture', redirect_uris: ['https://client.test/callback'], token_endpoint_auth_method: 'none' }]),
    SUPABASE_URL: 'https://supabase.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' })!
}

describe('connector executor with the actual postgres.js wire protocol', () => {
  it('detects the same-socket pipelining made by the unreserved driver', async () => {
    const fixture = await wireFixture()
    const sql = postgres({ host: '127.0.0.1', port: fixture.port, username: 'connector_fixture', database: 'fixture',
      ssl: false, max: 1, prepare: false, connect_timeout: 5, onnotice() {} })
    try {
      const results = await Promise.all(Array.from({ length: 10 }, () => sql.unsafe('select 42::integer as value', [])))
      expect(results.every(rows => rows[0].value === 42)).toBe(true)
      // Direct PostgreSQL accepts these statements. The observed overlapping
      // wire requests are what the shared transaction pooler cannot safely use.
      expect(fixture.stats.overlaps).toBeGreaterThan(0)
      expect(fixture.stats.completed).toBe(fixture.stats.started)
      expect(fixture.errors).toEqual([])
    } finally {
      await sql.end({ timeout: 1 })
      await fixture.close()
    }
  }, 15_000)

  it.each([1, 2])('does not pipeline on either socket with max=%s and releases errors', async max => {
    const fixture = await wireFixture()
    const sql = postgres({ host: '127.0.0.1', port: fixture.port, username: 'connector_fixture', database: 'fixture',
      ssl: false, max, prepare: false, connect_timeout: 5, onnotice() {} })
    const executor = createConnectorSqlExecutor(sql)
    try {
      const runtime = createConnectorRuntime(config(), executor)
      await Promise.all(Array.from({ length: 10 }, async (_, index) => {
        await runtime.health()
        const { rows } = await executor.query(index % 2 ? 'select $1::integer as value' : 'select 42::integer as value', index % 2 ? [index] : [])
        expect(rows).toEqual([{ value: index % 2 ? index : 42 }])
      }))
      const expected = { fixture: 'a quoted \' value', count: 3 }
      expect((await executor.query('select $1::text::jsonb as value', [JSON.stringify(expected)])).rows).toEqual([{ value: expected }])
      await expect(executor.query('select missing_column from pg_catalog.pg_class', [])).rejects.toMatchObject({ code: '42703' })
      expect((await executor.query('select $1::integer as value', [99])).rows).toEqual([{ value: 99 }])
      // The failing statement cannot leave a lease behind. These later calls
      // need the same bounded pool and continue through the full health check.
      await Promise.all(Array.from({ length: 5 }, () => runtime.health()))
      expect(fixture.errors).toEqual([])
      expect(fixture.stats.overlaps).toBe(0)
      expect(fixture.stats.started).toBeGreaterThan(45)
      expect(fixture.stats.completed).toBe(fixture.stats.started)
      expect(fixture.stats.active).toBe(0)
      expect(fixture.stats.maximumActive).toBe(max)
    } finally {
      await sql.end({ timeout: 1 })
      await fixture.close()
    }
  }, 15_000)
})

// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFile, readdir } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createConnectorRuntime, type ConnectorRuntime } from '../connector-runtime.js'
import { readConnectorConfig } from '../connector-config.js'
import { createConnectorHandler } from '../../connector.js'

const appTables = ['ai_usage', 'board_invites', 'board_members', 'boards', 'card_activities', 'cards', 'columns', 'feedback', 'profiles', 'subscriptions']
const helpers = ['resolve_pending_invites(uuid,text)', 'resolve_pending_invites_for_current_user()', 'handle_new_auth_user()',
  'sync_user_email()', 'get_board_ids_for_user(uuid)', 'get_editable_board_ids_for_user(uuid)']
let pg: PGlite
let runtime: ConnectorRuntime

async function readinessFixture() {
  const pg = new PGlite()
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key); create table auth.sessions(id uuid);
    create schema cron; create table cron.job(id integer); create table cron.job_run_details(id integer);
    grant select on cron.job to public; grant select,delete on cron.job_run_details to public;
    revoke create on schema public from public;
    create role connector_fixture login nosuperuser nobypassrls;`)
  for (const table of appTables) await pg.exec(`create table public.${table}(id uuid, name text)`)
  // Match the restricted helpers' real signatures without reading real user data.
  await pg.exec(`create function public.resolve_pending_invites(uuid,text) returns void language sql security definer as $$ select $$;
    create function public.resolve_pending_invites_for_current_user() returns void language sql security definer as $$ select $$;
    create function public.handle_new_auth_user() returns trigger language plpgsql security definer as $$ begin return new; end $$;
    create function public.sync_user_email() returns trigger language plpgsql security definer as $$ begin return new; end $$;
    create function public.get_board_ids_for_user(uuid) returns setof uuid language sql security definer as $$ select null::uuid where false $$;
    create function public.get_editable_board_ids_for_user(uuid) returns setof uuid language sql security definer as $$ select null::uuid where false $$;`)
  const directory = new URL('../../../supabase/migrations/', import.meta.url)
  const files = await readdir(directory)
  for (const suffix of ['plugin_oauth_records.sql', 'plugin_connector_vault.sql', 'restrict_definer_function_execution.sql']) {
    const filename = files.find(name => name.endsWith(suffix))!
    await pg.exec(await readFile(new URL(filename, directory), 'utf8'))
  }
  await pg.exec(`grant zeroboard_connector to connector_fixture;
    create function public.unrelated_shared_project_helper() returns integer language sql security definer as $$ select 1 $$;`)
  const config = readConnectorConfig({ ZEROBOARD_CONNECTOR_ENABLED: 'true', ZEROBOARD_CONNECTOR_ISSUER: 'https://connector.test',
    ZEROBOARD_CONNECTOR_DATABASE_URL: 'postgres://connector:fixture@db.test/postgres',
    ZEROBOARD_CONNECTOR_VAULT_KEY: Buffer.alloc(32, 1).toString('base64'),
    ZEROBOARD_CONNECTOR_PROPOSAL_KEY: 'fixture-proposal-key-with-at-least-32-bytes',
    ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([{ client_id: 'fixture', client_name: 'Fixture',
      redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }]),
    SUPABASE_URL: 'https://supabase.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture' })!
  return { pg, runtime: createConnectorRuntime(config, pg) }
}
beforeAll(async () => { ({ pg, runtime } = await readinessFixture()) }, 15_000)

beforeEach(async () => {
  await pg.exec('begin; set role connector_fixture')
  await expect(runtime.health()).resolves.toBeUndefined()
})
afterEach(async () => {
  await pg.exec('rollback')
  await pg.exec('reset role')
})
afterAll(async () => { await pg.close() })

async function unhealthy(change: string) {
  await pg.exec(`reset role; ${change}; set role connector_fixture`)
  await expect(runtime.health()).rejects.toThrow('Connector storage unavailable')
}

describe('connector readiness with actual catalog permissions', () => {
  it('accepts the dedicated login with matching current/session identity and unrelated shared-project functions', async () => {
    // Session authorization is connection state, so keep this identity probe separate
    // from the transactional grant fixtures below.
    const matching = await readinessFixture()
    try {
      await matching.pg.exec('set session authorization connector_fixture')
      expect((await matching.pg.query<{ same_identity: boolean }>('select current_user = session_user as same_identity')).rows[0].same_identity).toBe(true)
      expect((await matching.pg.query<{ callable: boolean }>("select has_function_privilege(current_user,'public.unrelated_shared_project_helper()','EXECUTE') as callable")).rows[0].callable).toBe(true)
      await expect(matching.runtime.health()).resolves.toBeUndefined()
    } finally { await matching.pg.close() }
  })

  it.each(['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger', 'maintain'])('rejects direct board %s permission', async privilege => {
    await unhealthy(`grant ${privilege} on public.boards to connector_fixture`)
  })
  it.each(appTables)('rejects access to app table %s', async table => {
    await unhealthy(`grant select on public.${table} to connector_fixture`)
  })
  it('rejects PUBLIC app table access and reports unavailable rather than advertising an endpoint', async () => {
    await unhealthy('grant select on public.boards to public')
    const handler = createConnectorHandler({ runtime: () => runtime,
      authenticate: async () => ({ userId: '11111111-1111-4111-8111-111111111111', email: '', token: 'fixture' }) })
    let body = ''
    const res = { setHeader() {}, end(value: string) { body = value }, statusCode: 0 } as unknown as ServerResponse
    await handler({ url: '/api/connector', method: 'GET', headers: {} } as IncomingMessage, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toMatchObject({ available: false, endpoint: null, connections: [] })
  })
  it('rejects app access inherited through another role', async () => {
    await unhealthy('create role audit_extra; grant select on public.boards to audit_extra; grant audit_extra to connector_fixture')
  })
  it('rejects unknown NOINHERIT membership even before its privileges can be used', async () => {
    await unhealthy('create role audit_extra; grant audit_extra to connector_fixture with inherit false')
  })
  it.each(['authenticated', 'anon', 'service_role'])('rejects inherited %s authorization role', async role => {
    await unhealthy(`grant ${role} to connector_fixture`)
  })
  it.each(['select', 'insert', 'update', 'references'])('rejects column-only %s permission', async privilege => {
    await unhealthy(`grant ${privilege}(name) on public.boards to connector_fixture`)
  })
  it('rejects PUBLIC column access', async () => {
    await unhealthy('grant select(name) on public.boards to public')
  })
  it.each([
    'alter table zeroboard_oauth.records owner to connector_fixture',
    'alter table zeroboard_oauth.sessions owner to zeroboard_connector',
    'alter table public.boards owner to connector_fixture',
  ])('rejects relation ownership: %s', async change => { await unhealthy(change) })
  it.each(['createrole', 'createdb', 'replication', 'bypassrls', 'superuser'])('rejects elevated login attribute %s', async attribute => {
    await unhealthy(`alter role connector_fixture ${attribute}`)
  })
  it('rejects elevated attributes on the inherited private privilege role', async () => {
    await unhealthy('alter role zeroboard_connector createdb')
  })
  it('rejects ADMIN permission on the private role', async () => {
    await unhealthy('grant zeroboard_connector to connector_fixture with admin option')
  })
  it.each(['public', 'auth', 'zeroboard_oauth', 'cron'])('rejects schema creation in %s', async schema => {
    await unhealthy(`grant create on schema ${schema} to connector_fixture`)
  })
  it('rejects private schema ownership', async () => {
    await unhealthy('alter schema zeroboard_oauth owner to connector_fixture')
  })
  it('rejects auth namespace access and direct auth table permission', async () => {
    await unhealthy('grant usage on schema auth to connector_fixture')
    await pg.exec('reset role; revoke usage on schema auth from connector_fixture; grant select on auth.users to connector_fixture; set role connector_fixture')
    await expect(runtime.health()).rejects.toThrow('Connector storage unavailable')
  })
  it.each([
    'grant trigger on zeroboard_oauth.records to connector_fixture',
    'grant select on zeroboard_oauth.records to connector_fixture with grant option',
    'grant select on zeroboard_oauth.records to zeroboard_connector with grant option',
    'grant usage on schema zeroboard_oauth to connector_fixture with grant option',
  ])('rejects unnecessary or delegatable private access: %s', async change => { await unhealthy(change) })
  it.each(helpers)('rejects execution of restricted helper %s', async helper => {
    await unhealthy(`grant execute on function public.${helper} to connector_fixture`)
  })
  it('rejects PUBLIC and inherited helper execution', async () => {
    await unhealthy('grant execute on function public.resolve_pending_invites(uuid,text) to public')
    await pg.exec('reset role; revoke execute on function public.resolve_pending_invites(uuid,text) from public')
    await unhealthy('create role audit_extra; grant execute on function public.resolve_pending_invites(uuid,text) to audit_extra; grant audit_extra to connector_fixture')
  })

  it('accepts extension PUBLIC cron ACLs only while the namespace is inaccessible', async () => {
    // Looking up cron.job by name itself needs namespace USAGE. Its catalog OID
    // lets us demonstrate the PUBLIC table ACL without granting that access.
    expect((await pg.query<{ granted: boolean }>(`select has_table_privilege(current_user,c.oid,'SELECT') as granted
      from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'cron' and c.relname = 'job'`)).rows[0].granted).toBe(true)
    for (const query of ['select * from cron.job', 'select * from cron.job_run_details', 'delete from cron.job_run_details where false']) {
      // A failed statement aborts a PostgreSQL transaction; restore it before the next probe.
      await pg.exec('savepoint cron_probe')
      await expect(pg.query(query)).rejects.toThrow('permission denied for schema cron')
      await pg.exec('rollback to savepoint cron_probe; release savepoint cron_probe')
    }
    await expect(runtime.health()).resolves.toBeUndefined()
  })
  it.each(['connector_fixture', 'public'])('rejects cron namespace USAGE granted to %s', async role => {
    await unhealthy(`grant usage on schema cron to ${role}`)
    // Demonstrate why namespace access is forbidden: shared extension ACLs then become usable.
    await expect(pg.query('select * from cron.job')).resolves.toMatchObject({ rows: [] })
    await expect(pg.query('select * from cron.job_run_details')).resolves.toMatchObject({ rows: [] })
    await expect(pg.query('delete from cron.job_run_details where false')).resolves.toBeDefined()
  })
})

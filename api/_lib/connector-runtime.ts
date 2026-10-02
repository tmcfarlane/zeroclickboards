import postgres from 'postgres'
import type { Express } from 'express'
import { ZeroBoardOAuth } from '../../mcp-server/src/oauth.js'
import type { Grant } from '../../mcp-server/src/oauth.js'
import { SqlOAuthStore, type SqlExecutor } from '../../mcp-server/src/oauth-store.js'
import { createHostedApp } from '../../mcp-server/src/http.js'
import { createNodeClient } from '../../mcp-server/src/node-client.js'
import { bindBoardAccess } from '../../mcp-server/src/board-data.js'
import { SqlSessionVault, type SessionVault } from './connector-vault.js'
import { readConnectorConfig, type ConnectorConfig } from './connector-config.js'

export interface ConnectorRuntime {
  config: ConnectorConfig
  oauth: ZeroBoardOAuth
  vault: SessionVault
  app: Express
  health(): Promise<void>
  listConnections(userId: string): Promise<Grant[]>
  accountClient(token: string, userId: string): ReturnType<typeof createNodeClient>
}

export function createConnectorRuntime(config: ConnectorConfig, sql: SqlExecutor): ConnectorRuntime {
  const store = new SqlOAuthStore(sql)
  const vault = new SqlSessionVault(sql, config.vaultKey)
  const accountClient = (token: string, userId: string) => {
    const client = createNodeClient(config.supabaseUrl, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
    })
    bindBoardAccess(client, { userId })
    return client
  }
  const oauth = new ZeroBoardOAuth({ issuer: config.issuer, resource: config.resource, consentUrl: config.consentUrl,
    store, clients: config.clients, grantDurationMs: 15 * 60_000,
    resolveAccount: async (accountRef) => {
      const session = await vault.load(accountRef)
      // The token authenticates board reads/writes through the user's RLS account;
      // the private SQL role never has board credentials or privileges.
      const client = createNodeClient(config.supabaseUrl, config.publishableKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { Authorization: `Bearer ${session.accessToken}` }, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(8000) }) },
      })
      const { data, error } = await client.auth.getUser(session.accessToken)
      if (error || !data.user || data.user.id !== session.userId) throw new Error('Account session unavailable; reconnect')
      return { client, user: data.user, expires: session.expires }
    },
  })
  return { config, oauth, vault, accountClient,
    app: createHostedApp(oauth, { proposalKey: config.proposalKey, allowedOrigins: config.allowedOrigins }),
    async health() {
      const { rows } = await sql.query(`select (pg_has_role(current_user,'zeroboard_connector','member')
        and not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user)
        and not exists (select 1 from (values ('zeroboard_oauth.records'),('zeroboard_oauth.sessions')) as tables(name)
          cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as permissions(privilege)
          where not has_table_privilege(current_user,tables.name,permissions.privilege))
        and (select count(*) = 2 from pg_policies where schemaname = 'zeroboard_oauth'
          and policyname in ('connector_backend_records','connector_backend_sessions')
          and roles @> array['zeroboard_connector']::name[] and cmd = 'ALL' and qual = 'true' and with_check = 'true')
        and (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'zeroboard_oauth' and c.relname in ('records','sessions') and c.relrowsecurity)) as value`, [])
      if (rows[0]?.value !== true) throw new Error('Connector storage unavailable')
      // Confirm the private schema, every required privilege and backend-only RLS policies.
      await sql.query('select value from zeroboard_oauth.records limit 0', [])
      await sql.query('select encrypted_session as value from zeroboard_oauth.sessions limit 0', [])
    },
    async listConnections(userId) {
      const { rows } = await sql.query(`select value from zeroboard_oauth.records where kind = 'grant' and value->>'userId' = $1
        and expires_at > now() and value->>'revoked' = 'false' order by expires_at desc`, [userId])
      return rows.map(row => row.value as Grant).filter(grant => grant.userId === userId && grant.issuer === config.issuer.href &&
        grant.resource === config.resource.href && config.clients.some(client => client.client_id === grant.clientId))
    },
  }
}

let cached: { signature: string; runtime: ConnectorRuntime } | undefined
/** The SQL pool is warm-instance scoped; MCP/user/auth state is rebuilt on every request. */
export function configuredConnectorRuntime(): ConnectorRuntime | null {
  const config = readConnectorConfig()
  if (!config) return null
  const signature = JSON.stringify({ ...config, vaultKey: config.vaultKey.toString('base64') })
  if (cached?.signature === signature) return cached.runtime
  const sql = postgres(config.databaseUrl, { ssl: { rejectUnauthorized: true, ...(config.databaseCa ? { ca: config.databaseCa } : {}) },
    max: 2, idle_timeout: 20, connect_timeout: 5, prepare: false })
  const executor: SqlExecutor = {
    async query(statement, values) {
      const rows = await sql.unsafe(statement, values as postgres.ParameterOrJSON<never>[])
      return { rows: rows as unknown as { value: unknown }[] }
    },
  }
  const runtime = createConnectorRuntime(config, executor)
  cached = { signature, runtime }
  return runtime
}

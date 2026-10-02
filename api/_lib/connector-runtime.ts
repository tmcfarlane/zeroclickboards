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
import { createConnectorSqlExecutor } from './connector-sql.js'

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
      const { rows } = await sql.query(`with app_relations as (
          select c.*, n.nspname from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where c.relkind in ('r','p','v','m','f')
            -- pg_cron's PUBLIC table ACLs are inaccessible without schema USAGE.
            -- Preserve shared extension grants; always reject cron namespace access below.
            and (n.nspname = 'auth' or (n.nspname = 'cron' and has_schema_privilege(current_user,n.oid,'USAGE'))
              or (n.nspname = 'public' and c.relname in ('ai_usage','board_invites','board_members','boards',
                'card_activities','cards','columns','feedback','profiles','subscriptions')))
        ), private_relations as (
          select c.* from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'zeroboard_oauth' and c.relkind in ('r','p','v','m','f')
        )
        select (pg_has_role(current_user,'zeroboard_connector','member')
        and not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user)
        and not exists (select 1 from (values ('zeroboard_oauth.records'),('zeroboard_oauth.sessions')) as tables(name)
          cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) as permissions(privilege)
          where not has_table_privilege(current_user,tables.name,permissions.privilege))
        and (select count(*) = 2 from pg_policies where schemaname = 'zeroboard_oauth'
          and policyname in ('connector_backend_records','connector_backend_sessions')
          and roles @> array['zeroboard_connector']::name[] and cmd = 'ALL' and qual = 'true' and with_check = 'true')
        and (select count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'zeroboard_oauth' and c.relname in ('records','sessions') and c.relrowsecurity)
        -- Membership includes nested/NOINHERIT roles and possible later SET ROLE paths.
        and not exists (select 1 from pg_roles r where pg_has_role(current_user,r.oid,'MEMBER')
          and (r.rolname not in (current_user,'zeroboard_connector')
            or r.rolsuper or r.rolbypassrls or r.rolcreaterole or r.rolcreatedb or r.rolreplication
            or pg_has_role(current_user,r.oid,'MEMBER WITH ADMIN OPTION')))
        and not has_database_privilege(current_user,current_database(),'CREATE')
        and not exists (select 1 from pg_namespace n where n.nspname in ('public','auth','cron','zeroboard_oauth')
          and (has_schema_privilege(current_user,n.oid,'CREATE') or pg_has_role(current_user,n.nspowner,'MEMBER')
            or has_schema_privilege(current_user,n.oid,'USAGE WITH GRANT OPTION')
            or (n.nspname in ('auth','cron') and has_schema_privilege(current_user,n.oid,'USAGE'))))
        -- An owner can bypass ordinary RLS or grant itself permissions again.
        and not exists (select 1 from (select relowner from app_relations union all select relowner from private_relations) owners
          where pg_has_role(current_user,owners.relowner,'MEMBER'))
        -- Catalog privilege names cover MAINTAIN on PG17 without requiring it on older PG.
        and not exists (select 1 from app_relations c
          cross join lateral aclexplode(coalesce(c.relacl,acldefault('r'::"char",c.relowner))) permission
          where has_table_privilege(current_user,c.oid,permission.privilege_type))
        and not exists (select 1 from app_relations c
          where has_any_column_privilege(current_user,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
        and not exists (select 1 from private_relations c
          cross join lateral aclexplode(coalesce(c.relacl,acldefault('r'::"char",c.relowner))) permission
          where (permission.privilege_type not in ('SELECT','INSERT','UPDATE','DELETE')
              and has_table_privilege(current_user,c.oid,permission.privilege_type))
            or has_table_privilege(current_user,c.oid,permission.privilege_type || ' WITH GRANT OPTION'))
        -- Restrict only the app's protected helpers, not unrelated shared-project functions.
        and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('resolve_pending_invites','resolve_pending_invites_for_current_user',
            'handle_new_auth_user','sync_user_email','get_board_ids_for_user','get_editable_board_ids_for_user')
            and has_function_privilege(current_user,p.oid,'EXECUTE'))) as value`, [])
      if (rows[0]?.value !== true) throw new Error('Connector storage unavailable')
      // Confirm the required schema/policies/CRUD and the login's private-only app boundary.
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
  const runtime = createConnectorRuntime(config, createConnectorSqlExecutor(sql))
  cached = { signature, runtime }
  return runtime
}

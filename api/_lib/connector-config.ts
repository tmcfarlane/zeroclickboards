import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'

export interface ConnectorConfig {
  issuer: URL
  resource: URL
  consentUrl: URL
  databaseUrl: string
  vaultKey: Buffer
  proposalKey: string
  supabaseUrl: string
  publishableKey: string
  clients: OAuthClientInformationFull[]
  allowedOrigins: string[]
}

const httpsUrl = (value: string | undefined, allowSearch = false): URL => {
  const url = new URL(value ?? '')
  if (url.protocol !== 'https:' || url.username || url.password || (!allowSearch && url.search) || url.hash) throw new Error('HTTPS URL required')
  return url
}

/** Server-only configuration. No default callbacks, secrets, or inferred production availability. */
export function readConnectorConfig(env: NodeJS.ProcessEnv = process.env): ConnectorConfig | null {
  if (env.ZEROBOARD_CONNECTOR_ENABLED !== 'true') return null
  const issuer = httpsUrl(env.ZEROBOARD_CONNECTOR_ISSUER)
  if (issuer.pathname !== '/') throw new Error('Origin issuer required')
  const databaseUrl = env.ZEROBOARD_CONNECTOR_DATABASE_URL ?? ''
  if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error('Postgres connection required')
  const vaultKeyText = env.ZEROBOARD_CONNECTOR_VAULT_KEY ?? ''
  const vaultKey = Buffer.from(vaultKeyText, 'base64')
  if (vaultKey.length !== 32 || vaultKey.toString('base64') !== vaultKeyText) throw new Error('32-byte base64 vault key required')
  const proposalKey = env.ZEROBOARD_CONNECTOR_PROPOSAL_KEY ?? ''
  if (Buffer.byteLength(proposalKey) < 32) throw new Error('Stable proposal key required')
  const supabaseUrl = httpsUrl(env.SUPABASE_URL || env.VITE_SUPABASE_URL).href
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || ''
  if (!publishableKey || publishableKey.startsWith('sb_secret_')) throw new Error('Publishable Supabase key required')
  if (publishableKey.split('.').length === 3) {
    const claims = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString())
    if (claims.role !== 'anon') throw new Error('Publishable Supabase key required')
  }
  const raw: unknown = JSON.parse(env.ZEROBOARD_CONNECTOR_CLIENTS ?? 'null')
  if (!Array.isArray(raw) || !raw.length || raw.length > 10) throw new Error('Predefined OAuth clients required')
  const clients: OAuthClientInformationFull[] = raw.map((value: unknown) => {
    const client = value as Record<string, unknown>
    if (!client || typeof client !== 'object' || typeof client.client_id !== 'string' || !client.client_id ||
      typeof client.client_name !== 'string' || !client.client_name || !Array.isArray(client.redirect_uris) ||
      !client.redirect_uris.length || client.token_endpoint_auth_method !== 'none') throw new Error('Invalid public OAuth client')
    const callbacks = client.redirect_uris.map((uri: unknown) => {
      if (typeof uri !== 'string') throw new Error('Exact callbacks required')
      return httpsUrl(uri, true).href
    })
    return { client_id: client.client_id, client_name: client.client_name, redirect_uris: callbacks, token_endpoint_auth_method: 'none' }
  })
  if (new Set(clients.map(c => c.client_id)).size !== clients.length) throw new Error('Distinct client identifiers required')
  const origins: unknown = JSON.parse(env.ZEROBOARD_CONNECTOR_ALLOWED_ORIGINS || '[]')
  if (!Array.isArray(origins) || origins.some(origin => typeof origin !== 'string' || httpsUrl(origin).href !== `${httpsUrl(origin).origin}/`)) throw new Error('Exact origin allowlist required')
  return { issuer, resource: new URL('/mcp', issuer), consentUrl: new URL('/auth/connector', issuer), databaseUrl,
    vaultKey, proposalKey, supabaseUrl, publishableKey, clients, allowedOrigins: [...new Set([issuer.origin, ...origins.map(origin => httpsUrl(origin).origin)])] }
}

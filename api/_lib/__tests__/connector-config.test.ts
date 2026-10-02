// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { readConnectorConfig } from '../connector-config.js'
import { configuredConnectorRuntime } from '../connector-runtime.js'

const driver = vi.hoisted(() => vi.fn(() => ({ unsafe: vi.fn() })))
vi.mock('postgres', () => ({ default: driver }))
const ca = readFileSync(new URL('./fixtures/supabase-database-ca.pem', import.meta.url), 'utf8')
const leaf = readFileSync(new URL('./fixtures/database-leaf.pem', import.meta.url), 'utf8')
const env = (): NodeJS.ProcessEnv => ({
  ZEROBOARD_CONNECTOR_ENABLED: 'true', ZEROBOARD_CONNECTOR_ISSUER: 'https://connector.test',
  ZEROBOARD_CONNECTOR_DATABASE_URL: 'postgres://connector:fixture@db.test/postgres?sslmode=no-verify',
  ZEROBOARD_CONNECTOR_VAULT_KEY: Buffer.alloc(32, 1).toString('base64'),
  ZEROBOARD_CONNECTOR_PROPOSAL_KEY: 'fixture-key-with-at-least-thirty-two-bytes',
  ZEROBOARD_CONNECTOR_CLIENTS: JSON.stringify([{ client_id: 'fixture', client_name: 'Fixture',
    redirect_uris: ['http://127.0.0.1/callback'], token_endpoint_auth_method: 'none' }]),
  SUPABASE_URL: 'https://supabase.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
})
afterEach(() => { vi.unstubAllEnvs(); driver.mockClear() })

describe('verified connector database TLS', () => {
  it('accepts an authoritative public database CA, without treating a leaf certificate as a CA', () => {
    expect(readConnectorConfig({ ...env(), ZEROBOARD_CONNECTOR_DATABASE_CA: ca })?.databaseCa).toBe(ca.trim())
    expect(readConnectorConfig(env())?.databaseCa).toBeUndefined()
    for (const value of ['', 'not a certificate', '-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----', leaf, `${ca}\ngarbage`]) {
      expect(() => readConnectorConfig({ ...env(), ZEROBOARD_CONNECTOR_DATABASE_CA: value })).toThrow('Valid database CA certificate PEM required')
    }
  })

  it.each([undefined, ca])('passes verified TLS to the driver with optional CA and retains default hostname checking', databaseCa => {
    const values = { ...env(), ...(databaseCa ? { ZEROBOARD_CONNECTOR_DATABASE_CA: databaseCa } : {}) }
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value!)
    vi.stubEnv('ZEROBOARD_CONNECTOR_DATABASE_CA', databaseCa)
    expect(configuredConnectorRuntime()).not.toBeNull()
    expect(driver).toHaveBeenCalledOnce()
    const options = (driver.mock.calls[0] as unknown as [string, { ssl: Record<string, unknown> }])[1]
    expect(options.ssl).toEqual({ rejectUnauthorized: true, ...(databaseCa ? { ca: databaseCa.trim() } : {}) })
    // postgres sets the DNS servername and Node's default checkServerIdentity.
    // A no-verify URL option cannot replace the explicit verified SSL object.
    expect(options.ssl).not.toHaveProperty('checkServerIdentity')
  })
})

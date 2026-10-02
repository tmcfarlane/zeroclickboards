import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SqlExecutor } from '../../mcp-server/src/oauth-store.js'

export interface VaultSession { accessToken: string; userId: string; expires: number }
export interface SessionVault {
  save(session: VaultSession): Promise<string>
  load(accountRef: string): Promise<VaultSession>
  remove(accountRef: string): Promise<void>
}

/** Only the current access token is held, never the browser's rotating refresh token. */
export class SqlSessionVault implements SessionVault {
  private readonly sql: SqlExecutor
  private readonly key: Buffer
  constructor(sql: SqlExecutor, key: Buffer) {
    if (key.length !== 32) throw new Error('Invalid vault key')
    this.sql = sql
    this.key = key
  }
  async save(session: VaultSession): Promise<string> {
    if (session.expires <= Date.now()) throw new Error('Session expired')
    const accountRef = randomBytes(32).toString('base64url')
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    cipher.setAAD(Buffer.from(accountRef))
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()])
    const encrypted = [iv, cipher.getAuthTag(), ciphertext].map(b => b.toString('base64url')).join('.')
    await this.sql.query(`insert into zeroboard_oauth.sessions(account_ref,user_id,encrypted_session,expires_at)
      values($1,$2::uuid,$3,to_timestamp($4 / 1000.0))`, [accountRef, session.userId, encrypted, session.expires])
    return accountRef
  }
  async load(accountRef: string): Promise<VaultSession> {
    const result = await this.sql.query(`select jsonb_build_object('encrypted',encrypted_session,'userId',user_id,'expires',extract(epoch from expires_at)*1000) as value
      from zeroboard_oauth.sessions where account_ref = $1 and expires_at > now()`, [accountRef])
    const value = result.rows[0]?.value as { encrypted: string; userId: string; expires: number } | undefined
    if (!value) throw new Error('Connection session expired; reconnect')
    const [iv, tag, ciphertext] = value.encrypted.split('.').map(part => Buffer.from(part, 'base64url'))
    if (!iv || iv.length !== 12 || !tag || tag.length !== 16 || !ciphertext) throw new Error('Connection session unavailable')
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv)
    decipher.setAAD(Buffer.from(accountRef))
    decipher.setAuthTag(tag)
    const session: VaultSession = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
    if (session.userId !== value.userId || session.expires !== Number(value.expires) || session.expires <= Date.now() || typeof session.accessToken !== 'string') throw new Error('Connection session unavailable')
    return session
  }
  async remove(accountRef: string): Promise<void> {
    await this.sql.query('delete from zeroboard_oauth.sessions where account_ref = $1', [accountRef])
  }
}

/** Read expiry only after getUser has validated the token's authenticity. */
export function sessionExpiry(accessToken: string, now = Date.now()): number {
  const claims = JSON.parse(Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString()) as { exp?: unknown }
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) throw new Error('Session expiry unavailable')
  const expires = Math.min(now + 15 * 60_000, claims.exp * 1000)
  if (expires <= now + 5_000) throw new Error('Session expires shortly; refresh your sign-in and try again')
  return expires
}

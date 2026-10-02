import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { InvalidClientError, InvalidGrantError, InvalidScopeError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import * as db from './board-data.js';
import { isOAuthCallbackUri, oauthCallbackMatches } from './oauth-callback.js';

export const SCOPES = ['boards:read', 'cards:add'];
export interface AccountContext { client: SupabaseClient; user: User; expires?: number }
export interface Grant {
  id: string; userId: string; clientId: string; boardIds: string[]; scopes: string[];
  /** Opaque reference to a server-held account session, never a model-facing credential. */
  accountRef: string; issuer: string; resource: string; expires: number; revoked: boolean;
}
interface Pending { clientId: string; params: Omit<AuthorizationParams, 'resource'> & { resource: string }; expires: number }
interface Code { grantId: string; clientId: string; redirectUri: string; challenge: string; resource: string; expires: number }
interface AccessToken { grantId: string; expires: number }
export interface OAuthRecords { pending: Pending; code: Code; grant: Grant; token: AccessToken }
/** Production adapters must encrypt session references, expire records and atomically take single-use records. */
export interface OAuthStore {
  get<K extends keyof OAuthRecords>(kind: K, key: string): Promise<OAuthRecords[K] | undefined>;
  put<K extends keyof OAuthRecords>(kind: K, key: string, value: OAuthRecords[K]): Promise<void>;
  take<K extends keyof OAuthRecords>(kind: K, key: string): Promise<OAuthRecords[K] | undefined>;
}
const opaque = () => randomBytes(32).toString('base64url');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** Connector OAuth only. This does not implement Sign in with ChatGPT or inference billing. */
export class ZeroBoardOAuth implements OAuthServerProvider {
  readonly skipLocalPkceValidation = false;
  readonly clientsStore;
  readonly options: {
    issuer: URL; resource: URL; consentUrl: URL; store: OAuthStore;
    /** Predefined public clients; only literal native HTTP loopback ports may vary. No URL fetching or open DCR. */
    clients: OAuthClientInformationFull[];
    resolveAccount: (accountRef: string) => Promise<AccountContext>;
    /** Hosted account-session grants may expire sooner than the default local adapter policy. */
    grantDurationMs?: number;
  };
  constructor(options: ZeroBoardOAuth['options']) {
    this.options = options;
    if (options.grantDurationMs !== undefined && (!Number.isFinite(options.grantDurationMs) || options.grantDurationMs <= 0)) throw new Error('Positive grant duration required');
    for (const url of [options.issuer, options.resource, options.consentUrl]) {
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Canonical HTTPS URLs required');
    }
    if (options.issuer.pathname !== '/') throw new Error('Use an origin issuer for the SDK OAuth routes');
    for (const client of options.clients) {
      if (client.token_endpoint_auth_method !== 'none' || client.redirect_uris.length === 0 ||
        client.redirect_uris.some((uri) => !isOAuthCallbackUri(uri))) {
        throw new Error('Predefined public clients require HTTPS or literal 127.0.0.1 HTTP callbacks and auth method none');
      }
    }
    const clients = new Map(options.clients.map((client) => [client.client_id, structuredClone(client)]));
    this.clientsStore = { getClient: async (id: string) => structuredClone(clients.get(id)) };
  }
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const registered = await this.clientsStore.getClient(client.client_id);
    if (!registered?.redirect_uris.some((uri) => oauthCallbackMatches(params.redirectUri, uri))) throw new InvalidClientError('Unknown client or callback');
    if (params.resource?.href !== this.options.resource.href) throw new InvalidGrantError('Incorrect resource');
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new InvalidGrantError('S256 challenge required');
    const scopes = params.scopes ?? ['boards:read'];
    if (!scopes.includes('boards:read') || scopes.some((scope) => !SCOPES.includes(scope))) throw new InvalidScopeError('Unsupported scopes');
    const requestId = opaque();
    await this.options.store.put('pending', hash(requestId), { clientId: client.client_id,
      params: { ...params, scopes: [...new Set(scopes)], resource: params.resource.href }, expires: Date.now() + 600_000 });
    const url = new URL(this.options.consentUrl); url.searchParams.set('request', requestId);
    res.redirect(url.href);
  }
  async consentRequest(requestId: string): Promise<{ clientId: string; scopes: string[]; expires: number }> {
    const pending = await this.options.store.get('pending', hash(requestId));
    if (!pending || pending.expires < Date.now()) throw new InvalidGrantError('Consent request expired');
    if (pending.params.resource !== this.options.resource.href) throw new InvalidGrantError('Incorrect consent resource');
    return { clientId: pending.clientId, scopes: pending.params.scopes ?? [], expires: pending.expires };
  }
  async cancelConsent(requestId: string): Promise<string> {
    await this.consentRequest(requestId);
    const pending = await this.options.store.take('pending', hash(requestId));
    if (!pending) throw new InvalidGrantError('Consent already completed');
    const client = await this.clientsStore.getClient(pending.clientId);
    if (!client?.redirect_uris.some((uri) => oauthCallbackMatches(pending.params.redirectUri, uri))) throw new InvalidClientError('Callback unavailable');
    const redirect = new URL(pending.params.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('iss', this.options.issuer.href);
    if (pending.params.state !== undefined) redirect.searchParams.set('state', pending.params.state);
    return redirect.href;
  }
  /** Call ONLY from the app's authenticated, CSRF-protected consent handler after showing the exact scopes and boards.
   * accountRef must come from the server session, never the submitted user id or MCP input.
   */
  async approveConsent(requestId: string, accountRef: string, boardIds: string[]): Promise<string> {
    const pending = await this.options.store.get('pending', hash(requestId));
    if (!pending || pending.expires < Date.now()) throw new InvalidGrantError('Consent request expired');
    if (pending.params.resource !== this.options.resource.href) throw new InvalidGrantError('Incorrect consent resource');
    const registered = await this.clientsStore.getClient(pending.clientId);
    if (!registered?.redirect_uris.some((uri) => oauthCallbackMatches(pending.params.redirectUri, uri))) throw new InvalidClientError('Client or callback unavailable');
    if (!boardIds.length || boardIds.length > 100 || new Set(boardIds).size !== boardIds.length) throw new InvalidGrantError('Select 1–100 distinct boards');
    const account = await this.options.resolveAccount(accountRef);
    if (account.expires !== undefined && account.expires <= Date.now()) throw new InvalidGrantError('Account session expired');
    db.bindBoardAccess(account.client, { userId: account.user.id, boardIds });
    for (const boardId of boardIds) {
      await db.getBoard(account.client, boardId);
      if (pending.params.scopes?.includes('cards:add')) await db.requireBoardEditor(account.client, boardId);
    }
    // Atomic take ensures two concurrent approvals cannot issue two grants/codes.
    if (!(await this.options.store.take('pending', hash(requestId)))) throw new InvalidGrantError('Consent already completed');
    const grantId = opaque(); const code = opaque();
    await this.options.store.put('grant', grantId, { id: grantId, userId: account.user.id, clientId: pending.clientId,
      boardIds: [...boardIds], scopes: pending.params.scopes ?? [], accountRef, issuer: this.options.issuer.href, resource: this.options.resource.href,
      expires: Math.min(account.expires ?? Infinity, Date.now() + (this.options.grantDurationMs ?? 30 * 86400_000)), revoked: false });
    await this.options.store.put('code', hash(code), { grantId, clientId: pending.clientId, redirectUri: pending.params.redirectUri,
      challenge: pending.params.codeChallenge, resource: pending.params.resource, expires: Date.now() + 60_000 });
    const redirect = new URL(pending.params.redirectUri); redirect.searchParams.set('code', code);
    redirect.searchParams.set('iss', this.options.issuer.href);
    if (pending.params.state !== undefined) redirect.searchParams.set('state', pending.params.state);
    return redirect.href;
  }
  private async code(client: OAuthClientInformationFull, code: string): Promise<Code> {
    const record = await this.options.store.get('code', hash(code));
    if (!record || record.clientId !== client.client_id || record.expires < Date.now()) throw new InvalidGrantError('Invalid or expired code');
    if (record.resource !== this.options.resource.href) throw new InvalidGrantError('Incorrect code resource');
    const registered = await this.clientsStore.getClient(client.client_id);
    if (!registered?.redirect_uris.some((uri) => oauthCallbackMatches(record.redirectUri, uri))) throw new InvalidClientError('Client or callback unavailable');
    return record;
  }
  async challengeForAuthorizationCode(client: OAuthClientInformationFull, code: string): Promise<string> {
    return (await this.code(client, code)).challenge;
  }
  async exchangeAuthorizationCode(client: OAuthClientInformationFull, code: string, _verifier?: string, redirectUri?: string, resource?: URL): Promise<OAuthTokens> {
    const record = await this.code(client, code);
    if (redirectUri !== record.redirectUri || resource?.href !== record.resource) throw new InvalidGrantError('Callback/resource mismatch');
    if (!(await this.options.store.take('code', hash(code)))) throw new InvalidGrantError('Code already used');
    const grant = await this.options.store.get('grant', record.grantId);
    if (!grant || grant.revoked || grant.expires < Date.now()) throw new InvalidGrantError('Grant unavailable');
    const token = opaque(); const expires = Math.min(grant.expires, Date.now() + 15 * 60_000);
    await this.options.store.put('token', hash(token), { grantId: record.grantId, expires });
    return { access_token: token, token_type: 'Bearer', expires_in: Math.max(1, Math.floor((expires - Date.now()) / 1000)), scope: grant.scopes.join(' ') };
  }
  async exchangeRefreshToken(): Promise<OAuthTokens> { throw new InvalidGrantError('Refresh disabled; reconnect after expiry'); }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const record = await this.options.store.get('token', hash(token));
    const grant = record && await this.options.store.get('grant', record.grantId);
    if (!record || record.expires < Date.now() || !grant || grant.revoked || grant.expires < Date.now() ||
      grant.issuer !== this.options.issuer.href || grant.resource !== this.options.resource.href ||
      !(await this.clientsStore.getClient(grant.clientId)) || grant.scopes.some((scope) => !SCOPES.includes(scope))) {
      throw new InvalidTokenError('Expired, revoked or incorrectly scoped connection');
    }
    return { token, clientId: grant.clientId, scopes: grant.scopes, expiresAt: Math.floor(record.expires / 1000),
      resource: this.options.resource, extra: { grantId: grant.id } };
  }
  async accountForToken(token: string): Promise<AccountContext & { grant: Grant }> {
    const info = await this.verifyAccessToken(token);
    const grant = await this.options.store.get('grant', String(info.extra?.grantId));
    if (!grant || grant.revoked) throw new InvalidTokenError('Revoked connection');
    const account = await this.options.resolveAccount(grant.accountRef);
    if (account.user.id !== grant.userId) throw new InvalidTokenError('Account mismatch');
    return { ...account, grant };
  }
  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const token = await this.options.store.get('token', hash(request.token));
    const grant = token && await this.options.store.get('grant', token.grantId);
    if (grant && grant.clientId === client.client_id) await this.options.store.put('grant', grant.id, { ...grant, revoked: true });
  }
  async revokeConnection(grantId: string, authenticatedUserId: string): Promise<void> {
    const grant = await this.options.store.get('grant', grantId);
    if (!grant || grant.userId !== authenticatedUserId) throw new InvalidGrantError('Connection unavailable');
    await this.options.store.put('grant', grant.id, { ...grant, revoked: true });
  }
}

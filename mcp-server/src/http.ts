import express, { type ErrorRequestHandler } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, createOAuthMetadata, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { buildServer } from './server.js';
import { ZeroBoardOAuth, SCOPES } from './oauth.js';
import { oauthCallbackMatches } from './oauth-callback.js';
import { hasPreparsedBody, readMcpJsonBody } from './http-body.js';

/** Mount behind TLS on the canonical origin. No shared MCP sessions or local credential files. */
export function createHostedApp(oauth: ZeroBoardOAuth, options: { proposalKey: string; allowedOrigins: string[] }) {
  if (Buffer.byteLength(options.proposalKey) < 32) throw new Error('Stable secret of at least 32 bytes required');
  if (oauth.options.resource.pathname !== '/mcp') throw new Error('This adapter serves /mcp');
  const app = express(); app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.host !== oauth.options.resource.host) { res.status(421).end(); return; }
    const origin = req.headers.origin;
    if (origin && !options.allowedOrigins.includes(origin)) { res.status(403).end(); return; }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate');
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    ...createOAuthMetadata({ provider: oauth, issuerUrl: oauth.options.issuer, scopesSupported: SCOPES }),
    token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code'],
    revocation_endpoint_auth_methods_supported: ['none'],
    authorization_response_iss_parameter_supported: true,
  }));
  app.post('/authorize', express.urlencoded({ extended: false }));
  app.use('/authorize', async (req, res, next) => {
    // The SDK permits broader normalized loopback matches (including userinfo,
    // fragments and HTTPS port changes). Reject those before its protocol-error
    // path can redirect, even when the remaining OAuth parameters are invalid.
    const params = req.method === 'POST' ? req.body : req.query;
    if ((req.method === 'GET' || req.method === 'POST') && typeof params?.client_id === 'string' && params.redirect_uri !== undefined) {
      const client = await oauth.clientsStore.getClient(params.client_id);
      if (client && !client.redirect_uris.some((uri) => oauthCallbackMatches(params.redirect_uri, uri))) {
        res.status(400).json({ error: 'invalid_request', error_description: 'Unregistered redirect_uri' });
        return;
      }
    }
    const redirect = res.redirect.bind(res);
    // The shared policy and SDK validate the client/callback before redirects.
    // Add RFC 9207 issuer identification to those responses as well as consent
    // outcomes, and preserve valid state even when another parameter is invalid.
    res.redirect = ((statusOrUrl: number | string, url?: string) => {
      const status = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
      const location = typeof statusOrUrl === 'string' ? statusOrUrl : url!;
      const target = new URL(location, oauth.options.issuer);
      if (target.searchParams.has('error') || target.searchParams.has('code')) {
        target.searchParams.set('iss', oauth.options.issuer.href);
        const state = (req.method === 'POST' ? req.body : req.query)?.state;
        if (!target.searchParams.has('state') && typeof state === 'string') target.searchParams.set('state', state);
      }
      return redirect(status, target.href);
    }) as typeof res.redirect;
    next();
  });
  app.use(mcpAuthRouter({ provider: oauth, issuerUrl: oauth.options.issuer, resourceServerUrl: oauth.options.resource, scopesSupported: SCOPES }));
  // Match the same case-insensitive, optional-trailing-slash routes as Express.
  const isMcpPath = (path: string) => /^\/mcp\/?$/i.test(path);
  const preparsedRequests = new WeakSet<express.Request>();
  app.use((req, _res, next) => {
    if (isMcpPath(req.path) && req.method === 'POST' && hasPreparsedBody(req)) preparsedRequests.add(req);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.all('/mcp', async (req, res, next) => {
    const token = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')?.[1];
    let context;
    try {
      if (!token) throw new Error('Missing token');
      context = await oauth.accountForToken(token);
      if (!context.grant.scopes.includes('boards:read')) throw new Error('Read scope required');
    } catch {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${getOAuthProtectedResourceMetadataUrl(oauth.options.resource)}", scope="boards:read", error="invalid_token"`);
      res.status(401).json({ error: 'Authentication required' }); return;
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST, OPTIONS'); res.status(405).end(); return; }
    let body: unknown;
    try { body = readMcpJsonBody(req, preparsedRequests.has(req)); }
    catch (error) { next(error); return; }
    // Fresh RLS user client and fresh server per HTTP request: no session id can impersonate another account.
    const server = buildServer(context.client, context.user, { plugin: true, boardIds: context.grant.boardIds,
      readOnly: !context.grant.scopes.includes('cards:add'), proposalKey: options.proposalKey });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }
  });
  const requestError: ErrorRequestHandler = (error: unknown, req, res, next) => {
    if (!isMcpPath(req.path) || res.headersSent) { next(error); return; }
    const failure = error as { type?: string; status?: number };
    const status = failure.type === 'entity.too.large' ? 413 : failure.type === 'entity.parse.failed' ? 400 :
      (failure.status && failure.status >= 400 && failure.status < 600 ? failure.status : 500);
    const message = status === 413 ? 'MCP request exceeds the 1 MiB JSON limit' :
      failure.type === 'entity.parse.failed' ? 'Invalid JSON request' : status < 500 ? 'Invalid MCP request' : 'MCP request failed';
    // Body-parser's default Express error page is HTML and can include request
    // contents/stack traces in development. MCP clients need a safe JSON error.
    res.status(status).json({ jsonrpc: '2.0', error: { code: failure.type === 'entity.parse.failed' ? -32700 : status < 500 ? -32600 : -32603, message }, id: null });
  };
  app.use(requestError);
  return app;
}

import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, createOAuthMetadata, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { buildServer } from './server.js';
import { ZeroBoardOAuth, SCOPES } from './oauth.js';

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
    }
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    next();
  });
  app.get('/.well-known/oauth-authorization-server', (_req, res) => res.json({
    ...createOAuthMetadata({ provider: oauth, issuerUrl: oauth.options.issuer, scopesSupported: SCOPES }),
    token_endpoint_auth_methods_supported: ['none'], grant_types_supported: ['authorization_code'],
    revocation_endpoint_auth_methods_supported: ['none'],
  }));
  app.use(mcpAuthRouter({ provider: oauth, issuerUrl: oauth.options.issuer, resourceServerUrl: oauth.options.resource, scopesSupported: SCOPES }));
  app.use(express.json({ limit: '1mb' }));
  app.all('/mcp', async (req, res) => {
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
    if (req.method !== 'POST') { res.status(405).end(); return; }
    // Fresh RLS user client and fresh server per HTTP request: no session id can impersonate another account.
    const server = buildServer(context.client, context.user, { plugin: true, boardIds: context.grant.boardIds,
      readOnly: !context.grant.scopes.includes('cards:add'), proposalKey: options.proposalKey });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }
  });
  return app;
}

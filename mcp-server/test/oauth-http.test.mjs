import assert from 'node:assert/strict';
import test from 'node:test';
import { request as httpRequest } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ZeroBoardOAuth } from '../dist/oauth.js';
import { createHostedApp } from '../dist/http.js';
import { createBoardFixture, makeBoard } from './helpers/boards.mjs';
// Native http keeps the canonical Host header while using an isolated loopback endpoint.
async function testFetch(url, init = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)) }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve(new Response(
        res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); if (init.body) req.write(init.body instanceof URLSearchParams ? init.body.toString() : init.body); req.end();
  });
}
class TestStore {
  records = new Map();
  async get(kind, key) { return structuredClone(this.records.get(`${kind}:${key}`)); }
  async put(kind, key, value) { this.records.set(`${kind}:${key}`, structuredClone(value)); }
  async take(kind, key) { const record = await this.get(kind, key); this.records.delete(`${kind}:${key}`); return record; }
}
const digest = (token) => createHash('sha256').update(token).digest('hex');
async function setup(t) {
  const store = new TestStore();
  const accounts = { alice: { userId: 'user-1', boardId: 'board-1' }, bob: { userId: 'user-2', boardId: 'board-2' } };
  const oauth = new ZeroBoardOAuth({ issuer: new URL('https://mcp.test'), resource: new URL('https://mcp.test/mcp'),
    consentUrl: new URL('https://board.test/auth/plugin'), store,
    clients: [{ client_id: 'chatgpt-test', client_name: 'Test ChatGPT', redirect_uris: ['https://chatgpt.test/callback'], token_endpoint_auth_method: 'none' }],
    resolveAccount: async (ref) => {
      const account = accounts[ref]; if (!account) throw new Error('Account session revoked');
      const fixture = createBoardFixture({ row: makeBoard({ id: account.boardId, user_id: account.userId, name: ref }), access: { userId: account.userId, boardIds: [account.boardId] } });
      return { client: fixture.client, user: { id: account.userId } };
    },
  });
  const app = createHostedApp(oauth, { proposalKey: 'test-secret-with-more-than-32-bytes', allowedOrigins: ['https://chatgpt.test'] });
  const server = await new Promise((resolve, reject) => { const server = app.listen(0, '127.0.0.1', (error) => error ? reject(error) : resolve(server)); server.on('error', reject); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, init = {}) => testFetch(base + path, { ...init, headers: { host: 'mcp.test', ...init.headers }, redirect: 'manual' });
  async function authorize(ref = 'alice', scopes = 'boards:read cards:add') {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = new URLSearchParams({ client_id: 'chatgpt-test', redirect_uri: 'https://chatgpt.test/callback', response_type: 'code',
      state: 'outer-state', code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://mcp.test/mcp', scope: scopes });
    const response = await request(`/authorize?${params}`);
    assert.equal(response.status, 302, await response.text());
    const pendingId = new URL(response.headers.get('location')).searchParams.get('request');
    assert.deepEqual((await oauth.consentRequest(pendingId)).scopes, scopes.split(' '));
    const redirect = new URL(await oauth.approveConsent(pendingId, ref, [accounts[ref].boardId]));
    assert.equal(redirect.searchParams.get('state'), 'outer-state');
    return { code: redirect.searchParams.get('code'), verifier, pendingId };
  }
  const exchange = (code, verifier, extras = {}) => request('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: 'chatgpt-test', grant_type: 'authorization_code', code, code_verifier: verifier,
      redirect_uri: 'https://chatgpt.test/callback', resource: 'https://mcp.test/mcp', ...extras }) });
  const connect = async (token) => {
    const client = new Client({ name: 'hosted-plugin-test', version: '1' });
    t.after(() => client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(base + '/mcp'), { fetch: testFetch, requestInit: { headers: { host: 'mcp.test', authorization: `Bearer ${token}` } } }));
    return client;
  };
  return { oauth, store, request, authorize, exchange, connect };
}
const payload = (result) => { assert.notEqual(result.isError, true); return JSON.parse(result.content[0].text); };
test('HTTPS resource discovery, S256 and accurate public-client metadata; unauthorized, Host and Origin denial', async (t) => {
  const { request } = await setup(t);
  const metadata = await (await request('/.well-known/oauth-protected-resource/mcp')).json();
  assert.equal(metadata.resource, 'https://mcp.test/mcp'); assert.deepEqual(metadata.authorization_servers, ['https://mcp.test/']);
  const auth = await (await request('/.well-known/oauth-authorization-server')).json();
  assert.deepEqual(auth.code_challenge_methods_supported, ['S256']); assert.deepEqual(auth.grant_types_supported, ['authorization_code']);
  assert.deepEqual(auth.token_endpoint_auth_methods_supported, ['none']); assert.equal(auth.registration_endpoint, undefined);
  assert.equal(auth.authorization_response_iss_parameter_supported, true);
  const unauth = await request('/mcp', { method: 'POST' }); assert.equal(unauth.status, 401);
  assert.match(unauth.headers.get('www-authenticate'), /resource_metadata=.*oauth-protected-resource\/mcp/);
  assert.equal((await request('/mcp', { headers: { host: 'evil.test' } })).status, 421);
  assert.equal((await request('/mcp', { headers: { origin: 'https://evil.test' } })).status, 403);
});
test('authorization code PKCE, exact callback/resource, one-time code and approval; token expiry and revocation', async (t) => {
  const { oauth, store, authorize, exchange, request } = await setup(t);
  const { code, verifier, pendingId } = await authorize();
  await assert.rejects(oauth.approveConsent(pendingId, 'alice', ['board-1']), /expired/);
  assert.equal((await exchange(code, randomBytes(32).toString('base64url'))).status, 400);
  assert.equal((await exchange(code, verifier, { resource: 'https://evil.test/mcp' })).status, 400);
  assert.equal((await exchange(code, verifier, { redirect_uri: 'https://chatgpt.test/other' })).status, 400);
  const response = await exchange(code, verifier); assert.equal(response.status, 200, await response.clone().text());
  const tokens = await response.json();
  assert.equal((await exchange(code, verifier)).status, 400);
  const otherResource = new ZeroBoardOAuth({ ...oauth.options, issuer: new URL('https://other.test'), resource: new URL('https://other.test/mcp') });
  await assert.rejects(otherResource.verifyAccessToken(tokens.access_token), /incorrectly scoped/);
  const info = await oauth.verifyAccessToken(tokens.access_token); assert.equal(info.resource.href, 'https://mcp.test/mcp');
  const record = await store.get('token', digest(tokens.access_token));
  await store.put('token', digest(tokens.access_token), { ...record, expires: 0 });
  await assert.rejects(oauth.verifyAccessToken(tokens.access_token), /Expired/);
  await store.put('token', digest(tokens.access_token), record);
  const revoked = await request('/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'chatgpt-test', token: tokens.access_token }) });
  assert.equal(revoked.status, 200); await assert.rejects(oauth.verifyAccessToken(tokens.access_token), /revoked/);
});
test('two hosted users have isolated MCP tools, search and resources; read grants omit commit', async (t) => {
  const { authorize, exchange, connect } = await setup(t);
  const a = await authorize('alice', 'boards:read'); const b = await authorize('bob');
  const aliceToken = (await (await exchange(a.code, a.verifier)).json()).access_token;
  const bobToken = (await (await exchange(b.code, b.verifier)).json()).access_token;
  const [alice, bob] = await Promise.all([connect(aliceToken), connect(bobToken)]);
  const [aliceBoards, bobBoards] = await Promise.all([alice.callTool({ name: 'list_boards', arguments: {} }), bob.callTool({ name: 'list_boards', arguments: {} })]);
  assert.deepEqual(payload(aliceBoards).map((b) => b.id), ['board-1']); assert.deepEqual(payload(bobBoards).map((b) => b.id), ['board-2']);
  assert.equal((await alice.listTools()).tools.some((t) => t.name === 'commit_cards'), false);
  assert.equal((await bob.listTools()).tools.some((t) => t.name === 'commit_cards'), true);
  assert.equal((await alice.callTool({ name: 'get_board', arguments: { boardId: 'board-2' } })).isError, true);
  const search = payload(await bob.callTool({ name: 'search', arguments: { query: 'card' } })); assert.ok(search.every((hit) => hit.boardId === 'board-2'));
  const index = await alice.readResource({ uri: 'zeroboard://boards' }); assert.equal(JSON.parse(index.contents[0].text)[0].id, 'board-1');
  const me = await bob.readResource({ uri: 'zeroboard://me' }); assert.equal(JSON.parse(me.contents[0].text).id, 'user-2');
});
test('OAuth rejects unknown client, mismatched redirect, unsupported scopes and unauthorized selected boards', async (t) => {
  const { oauth, request } = await setup(t);
  const base = { client_id: 'chatgpt-test', redirect_uri: 'https://chatgpt.test/callback', response_type: 'code', code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: 'https://mcp.test/mcp', scope: 'boards:read' };
  for (const extras of [{ client_id: 'unknown' }, { redirect_uri: 'https://evil.test' }, { scope: 'boards:read boards:delete' }, { code_challenge_method: 'plain' }]) {
    const res = await request(`/authorize?${new URLSearchParams({ ...base, ...extras })}`);
    assert.ok(res.status === 400 || (res.status === 302 && new URL(res.headers.get('location')).searchParams.has('error')));
  }
  const res = await request(`/authorize?${new URLSearchParams(base)}`);
  const id = new URL(res.headers.get('location')).searchParams.get('request');
  await assert.rejects(oauth.approveConsent(id, 'alice', ['board-2']), /not found|selected-board|authorization contexts/);
});

test('authorization callbacks identify the exact discovery issuer on approval, denial, and protocol errors', async (t) => {
  const { oauth, request } = await setup(t);
  const metadata = await (await request('/.well-known/oauth-authorization-server')).json();
  const params = { client_id: 'chatgpt-test', redirect_uri: 'https://chatgpt.test/callback', response_type: 'code',
    code_challenge: 'a'.repeat(43), code_challenge_method: 'S256', resource: 'https://mcp.test/mcp', scope: 'boards:read', state: 'issuer-fixture-state' };
  for (const action of ['approve', 'cancel']) {
    const response = await request(`/authorize?${new URLSearchParams(params)}`);
    const pending = new URL(response.headers.get('location')).searchParams.get('request');
    const target = new URL(action === 'approve'
      ? await oauth.approveConsent(pending, 'alice', ['board-1'])
      : await oauth.cancelConsent(pending));
    assert.equal(target.searchParams.get('iss'), metadata.issuer, action);
    assert.equal(target.searchParams.get('state'), params.state, action);
    assert.equal(target.searchParams.has(action === 'approve' ? 'code' : 'error'), true);
  }
  for (const extras of [{ scope: 'boards:read unsupported' }, { code_challenge_method: 'plain' }, { response_type: 'token' }, { state: '' }]) {
    const response = await request(`/authorize?${new URLSearchParams({ ...params, scope: 'boards:read unsupported', ...extras })}`);
    assert.equal(response.status, 302);
    const target = new URL(response.headers.get('location'));
    assert.equal(target.origin + target.pathname, params.redirect_uri);
    assert.equal(target.searchParams.get('iss'), metadata.issuer);
    assert.equal(target.searchParams.get('state'), extras.state ?? params.state);
    assert.equal(target.searchParams.has('error'), true);
    assert.equal(target.searchParams.has('code'), false);
  }
  const formError = await request('/authorize', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...params, response_type: 'token' }) });
  assert.equal(formError.status, 302);
  const formTarget = new URL(formError.headers.get('location'));
  assert.equal(formTarget.searchParams.get('iss'), metadata.issuer);
  assert.equal(formTarget.searchParams.get('state'), params.state);
  assert.equal(formTarget.searchParams.has('error'), true);
  const badCallback = await request(`/authorize?${new URLSearchParams({ ...params, redirect_uri: 'https://evil.test/callback' })}`);
  assert.equal(badCallback.status, 400);
  assert.equal(badCallback.headers.get('location'), null);
});

test('malformed and oversized MCP JSON return protocol errors without HTML, body text or stack traces', async (t) => {
  const { request } = await setup(t);
  const malformed = await request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{fixture-private-text' });
  assert.equal(malformed.status, 400);
  assert.match(malformed.headers.get('content-type'), /application\/json/);
  const body = await malformed.text();
  assert.deepEqual(JSON.parse(body), { jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON request' }, id: null });
  assert.doesNotMatch(body, /fixture-private-text|node_modules|SyntaxError|DOCTYPE/);
  const oversized = await request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ oversized: 'x'.repeat(1024 * 1024) }) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await oversized.json(), { jsonrpc: '2.0', error: { code: -32600, message: 'MCP request exceeds the 1 MiB JSON limit' }, id: null });
  assert.equal(oversized.headers.get('cache-control'), 'no-store');
});

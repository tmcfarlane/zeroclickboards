import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

test('a project override never sends or erases the saved account session for another project', async (t) => {
  const isolatedHome = mkdtempSync(join(os.tmpdir(), 'zeroboard-project-test-'));
  const originalHome = os.homedir;
  const originalUrl = process.env.ZEROBOARD_SUPABASE_URL;
  const originalKey = process.env.ZEROBOARD_SUPABASE_ANON_KEY;
  const originalFetch = globalThis.fetch;
  let client;
  os.homedir = () => isolatedHome;
  syncBuiltinESMExports();
  process.env.ZEROBOARD_SUPABASE_URL = 'https://configured-project.test';
  process.env.ZEROBOARD_SUPABASE_ANON_KEY = 'fixture-only-public-key';
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests++;
    return new Response(JSON.stringify({ code: 'refresh_token_not_found', msg: 'Fixture refresh rejected' }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  t.after(async () => {
    if (client) await client.auth.stopAutoRefresh();
    os.homedir = originalHome;
    syncBuiltinESMExports();
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.ZEROBOARD_SUPABASE_URL; else process.env.ZEROBOARD_SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.ZEROBOARD_SUPABASE_ANON_KEY; else process.env.ZEROBOARD_SUPABASE_ANON_KEY = originalKey;
    rmSync(isolatedHome, { recursive: true, force: true });
  });
  const config = await import('../dist/config.js');
  assert.equal(config.CONFIG_DIR, join(isolatedHome, '.zeroboard'));
  mkdirSync(config.CONFIG_DIR);
  const expired = Math.floor(Date.now() / 1000) - 120;
  const session = JSON.stringify({ access_token: `header.${Buffer.from(JSON.stringify({ exp: expired })).toString('base64url')}.signature`,
    refresh_token: 'fixture-only-refresh', expires_at: expired, user: { id: 'fixture-user' } });
  const profile = { url: 'https://saved-project.test', token: session };
  writeFileSync(config.CREDENTIALS_PATH, JSON.stringify(profile), { mode: 0o600 });
  const credentials = await import('../dist/credentials.js');
  const { makeClient, getAuthedClient } = await import('../dist/supabase.js');
  await assert.rejects(getAuthedClient(), /another Supabase project/);
  client = makeClient();
  assert.equal((await client.auth.getSession()).data.session, null);
  credentials.fileStorage.removeItem(config.storageKeyFor(config.SUPABASE_URL));
  assert.equal(networkRequests, 0);
  assert.deepEqual(JSON.parse(readFileSync(config.CREDENTIALS_PATH, 'utf8')), profile);
  assert.equal(credentials.hasCredentials(), true);
  // Only an explicit, successful new session write replaces the single profile;
  // URL binding is saved atomically rather than in a later metadata write.
  credentials.fileStorage.setItem(config.storageKeyFor(config.SUPABASE_URL), 'new-fixture-session');
  assert.deepEqual(JSON.parse(readFileSync(config.CREDENTIALS_PATH, 'utf8')), { url: config.SUPABASE_URL, token: 'new-fixture-session' });
  assert.equal(credentials.credentialsMatchProject(config.SUPABASE_URL + '/'), true);
});

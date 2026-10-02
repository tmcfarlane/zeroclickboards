import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { SqlOAuthStore } from '../dist/oauth-store.js';

test('private SQL OAuth store persists records, atomically consumes codes, and denies API roles', async (t) => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('create role anon; create role authenticated;');
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const filename = (await readdir(directory)).find((name) => name.endsWith('plugin_oauth_records.sql'));
  await pg.exec(await readFile(new URL(filename, directory), 'utf8'));
  const store = new SqlOAuthStore(pg);
  const code = { grantId: 'grant', clientId: 'client', redirectUri: 'https://chatgpt.test/callback', challenge: 'challenge', resource: 'https://mcp.test/mcp', expires: Date.now() + 60_000 };
  await store.put('code', 'hashed-code', code);
  assert.deepEqual(await store.get('code', 'hashed-code'), code);
  const taken = await Promise.all([store.take('code', 'hashed-code'), store.take('code', 'hashed-code')]);
  assert.equal(taken.filter(Boolean).length, 1); assert.equal(await store.get('code', 'hashed-code'), undefined);
  for (const role of ['anon', 'authenticated']) {
    await pg.exec(`set role ${role}`);
    await assert.rejects(store.get('code', 'hashed-code'), /permission denied/);
    await pg.exec('reset role');
  }
});

test('put infers a TEXT payload parameter and round-trips nested pending records as JSON objects', async (t) => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec('create role anon; create role authenticated;');
  const directory = new URL('../../supabase/migrations/', import.meta.url);
  const filename = (await readdir(directory)).find((name) => name.endsWith('plugin_oauth_records.sql'));
  await pg.exec(await readFile(new URL(filename, directory), 'utf8'));
  const statements = [];
  const store = new SqlOAuthStore({ async query(sql, values) {
    statements.push(sql);
    return pg.query(sql, values);
  } });
  const pending = { clientId: 'fixture-client', params: {
    redirectUri: 'https://chatgpt.test/callback', resource: 'https://board.fixture.invalid/mcp',
    codeChallenge: 'a'.repeat(43), scopes: ['boards:read', 'cards:add'], state: 'Quoted "fixture" with Unicode Ω 🗂️',
  }, expires: Date.now() + 60_000 };
  await store.put('pending', 'hashed-pending', pending);
  // Ask PostgreSQL to infer the actual statement's wire parameter types. A
  // JSONB parameter selects postgres.js's JSON serializer, which would encode
  // the already-stringified payload twice; PGlite's serializer alone hides it.
  await pg.exec(`prepare oauth_store_put_parameter_probe as ${statements[0]}`);
  const types = (await pg.query(`select parameter_types[3]::text as payload_type,
    parameter_types[3]::oid as payload_oid from pg_prepared_statements
    where name='oauth_store_put_parameter_probe'`)).rows;
  assert.deepEqual(types, [{ payload_type: 'text', payload_oid: 25 }]);
  assert.deepEqual(await store.get('pending', 'hashed-pending'), pending);
  assert.deepEqual((await pg.query("select jsonb_typeof(value) as type from zeroboard_oauth.records where kind='pending'")).rows,
    [{ type: 'object' }]);
  const updated = { ...pending, params: { ...pending.params, scopes: ['boards:read'], state: 'Updated fixture' }, expires: pending.expires + 60_000 };
  await store.put('pending', 'hashed-pending', updated);
  assert.deepEqual(await store.take('pending', 'hashed-pending'), updated);
  assert.equal(await store.get('pending', 'hashed-pending'), undefined);
});

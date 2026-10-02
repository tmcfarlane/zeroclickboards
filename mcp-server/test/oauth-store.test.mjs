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

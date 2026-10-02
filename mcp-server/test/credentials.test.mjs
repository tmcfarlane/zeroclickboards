import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

test('credential writes create a private profile and tighten preexisting loose permissions', { skip: process.platform === 'win32' }, async (t) => {
  const isolatedHome = mkdtempSync(join(os.tmpdir(), 'zeroboard-credentials-test-'));
  const actualHomedir = os.homedir;
  const actualSupabaseUrl = process.env.ZEROBOARD_SUPABASE_URL;
  process.env.ZEROBOARD_SUPABASE_URL = 'https://fixture.test';
  os.homedir = () => isolatedHome;
  syncBuiltinESMExports();
  t.after(() => {
    os.homedir = actualHomedir;
    if (actualSupabaseUrl === undefined) delete process.env.ZEROBOARD_SUPABASE_URL;
    else process.env.ZEROBOARD_SUPABASE_URL = actualSupabaseUrl;
    syncBuiltinESMExports();
    rmSync(isolatedHome, { recursive: true, force: true });
  });
  // Import after isolating the home path. Never read or write the real profile.
  const config = await import('../dist/config.js');
  assert.equal(config.CONFIG_DIR, join(isolatedHome, '.zeroboard'));
  const { fileStorage, setSupabaseUrl, hasCredentials, clearCredentials } = await import('../dist/credentials.js');
  fileStorage.setItem('fixture-key', 'original-fixture-session');
  setSupabaseUrl('https://fixture.test');
  assert.equal(statSync(config.CONFIG_DIR).mode & 0o777, 0o700);
  assert.equal(statSync(config.CREDENTIALS_PATH).mode & 0o777, 0o600);
  chmodSync(config.CREDENTIALS_PATH, 0o644);
  fileStorage.setItem('fixture-key', 'rotated-fixture-session');
  assert.equal(statSync(config.CREDENTIALS_PATH).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(config.CREDENTIALS_PATH, 'utf8')), { token: 'rotated-fixture-session', url: 'https://fixture.test' });
  assert.equal(hasCredentials(), true);
  fileStorage.removeItem('fixture-key');
  assert.equal(fileStorage.getItem('fixture-key'), null);
  assert.equal(hasCredentials(), false);
  assert.equal(JSON.parse(readFileSync(config.CREDENTIALS_PATH, 'utf8')).url, 'https://fixture.test');
  clearCredentials();
  assert.equal(hasCredentials(), false);
});

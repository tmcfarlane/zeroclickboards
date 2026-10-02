import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
const configUrl = new URL('../dist/config.js', import.meta.url).href;
const probe = `const { assertConfigured } = await import(${JSON.stringify(configUrl)}); assertConfigured();`;
const jwtKey = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
for (const [name,key] of [['new secret key','sb_secret_fixture-never-real'], ['legacy service-role key',jwtKey('service_role')], ['malformed JWT key','header.invalid.signature']]) {
  test(`local MCP config rejects ${name} without exposing its value`, async () => {
    await assert.rejects(execute(process.execPath, ['--input-type=module','-e',probe], {
      env: { ...process.env, ZEROBOARD_SUPABASE_URL: 'https://fixture.test', ZEROBOARD_SUPABASE_ANON_KEY: key }, timeout: 10000,
    }), error => {
      assert.match(error.stderr, /requires a Supabase publishable\/anon key/);
      assert.doesNotMatch(error.stderr, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    });
  });
}
for (const [name,key] of [['publishable key','sb_publishable_fixture-never-real'], ['legacy anon key',jwtKey('anon')]]) {
  test(`local MCP config accepts ${name}`, async () => {
    const result = await execute(process.execPath, ['--input-type=module','-e',probe], {
      env: { ...process.env, ZEROBOARD_SUPABASE_URL: 'https://fixture.test', ZEROBOARD_SUPABASE_ANON_KEY: key }, timeout: 10000,
    });
    assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  });
}

const authUrl = new URL('../dist/auth.js', import.meta.url).href;
const loginProbe = `
  import http from 'node:http';
  import { syncBuiltinESMExports } from 'node:module';
  http.createServer = () => { throw new Error('Unexpected loopback listener'); };
  syncBuiltinESMExports();
  globalThis.fetch = () => { throw new Error('Unexpected auth request'); };
  const { login } = await import(${JSON.stringify(authUrl)});
  await login();
`;
for (const [name,key] of [['new secret key','sb_secret_fixture-never-real'], ['legacy service-role key',jwtKey('service_role')]]) {
  test(`browser login rejects ${name} before starting its listener or probing auth`, async () => {
    await assert.rejects(execute(process.execPath, ['--input-type=module','-e',loginProbe], {
      env: { ...process.env, ZEROBOARD_SUPABASE_URL: 'https://fixture.test', ZEROBOARD_SUPABASE_ANON_KEY: key,
        ZEROBOARD_EMAIL: '', ZEROBOARD_PASSWORD: '', ZEROBOARD_NO_BROWSER: '1' }, timeout: 10000,
    }), error => {
      assert.match(error.stderr, /requires a Supabase publishable\/anon key/);
      assert.doesNotMatch(error.stderr, /Unexpected loopback listener|Unexpected auth request/);
      assert.equal(error.stdout, '');
      return true;
    });
  });
}

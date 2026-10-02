import assert from 'node:assert/strict';
import test from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const binary = fileURLToPath(new URL('../dist/index.js', import.meta.url));
// Deliberately unusable project config prevents a regression from using an
// actual account or network connection before the option failure is reported.
const env = { ...process.env, ZEROBOARD_SUPABASE_URL: 'not-a-url', ZEROBOARD_SUPABASE_ANON_KEY: 'fixture-only' };
for (const args of [['--plguin'], ['--read-only=1'], ['serve', '--plugin', '--readonly']]) {
  test(`CLI rejects safety-option typo ${args.join(' ')}`, async () => {
    await assert.rejects(execute(process.execPath, [binary, ...args], { env, timeout: 10000 }), (error) => {
      assert.match(error.stderr, /Unknown server option:/);
      assert.doesNotMatch(error.stderr, /Invalid supabaseUrl|Stored session|ready as/);
      assert.equal(error.stdout, '');
      return true;
    });
  });
}
for (const args of [['serve', '--help'], ['--plugin', '--read-only', '--help']]) {
  test(`CLI help works with supported server flags ${args.join(' ')}`, async () => {
    const { stdout, stderr } = await execute(process.execPath, [binary, ...args], { env, timeout: 10000 });
    assert.match(stdout, /Requires ZEROBOARD_BOARD_IDS/);
    assert.equal(stderr, '');
  });
}

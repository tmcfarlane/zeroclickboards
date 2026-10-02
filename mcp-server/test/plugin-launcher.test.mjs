import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

async function fixture(t, version) {
  const root = await mkdtemp(join(tmpdir(), 'zeroboard-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const plugin = join(root, 'plugin');
  const runtime = join(plugin, 'runtime');
  await mkdir(join(plugin, 'scripts'), { recursive: true });
  await mkdir(join(runtime, 'dist'), { recursive: true });
  await cp(new URL('../../codex-plugin/scripts/serve.mjs', import.meta.url), join(plugin, 'scripts/serve.mjs'));
  await writeFile(join(runtime, 'package.json'), JSON.stringify({ name: '@zeroclickdev/zeroboard-mcp', version, type: 'module' }));
  const legacyStarted = join(root, 'legacy-started');
  await writeFile(join(runtime, 'dist/index.js'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(legacyStarted)}, 'legacy server started');`);
  await writeFile(join(root, 'zeroboard-mcp'), `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(legacyStarted)}, 'PATH legacy server started');`, { mode: 0o700 });
  return { root, runtime, legacyStarted, run: flags => spawnSync(process.execPath, [join(plugin, 'scripts/serve.mjs'), ...flags],
    { encoding: 'utf8', env: { ...process.env, PATH: root } }) };
}

test('plugin launcher refuses published legacy runtime before any server/account initialization', async t => {
  const f = await fixture(t, '0.1.0');
  const result = f.run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /reviewed 0\.2\.0 runtime/);
  await assert.rejects(access(f.legacyStarted));
});

test('plugin launcher refuses stale build and never falls back to a PATH executable', async t => {
  const f = await fixture(t, '0.2.0');
  const result = f.run([]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not built/);
  await assert.rejects(access(f.legacyStarted));
});

test('reviewed dedicated entry forces scoped mode and rejects unknown flags before server loading', async t => {
  const f = await fixture(t, '0.2.0');
  await cp(new URL('../dist/plugin-entry.js', import.meta.url), join(f.runtime, 'dist/plugin-entry.js'));
  const started = join(f.root, 'plugin-started');
  await writeFile(join(f.runtime, 'dist/server.js'), `import { writeFileSync } from 'node:fs'; export async function runServer(options) { writeFileSync(${JSON.stringify(started)}, JSON.stringify(options)); }`);
  const invalid = f.run(['--plugin=1']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown plugin option/);
  await assert.rejects(access(started));
  const help = f.run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /scoped plugin/);
  await assert.rejects(access(started));
  const valid = f.run(['--read-only']);
  assert.equal(valid.status, 0, valid.stderr);
  assert.deepEqual(JSON.parse(await readFile(started, 'utf8')), { plugin: true });
  await assert.rejects(access(f.legacyStarted));
});

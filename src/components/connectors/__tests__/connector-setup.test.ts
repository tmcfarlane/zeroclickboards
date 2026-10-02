// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { nativeSetupCommand } from '../connector-setup';

it('copied Codex setup preserves public IDs as literal arguments in a real shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'connector-command-'));
  try {
    const executable = join(root, 'codex');
    writeFileSync(executable, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`);
    chmodSync(executable, 0o700);
    const sentinel = join(root, 'injected');
    const clientId = `public'$(/usr/bin/touch ${sentinel})'client`;
    const endpoint = 'https://board.example.com/mcp?literal=$(touch%20never)';
    const output = execFileSync('/bin/sh', ['-c', nativeSetupCommand(endpoint, clientId)], { encoding: 'utf8', env: { ...process.env, PATH: root } });
    expect(JSON.parse(output)).toEqual(['mcp', 'add', 'zeroboard', '--url', endpoint, '--oauth-client-id', clientId, '--oauth-resource', endpoint]);
    expect(existsSync(sentinel)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

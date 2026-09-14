import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

const workflow = readFileSync(join(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
const guard = workflow.match(/id: guard\n\s+run: \|\n((?: {10}.*\n)+)/)?.[1];
const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'E2E_EMAIL', 'E2E_PASSWORD'];

it.each(Array.from({ length: 32 }, (_, mask) => mask))('runs the actual CI guard with secret combination %i', (mask) => {
  expect(guard).toBeDefined();
  const directory = mkdtempSync(join(tmpdir(), 'zeroboard-ci-guard-'));
  const output = join(directory, 'output');
  try {
    // Start with an isolated environment: local credentials must not affect this test.
    const env = Object.fromEntries(required.map((name, bit) => [name, mask & (1 << bit) ? 'configured' : '']));
    const result = spawnSync('/bin/bash', ['-eu', '-c', guard!], { env: { ...env, GITHUB_OUTPUT: output }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(output, 'utf8').trim()).toBe(mask === 31 ? 'run=true' : 'run=false');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

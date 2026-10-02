import { cp, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
// Dependencies must be installed from the lockfile and the MCP build already verified.
const root = resolve(import.meta.dirname, '..');
const out = resolve(process.argv[2] ?? join(root, 'dist/zeroboard-plugin'));
await mkdir(out, { recursive: true });
await cp(join(root, 'codex-plugin'), out, { recursive: true });
await mkdir(join(out, 'runtime'), { recursive: true });
for (const name of ['dist', 'package.json', 'package-lock.json']) {
  await cp(join(root, 'mcp-server', name), join(out, 'runtime', name), { recursive: true });
}
execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts'], { cwd: join(out, 'runtime'), stdio: 'inherit' });
await cp(join(root, 'LICENSE'), join(out, 'LICENSE'));
console.log(out);

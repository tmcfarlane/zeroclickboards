import { readFile, access } from 'node:fs/promises';

// A plugin must never fall back to an arbitrary zeroboard-mcp on PATH: 0.1.0
// silently ignores --plugin and exposes the legacy writable tool surface.
const locations = [new URL('../runtime/', import.meta.url), new URL('../../mcp-server/', import.meta.url)];
async function start() {
  for (const location of locations) {
    let pkg;
    try { pkg = JSON.parse(await readFile(new URL('package.json', location), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (pkg.name !== '@zeroclickdev/zeroboard-mcp' || pkg.version !== '0.2.0') throw new Error('ZeroBoard plugin requires the reviewed 0.2.0 runtime. Rebuild the portable plugin bundle.');
    const entry = new URL('dist/plugin-entry.js', location);
    try { await access(entry); }
    catch { throw new Error('ZeroBoard plugin runtime is not built. Build mcp-server or create the portable plugin bundle.'); }
    const { runPlugin } = await import(entry.href);
    if (typeof runPlugin !== 'function') throw new Error('Incompatible ZeroBoard plugin runtime. Rebuild the portable plugin bundle.');
    await runPlugin();
    return;
  }
  throw new Error('ZeroBoard plugin runtime was not found. Build mcp-server or create the portable plugin bundle.');
}
start().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

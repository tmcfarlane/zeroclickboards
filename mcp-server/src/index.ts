#!/usr/bin/env node
import { login, logout, status } from './auth.js';
import { runServer } from './server.js';

const HELP = `zeroboard-mcp — ZeroBoard MCP server

Usage:
  zeroboard-mcp [serve]      Start the MCP server over stdio (default)
  zeroboard-mcp --plugin     Selected-board reads and approved additive card batches
                             Requires ZEROBOARD_BOARD_IDS (comma-separated ids).
  zeroboard-mcp --read-only  Start in read-only mode (no write tools)
  zeroboard-mcp login        Sign in via the browser (Google or email). Use \`--password\`
                             (or ZEROBOARD_EMAIL/PASSWORD) for headless password sign-in.
  zeroboard-mcp logout       Clear stored credentials
  zeroboard-mcp status       Show the signed-in account
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];
  switch (cmd) {
    case 'login':
      return login();
    case 'logout':
      return logout();
    case 'status':
      return status();
    case 'help':
    case '--help':
    case '-h':
      process.stdout.write(HELP);
      return;
    case undefined:
    case 'serve':
    default:
      // Reject option typos before loading any account credentials. A misspelled
      // safety flag must never silently fall back to the writable legacy mode.
      if (cmd && cmd !== 'serve' && !cmd.startsWith('--')) {
        console.error(`Unknown command: ${cmd}\n\n${HELP}`);
        process.exit(1);
      }
      const flags = process.argv.slice(cmd === 'serve' ? 3 : 2);
      const allowed = new Set(['--plugin', '--read-only', '--help', '-h']);
      const unknown = flags.find((flag) => !allowed.has(flag));
      if (unknown) throw new Error(`Unknown server option: ${unknown}\n\n${HELP}`);
      if (flags.includes('--help') || flags.includes('-h')) {
        process.stdout.write(HELP);
        return;
      }
      return runServer();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

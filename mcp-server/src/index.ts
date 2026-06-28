#!/usr/bin/env node
import { login, logout, status } from './auth.js';
import { runServer } from './server.js';

const HELP = `zeroboard-mcp — ZeroBoard MCP server

Usage:
  zeroboard-mcp [serve]      Start the MCP server over stdio (default)
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
      // Bare invocation or any leading flag (e.g. --read-only) starts the server.
      if (cmd && cmd !== 'serve' && !cmd.startsWith('--')) {
        console.error(`Unknown command: ${cmd}\n\n${HELP}`);
        process.exit(1);
      }
      return runServer();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});

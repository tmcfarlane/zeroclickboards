import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createNodeClient } from '../../../mcp-server/dist/node-client.js';
import { buildServer } from '../../../mcp-server/dist/server.js';

// Resolve the SDK from the MCP package: the app does not need an SDK dependency.
const mcpRequire = createRequire(new URL('../../../mcp-server/package.json', import.meta.url));
const { Client } = mcpRequire('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = mcpRequire('@modelcontextprotocol/sdk/inMemory.js');

/** Connect the real MCP protocol to the same dedicated session as Playwright. */
export async function connectTestMcp() {
  const url = process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY;
  const expectedEmail = process.env.E2E_EMAIL;
  if (!url || !anonKey || !expectedEmail) throw new Error('Missing dedicated E2E account configuration');

  const storage = JSON.parse(await readFile(resolve(process.cwd(), 'playwright/.auth/user.json'), 'utf8'));
  const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const savedSession = storage.origins.flatMap((origin) => origin.localStorage).find((entry) => entry.name === storageKey);
  if (!savedSession) throw new Error('Playwright global setup did not create the dedicated test session');
  const session = JSON.parse(savedSession.value);
  const database = createNodeClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await database.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error || !data.user || data.user.email?.toLowerCase() !== expectedEmail.toLowerCase()) {
    throw new Error('MCP authentication did not match the dedicated E2E account');
  }

  const server = buildServer(database, data.user, { readOnly: false });
  const mcp = new Client({ name: 'zeroboard-browser-sync-e2e', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  const call = async (name, args) => {
    const result = await mcp.callTool({ name, arguments: args }, undefined, { timeout: 15_000 });
    if (result.isError) throw new Error(`MCP ${name} failed: ${result.content[0]?.text ?? 'unknown error'}`);
    return JSON.parse(result.content[0].text);
  };

  return {
    call,
    async deleteBoardAndVerify(boardId) {
      await call('delete_board', { boardId });
      // A list read distinguishes a deleted board from an unrelated get error.
      const boards = await call('list_boards', {});
      if (boards.some((board) => board.id === boardId)) throw new Error('Temporary E2E board cleanup failed');
      const missing = await mcp.callTool({ name: 'get_board', arguments: { boardId } }, undefined, { timeout: 15_000 });
      if (!missing.isError) throw new Error('Deleted E2E board can still be read');
    },
    async close() {
      await mcp.close();
      await server.close();
      await database.removeAllChannels();
      // Do not sign out: other Playwright tests share this dedicated session.
    },
  };
}

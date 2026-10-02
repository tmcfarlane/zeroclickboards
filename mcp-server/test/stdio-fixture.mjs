// Disposable subprocess harness: never reads credentials or contacts real Supabase.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBoardFixture } from './helpers/boards.mjs';
const { buildServer } = await import(pathToFileURL(resolve(process.env.ZEROBOARD_TEST_RUNTIME ?? 'dist/server.js')).href);
const fixture = createBoardFixture({ access: { userId: 'user-1', boardIds: ['board-1'] } });
const server = buildServer(fixture.client, { id: 'user-1' }, { plugin: true, boardIds: ['board-1'], readOnly: false });
await server.connect(new StdioServerTransport());

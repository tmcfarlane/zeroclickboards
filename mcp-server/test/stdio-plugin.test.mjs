import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
test('local stdio plugin runtime saves only an approved disposable action and reads standup', async (t) => {
  const client = new Client({ name: 'stdio-plugin-smoke', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('stdio-fixture.mjs', import.meta.url))],
    env: { ...process.env }, stderr: 'pipe' });
  t.after(async () => { await client.close(); await transport.close(); });
  await client.connect(transport);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.length, 8); assert.equal(tools.some((tool) => tool.name === 'generate_board'), false);
  const preview = await client.callTool({ name: 'preview_cards', arguments: { boardId: 'board-1', cards: [{ columnId: 'column-a', title: 'Send approved agenda', targetDate: '2026-10-02' }] } });
  assert.notEqual(preview.isError, true);
  const before = JSON.parse((await client.callTool({ name: 'list_cards', arguments: { boardId: 'board-1' } })).content[0].text);
  assert.equal(before.length, 2);
  const saved = await client.callTool({ name: 'commit_cards', arguments: { previewToken: JSON.parse(preview.content[0].text).previewToken, approved: true } });
  assert.notEqual(saved.isError, true);
  const cards = JSON.parse((await client.callTool({ name: 'list_cards', arguments: { boardId: 'board-1' } })).content[0].text);
  assert.equal(cards.length, 3); assert.equal(cards.find((c) => c.title === 'Send approved agenda').targetDate, '2026-10-02');
});

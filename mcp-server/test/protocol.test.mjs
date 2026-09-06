import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../dist/server.js';
import { createBoardFixture, jsonResponse, makeBoard } from './helpers/boards.mjs';

async function connect(t, options = {}) {
  const fixture = createBoardFixture(options);
  const server = buildServer(fixture.client, { id: 'user-1', email: 'test@example.com' }, { readOnly: false, ...options });
  const client = new Client({ name: 'zeroboard-regression-tests', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { ...fixture, mcp: client };
}

function payload(result) {
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

test('read-only MCP advertises reads and resources and rejects mutation calls', async (t) => {
  const { mcp, state } = await connect(t, { readOnly: true });
  const { tools } = await mcp.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'get_board', 'get_card', 'list_boards', 'list_cards', 'list_columns', 'search',
  ]);
  assert.ok(tools.every((tool) => tool.annotations.readOnlyHint === true));
  assert.equal(payload(await mcp.callTool({ name: 'get_card', arguments: {
    boardId: 'board-1', cardId: 'card-a',
  } })).content.text, 'Keep this body');
  const resources = await mcp.listResources();
  assert.deepEqual(resources.resources.map((resource) => resource.uri).sort(), [
    'zeroboard://boards', 'zeroboard://me',
  ]);
  const templates = await mcp.listResourceTemplates();
  assert.equal(templates.resourceTemplates[0].uriTemplate, 'zeroboard://board/{boardId}');
  const board = await mcp.readResource({ uri: 'zeroboard://board/board-1' });
  assert.equal(JSON.parse(board.contents[0].text).columns.length, 2);
  const requestCount = state.requests.length;
  // SDK versions may report unknown tools as a protocol exception or isError.
  try {
    const rejected = await mcp.callTool({ name: 'delete_board', arguments: { boardId: 'board-1' } });
    assert.equal(rejected.isError, true);
  } catch (error) {
    assert.match(error.message, /not found|unknown tool/i);
  }
  assert.equal(state.requests.length, requestCount);
  assert.ok(state.requests.every((request) => request.method === 'GET'));
});

test('duplicate reorder is an MCP error and leaves all cards intact', async (t) => {
  const { mcp, state } = await connect(t);
  const original = structuredClone(state.row.data);
  const result = await mcp.callTool({ name: 'reorder_columns', arguments: {
    boardId: 'board-1', orderedColumnIds: ['column-a', 'column-a'],
  } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /exactly once/);
  assert.deepEqual(state.row.data, original);
  assert.equal(state.requests.filter((request) => request.method === 'PATCH').length, 0);
});

test('MCP writes are visible through tools and resource reads', async (t) => {
  const { mcp } = await connect(t);
  payload(await mcp.callTool({ name: 'move_card', arguments: {
    boardId: 'board-1', cardId: 'card-a', targetColumnId: 'column-b', targetIndex: 0,
  } }));
  const result = payload(await mcp.callTool({ name: 'get_card', arguments: {
    boardId: 'board-1', cardId: 'card-a',
  } }));
  assert.equal(result.columnId, 'column-b');
  assert.equal(result.content.text, 'Keep this body');
  const resource = await mcp.readResource({ uri: 'zeroboard://board/board-1' });
  const board = JSON.parse(resource.contents[0].text);
  assert.equal(board.columns[0].cards.length, 0);
  assert.deepEqual(board.columns[1].cards.map((card) => card.id), ['card-a', 'card-b']);
});

test('permission failures reach the agent as errors without retrying the write', async (t) => {
  const { mcp, state } = await connect(t, {
    onRequest(request) {
      if (request.method === 'PATCH') return jsonResponse({
        code: '42501', message: 'permission denied for table boards',
      }, 403);
    },
  });
  const result = await mcp.callTool({ name: 'add_label', arguments: {
    boardId: 'board-1', cardId: 'card-a', label: 'green',
  } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /permission denied/);
  assert.equal(state.requests.filter((request) => request.method === 'PATCH').length, 1);
  assert.equal(state.row.data.columns[0].cards[0].labels, undefined);
});

test('MCP preserves independent description and body updates, including empty text', async (t) => {
  const { mcp } = await connect(t);
  const board = payload(await mcp.callTool({ name: 'add_card', arguments: {
    boardId: 'board-1', columnId: 'column-a', title: 'Distinct fields', description: 'Summary', text: 'Detailed body',
  } }));
  const cardId = board.columns[0].cards.at(-1).id;
  payload(await mcp.callTool({ name: 'update_card', arguments: { boardId: 'board-1', cardId, text: 'Updated body' } }));
  let card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId } }));
  assert.equal(card.description, 'Summary');
  assert.equal(card.content.text, 'Updated body');
  payload(await mcp.callTool({ name: 'update_card', arguments: { boardId: 'board-1', cardId, description: '' } }));
  card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId } }));
  assert.equal(card.description, '');
  assert.equal(card.content.text, 'Updated body');
  payload(await mcp.callTool({ name: 'update_card', arguments: { boardId: 'board-1', cardId, text: '' } }));
  card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId } }));
  assert.equal(card.description, '');
  assert.equal(card.content.text, '');
});

test('MCP cover tools return consistent attachment selections without deleting images', async (t) => {
  const row = makeBoard();
  const card = row.data.columns[0].cards[0];
  card.coverImage = 'https://example.com/old.png';
  card.attachments = [
    { id: 'old', name: 'Old', url: card.coverImage, addedAt: '2026-01-01', isCover: true },
    { id: 'next', name: 'Next', url: 'https://example.com/next.png', addedAt: '2026-01-02' },
  ];
  const { mcp } = await connect(t, { row });
  payload(await mcp.callTool({ name: 'set_cover_image', arguments: { boardId: row.id, cardId: card.id, coverImage: 'https://example.com/next.png' } }));
  let saved = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: row.id, cardId: card.id } }));
  assert.deepEqual(saved.attachments.map((attachment) => attachment.isCover), [false, true]);
  payload(await mcp.callTool({ name: 'set_cover_image', arguments: { boardId: row.id, cardId: card.id, coverImage: null } }));
  saved = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: row.id, cardId: card.id } }));
  assert.equal(saved.coverImage, undefined);
  assert.deepEqual(saved.attachments.map((attachment) => attachment.isCover), [false, false]);
});

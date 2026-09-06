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
  for (const request of [
    { name: 'delete_board', arguments: { boardId: 'board-1' } },
    { name: 'set_recurrence', arguments: { boardId: 'board-1', cardId: 'card-a', recurrence: null } },
  ]) {
    try {
      const rejected = await mcp.callTool(request);
      assert.equal(rejected.isError, true);
    } catch (error) {
      assert.match(error.message, /not found|unknown tool/i);
    }
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

test('MCP discovery describes recurrence variants and exposes only the dedicated setter and add input', async (t) => {
  const { mcp } = await connect(t);
  const { tools } = await mcp.listTools();
  const add = tools.find((tool) => tool.name === 'add_card');
  const setter = tools.find((tool) => tool.name === 'set_recurrence');
  const update = tools.find((tool) => tool.name === 'update_card');
  assert.ok(add.inputSchema.properties.recurrence);
  assert.ok(!add.inputSchema.required.includes('recurrence'));
  assert.ok(!update.inputSchema.properties.recurrence);
  assert.ok(setter.inputSchema.required.includes('recurrence'));
  assert.match(setter.description, /null clears/);
  assert.match(setter.description, /preserving its target date/);
  function branches(schema) {
    return schema.anyOf ? schema.anyOf.flatMap(branches) : [schema];
  }
  const setterBranches = branches(setter.inputSchema.properties.recurrence);
  assert.ok(setterBranches.some((schema) => schema.type === 'null'));
  for (const schema of [add.inputSchema.properties.recurrence, setter.inputSchema.properties.recurrence]) {
    const variants = branches(schema).filter((variant) => variant.type !== 'null');
    assert.deepEqual(variants.map((variant) => variant.properties.frequency.const), ['daily', 'weekly', 'monthly']);
    for (const variant of variants) {
      assert.equal(variant.additionalProperties, false);
      assert.deepEqual(variant.required, ['frequency', 'interval']);
      assert.equal(variant.properties.interval.type, 'integer');
      assert.equal(variant.properties.interval.minimum, 1);
      assert.equal(variant.properties.interval.maximum, 99);
    }
    const weekly = variants[1].properties.daysOfWeek;
    assert.equal(weekly.items.type, 'integer');
    assert.equal(weekly.items.minimum, 0);
    assert.equal(weekly.items.maximum, 6);
    assert.equal(weekly.maxItems, 7);
    assert.match(weekly.description, /Unique weekdays/);
    assert.match(weekly.description, /Sunday = 0/);
    assert.match(weekly.description, /omitted or empty/);
    const monthly = variants[2].properties.dayOfMonth;
    assert.equal(monthly.type, 'integer');
    assert.equal(monthly.minimum, 1);
    assert.equal(monthly.maximum, 31);
    assert.match(monthly.description, /initial target day/);
  }
});

test('MCP adds, replaces and clears recurrence through tools and board resources', async (t) => {
  const { mcp, state } = await connect(t);
  const board = payload(await mcp.callTool({ name: 'add_card', arguments: {
    boardId: 'board-1', columnId: 'column-a', title: 'Recurring review', text: 'Keep the content',
    targetDate: '2026-01-31T12:00:00.000Z', labels: ['purple'],
    recurrence: { frequency: 'weekly', interval: 2, daysOfWeek: [5, 1] },
  } }));
  const original = board.columns[0].cards.at(-1);
  assert.deepEqual(original.recurrence, { frequency: 'weekly', interval: 2, daysOfWeek: [1, 5] });
  for (const recurrence of [
    { frequency: 'monthly', interval: 3, dayOfMonth: 31 },
    { frequency: 'daily', interval: 99 },
    { frequency: 'weekly', interval: 1, daysOfWeek: [] },
    { frequency: 'monthly', interval: 1 },
    null,
  ]) {
    payload(await mcp.callTool({ name: 'set_recurrence', arguments: { boardId: 'board-1', cardId: original.id, recurrence } }));
    const card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId: original.id } }));
    assert.deepEqual(card.recurrence, recurrence ?? undefined);
    assert.equal(card.targetDate, original.targetDate);
    assert.deepEqual(card.content, original.content);
    assert.deepEqual(card.labels, original.labels);
    const resource = await mcp.readResource({ uri: 'zeroboard://board/board-1' });
    const saved = JSON.parse(resource.contents[0].text).columns[0].cards.find((card) => card.id === original.id);
    assert.deepEqual(saved.recurrence, recurrence ?? undefined);
  }
  assert.equal(state.row.data.columns[0].cards.length, 2);
});

test('MCP recurrence validation rejects malformed and incompatible values without database requests', async (t) => {
  const { mcp, state } = await connect(t);
  const original = structuredClone(state.row);
  const invalid = [
    {}, { frequency: 'yearly', interval: 1 }, { frequency: 'daily' },
    ...[0, -1, 100, 1.5, '1', null].map((interval) => ({ frequency: 'daily', interval })),
    { frequency: 'daily', interval: 1, daysOfWeek: [] },
    { frequency: 'daily', interval: 1, dayOfMonth: 1 },
    { frequency: 'weekly', interval: 1, dayOfMonth: 1 },
    ...[[1, 1], [-1], [7], [1.5], ['1'], null].map((daysOfWeek) => ({ frequency: 'weekly', interval: 1, daysOfWeek })),
    { frequency: 'monthly', interval: 1, daysOfWeek: [] },
    ...[0, 32, 1.5, '1', null].map((dayOfMonth) => ({ frequency: 'monthly', interval: 1, dayOfMonth })),
    { frequency: 'daily', interval: 1, unexpected: true },
    [], 'daily',
  ];
  for (const recurrence of invalid) {
    for (const request of [
      { name: 'add_card', arguments: { boardId: 'board-1', columnId: 'column-a', title: 'Invalid', recurrence } },
      { name: 'set_recurrence', arguments: { boardId: 'board-1', cardId: 'card-a', recurrence } },
    ]) {
      const result = await mcp.callTool(request);
      assert.equal(result.isError, true, JSON.stringify(request));
    }
  }
  const missing = await mcp.callTool({ name: 'set_recurrence', arguments: { boardId: 'board-1', cardId: 'card-a' } });
  assert.equal(missing.isError, true);
  const nullAdd = await mcp.callTool({ name: 'add_card', arguments: { boardId: 'board-1', columnId: 'column-a', title: 'Invalid', recurrence: null } });
  assert.equal(nullAdd.isError, true);
  assert.deepEqual(state.row, original);
  assert.equal(state.requests.length, 0);
});

test('MCP date tool discovery describes normalization and null clearing', async (t) => {
  const { mcp } = await connect(t);
  const { tools } = await mcp.listTools();
  for (const name of ['add_card', 'update_card', 'set_target_date']) {
    const tool = tools.find((tool) => tool.name === name);
    const schema = tool.inputSchema.properties.targetDate;
    assert.match(schema.description, /YYYY-MM-DD/);
    assert.match(schema.description, /without timezone conversion/);
    if (name === 'set_target_date') {
      assert.ok(schema.anyOf.some((branch) => branch.type === 'null'));
      assert.ok(tool.inputSchema.required.includes('targetDate'));
    } else {
      assert.equal(schema.type, 'string');
      assert.ok(!tool.inputSchema.required.includes('targetDate'));
    }
  }
});

test('MCP date writes normalize valid timestamps and preserve omitted dates until explicit clear', async (t) => {
  const { mcp } = await connect(t);
  const board = payload(await mcp.callTool({ name: 'add_card', arguments: {
    boardId: 'board-1', columnId: 'column-a', title: 'Dated', targetDate: '2026-04-15T23:30:00-08:00',
  } }));
  const cardId = board.columns[0].cards.at(-1).id;
  assert.equal(board.columns[0].cards.at(-1).targetDate, '2026-04-15');
  payload(await mcp.callTool({ name: 'update_card', arguments: { boardId: 'board-1', cardId, title: 'Renamed' } }));
  let card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId } }));
  assert.equal(card.targetDate, '2026-04-15');
  payload(await mcp.callTool({ name: 'update_card', arguments: { boardId: 'board-1', cardId, targetDate: '0099-12-31T00:30:00+14:00' } }));
  card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId } }));
  assert.equal(card.targetDate, '0099-12-31');
  payload(await mcp.callTool({ name: 'set_target_date', arguments: { boardId: 'board-1', cardId, targetDate: null } }));
  card = payload(await mcp.callTool({ name: 'get_card', arguments: { boardId: 'board-1', cardId } }));
  assert.equal(card.targetDate, undefined);
  assert.equal(card.title, 'Renamed');
});

test('every MCP date write rejects malformed dates and impossible clock values without database access', async (t) => {
  const { mcp, state } = await connect(t);
  const before = structuredClone(state.row);
  for (const targetDate of ['', ' ', 'not-a-date', '2026-02-31', '2026-13-01', '2026-01-00', '2026-04-15garbage', '2026-04-15\n', '0000-01-01', '100-01-01', '2026-04-15T24:00Z', '2026-04-15T12:60Z', '2026-04-15T12:00:60Z', '2026-04-15T12:00+24:00', '2026-04-15T12:00+01:60']) {
    for (const request of [
      { name: 'add_card', arguments: { boardId: 'board-1', columnId: 'column-a', title: 'Invalid', targetDate } },
      { name: 'update_card', arguments: { boardId: 'board-1', cardId: 'card-a', targetDate } },
      { name: 'set_target_date', arguments: { boardId: 'board-1', cardId: 'card-a', targetDate } },
    ]) {
      const result = await mcp.callTool(request);
      assert.equal(result.isError, true, JSON.stringify(request));
      assert.match(result.content[0].text, /real calendar date/);
    }
  }
  assert.deepEqual(state.row, before);
  assert.equal(state.requests.length, 0);
});

test('MCP archive reports repairable invalid legacy dates without mutating the board', async (t) => {
  const row = makeBoard();
  Object.assign(row.data.columns[0].cards[0], { targetDate: 'not-a-date', recurrence: { frequency: 'daily', interval: 1 } });
  const { mcp, state } = await connect(t, { row });
  const result = await mcp.callTool({ name: 'archive_card', arguments: { boardId: row.id, cardId: 'card-a' } });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /invalid target date.*clear it before archiving/);
  assert.deepEqual(state.row, row);
  assert.equal(state.requests.filter((request) => request.method === 'PATCH').length, 0);
  payload(await mcp.callTool({ name: 'update_card', arguments: { boardId: row.id, cardId: 'card-a', title: 'Still editable' } }));
  assert.equal(state.row.data.columns[0].cards[0].targetDate, 'not-a-date');
});

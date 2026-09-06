// Opt-in live MCP test. Uses the dedicated E2E account, never ~/.zeroboard.
// Creates and removes only its own temporary board. Supply the same environment
// as npm run smoke: VITE_SUPABASE_URL/ANON_KEY and E2E_EMAIL/PASSWORD.
import assert from 'node:assert/strict';
import { createNodeClient as createClient } from '../dist/node-client.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../dist/server.js';

for (const key of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'E2E_EMAIL', 'E2E_PASSWORD']) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}

// During the race check, hold two completed reads so both mutations start from
// the same database revision. Every request still reaches real Supabase.
let race = null;
let guardedWrites = 0;
const database = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: {
    fetch: async (input, init) => {
      if (init?.method === 'PATCH' && new URL(input).searchParams.has('updated_at')) guardedWrites += 1;
      const response = await fetch(input, init);
      if (race && (init?.method ?? 'GET') === 'GET' && new URL(input).pathname === '/rest/v1/boards') {
        const gate = race;
        gate.reads += 1;
        if (gate.reads === 2) { race = null; gate.release(); }
        await gate.ready;
      }
      return response;
    },
  },
});
const login = await database.auth.signInWithPassword({
  email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD,
});
if (login.error || !login.data.user) throw new Error(`E2E login failed: ${login.error?.message}`);
const server = buildServer(database, login.data.user, { readOnly: false });
const mcp = new Client({ name: 'zeroboard-live-smoke', version: '1.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await mcp.connect(clientTransport);

async function call(name, args) {
  const result = await mcp.callTool({ name, arguments: args });
  assert.notEqual(result.isError, true, JSON.stringify(result));
  return JSON.parse(result.content[0].text);
}

let boardId;
let checks = 0;
function passed(label) { checks += 1; console.log(`PASS ${label}`); }
try {
  const board = await call('create_board', { name: `MCP reliability check ${new Date().toISOString()}` });
  boardId = board.id;
  assert.equal(board.columns.length, 5);
  const columnId = board.columns[0].id;
  const secondColumnId = board.columns[1].id;
  passed('MCP create_board writes a dedicated test board');

  const added = await call('add_card', {
    boardId, columnId, title: 'Preserve concurrent changes', text: 'MCP body',
    recurrence: { frequency: 'daily', interval: 3 },
  });
  const cardId = added.columns[0].cards[0].id;
  assert.deepEqual(added.columns[0].cards[0].recurrence, { frequency: 'daily', interval: 3 });
  const duplicate = board.columns.map((column) => column.id);
  duplicate[1] = duplicate[0];
  const rejected = await mcp.callTool({ name: 'reorder_columns', arguments: { boardId, orderedColumnIds: duplicate } });
  assert.equal(rejected.isError, true);
  const intact = await call('get_board', { boardId });
  assert.deepEqual(intact.columns, added.columns);
  passed('Duplicate reorder rejected without changing live board data');

  await call('set_recurrence', { boardId, cardId, recurrence: null });
  const unscheduled = await call('get_card', { boardId, cardId });
  assert.equal(unscheduled.recurrence, undefined);
  assert.equal(unscheduled.content.text, 'MCP body');
  passed('MCP creates a recurring card and clears its schedule without changing the body');

  let release;
  const ready = new Promise((resolve) => { release = resolve; });
  const gate = { reads: 0, release, ready };
  race = gate;
  const writesBefore = guardedWrites;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; race = null; release(); }, 15_000);
  try {
    await Promise.all([
      call('add_label', { boardId, cardId, label: 'red' }),
      call('add_label', { boardId, cardId, label: 'blue' }),
    ]);
  } finally {
    clearTimeout(timeout);
    race = null;
    release();
  }
  assert.equal(timedOut, false, 'Concurrent reads did not arrive before the race gate timed out');
  assert.equal(gate.reads, 2, 'Both mutations must read the same starting revision');
  assert.equal(guardedWrites - writesBefore, 3, 'One competing update must conflict and retry');
  const labeled = await call('get_card', { boardId, cardId });
  assert.deepEqual([...labeled.labels].sort(), ['blue', 'red']);
  passed('Concurrent MCP writes preserve both labels against real database revisions');

  await call('move_card', { boardId, cardId, targetColumnId: secondColumnId });
  const moved = await call('get_card', { boardId, cardId });
  assert.equal(moved.columnId, secondColumnId);
  assert.equal(moved.content.text, 'MCP body');
  passed('MCP move_card and get_card round trip');

  await call('set_target_date', { boardId, cardId, targetDate: '2028-01-31T23:30:00-08:00' });
  const dated = await call('get_card', { boardId, cardId });
  assert.equal(dated.targetDate, '2028-01-31');
  const invalidDate = await mcp.callTool({
    name: 'set_target_date', arguments: { boardId, cardId, targetDate: '2028-02-31' },
  });
  assert.equal(invalidDate.isError, true);
  assert.deepEqual(await call('get_card', { boardId, cardId }), dated);
  passed('MCP normalizes timestamp dates and rejects impossible dates without changing the card');
  await call('set_recurrence', { boardId, cardId, recurrence: { frequency: 'monthly', interval: 1 } });
  const scheduled = await call('get_card', { boardId, cardId });
  assert.equal(scheduled.targetDate, '2028-01-31');
  assert.equal(scheduled.content.text, 'MCP body');
  assert.deepEqual([...scheduled.labels].sort(), ['blue', 'red']);
  await call('archive_card', { boardId, cardId });
  await call('archive_card', { boardId, cardId });
  const remaining = await call('list_cards', { boardId });
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].targetDate, '2028-02-29');
  assert.equal(remaining[0].recurrence.dayOfMonth, 31);
  assert.notEqual(remaining[0].id, cardId);
  await call('archive_card', { boardId, cardId: remaining[0].id });
  const march = await call('list_cards', { boardId });
  assert.equal(march.length, 1);
  assert.equal(march[0].targetDate, '2028-03-31');
  passed('Recurring archives create one next copy and preserve the original monthly day after February');

  const resource = await mcp.readResource({ uri: `zeroboard://board/${boardId}` });
  assert.equal(JSON.parse(resource.contents[0].text).columns.flatMap((column) => column.cards).length, 3);
  passed('MCP resource reflects persisted changes');
} finally {
  try {
    if (boardId) {
      await call('delete_board', { boardId });
      const removed = await database.from('boards').select('id').eq('id', boardId);
      if (removed.error) throw removed.error;
      assert.deepEqual(removed.data, []);
      passed('Temporary test board deleted and absence verified');
    }
  } finally {
    await mcp.close();
    await server.close();
    await database.auth.signOut({ scope: 'local' });
  }
}
console.log(`Live MCP smoke passed (${checks} checks).`);

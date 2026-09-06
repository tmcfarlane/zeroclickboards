import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCard,
  deleteBoard,
  getBoard,
  reorderColumns,
  updateCard,
  updateColumn,
} from '../dist/board-data.js';
import { createBoardFixture, jsonResponse, makeBoard, makeCard } from './helpers/boards.mjs';

const writes = (state) => state.requests.filter((request) => request.method === 'PATCH');
const reads = (state) => state.requests.filter((request) => request.method === 'GET');

test('reordering preserves both columns, their cards, and unrelated raw board data', async () => {
  const row = makeBoard();
  Object.assign(row.data, {
    background: '',
    hiddenColumnIds: [],
    futureSettings: { enabled: true, selected: ['one', 'two'] },
    explicitNull: null,
  });
  const { client, state } = createBoardFixture({ row });
  const result = await reorderColumns(client, row.id, ['column-b', 'column-a']);
  assert.deepEqual(result.columns.map((column) => column.id), ['column-b', 'column-a']);
  assert.deepEqual(state.row.data, {
    ...row.data,
    columns: [
      { ...row.data.columns[1], order: 0 },
      { ...row.data.columns[0], order: 1 },
    ],
  });
  assert.equal(writes(state)[0].url.searchParams.get('updated_at'), `eq.${row.updated_at}`);
});

for (const orderedColumnIds of [
  ['column-a', 'column-a'],
  ['column-a'],
  ['column-a', 'unknown-column'],
  ['column-a', 'column-b', 'column-b'],
]) {
  test(`invalid reorder ${JSON.stringify(orderedColumnIds)} cannot discard cards`, async () => {
    const row = makeBoard();
    const { client, state } = createBoardFixture({ row });
    await assert.rejects(reorderColumns(client, row.id, orderedColumnIds), /every existing column id exactly once/);
    assert.deepEqual(state.row, row);
    assert.equal(writes(state).length, 0);
  });
}

test('reapplies a mutation to the latest board after a competing edit', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request, state) {
      if (request.method === 'PATCH' && writes(state).length === 1) {
        state.row.data.columns[0].cards.push(makeCard('concurrent-card'));
        state.row.data.futureSettings = { fromWeb: true };
        state.row.updated_at = '2026-09-06T00:00:00.123456Z';
      }
    },
  });
  await updateCard(client, 'board-1', 'card-a', { title: 'Edited via MCP' });
  assert.equal(writes(state).length, 2);
  assert.equal(reads(state).length, 2);
  assert.deepEqual(state.row.data.columns[0].cards.map((card) => card.id), ['card-a', 'concurrent-card']);
  assert.equal(state.row.data.columns[0].cards[0].title, 'Edited via MCP');
  assert.deepEqual(state.row.data.futureSettings, { fromWeb: true });
  assert.equal(writes(state)[1].url.searchParams.get('updated_at'), 'eq.2026-09-06T00:00:00.123456Z');
});

test('simultaneous card additions both survive without duplicate cards', async () => {
  const { client, state } = createBoardFixture();
  await Promise.all([
    addCard(client, 'board-1', 'column-a', { title: 'First addition' }),
    addCard(client, 'board-1', 'column-a', { title: 'Second addition' }),
  ]);
  const cards = state.row.data.columns[0].cards;
  assert.deepEqual(cards.map((card) => card.title).sort(), ['First addition', 'Second addition', 'card-a'].sort());
  assert.equal(new Set(cards.map((card) => card.id)).size, 3);
  assert.equal(writes(state).length, 3);
});

test('stops after three version conflicts without overwriting concurrent edits', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request, state) {
      if (request.method === 'PATCH') {
        const attempt = writes(state).length;
        state.row.updated_at = `2026-09-06T00:00:00.${String(attempt).padStart(6, '0')}Z`;
        state.row.data.columns[0].title = `Concurrent title ${attempt}`;
      }
    },
  });
  await assert.rejects(updateColumn(client, 'board-1', 'column-a', 'MCP title'), /all 3 update attempts/);
  assert.equal(writes(state).length, 3);
  assert.equal(reads(state).length, 3);
  assert.equal(state.row.data.columns[0].title, 'Concurrent title 3');
});

test('a newly added column prevents a stale reorder from discarding it on retry', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request, state) {
      if (request.method === 'PATCH') {
        state.row.data.columns.push({ id: 'new-column', title: 'New', order: 2, cards: [makeCard('new-card')] });
        state.row.updated_at = '2026-09-06T00:00:01.000Z';
      }
    },
  });
  await assert.rejects(reorderColumns(client, 'board-1', ['column-b', 'column-a']), /every existing column id exactly once/);
  assert.equal(writes(state).length, 1);
  assert.equal(state.row.data.columns[2].cards[0].id, 'new-card');
});

test('read errors remain actionable instead of being reported as a missing board', async () => {
  const { client, state } = createBoardFixture({
    onRequest() {
      return jsonResponse({ code: '42501', message: 'permission denied for table boards' }, 403);
    },
  });
  await assert.rejects(updateColumn(client, 'board-1', 'column-a', 'New title'), /permission denied for table boards/);
  assert.equal(writes(state).length, 0);
  assert.equal(reads(state).length, 1);
});

test('missing boards are reported separately from API errors', async () => {
  const { client, state } = createBoardFixture({ row: null });
  await assert.rejects(getBoard(client, 'board-1'), /Board board-1 not found/);
  assert.equal(reads(state).length, 1);
});

test('explicit write permission errors are never retried', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request) {
      if (request.method === 'PATCH') {
        return jsonResponse({ code: '42501', message: 'new row violates row-level security policy' }, 403);
      }
    },
  });
  await assert.rejects(updateColumn(client, 'board-1', 'column-a', 'New title'), /row-level security policy/);
  assert.equal(writes(state).length, 1);
  assert.equal(reads(state).length, 1);
});

test('a silent RLS rejection with an unchanged version is not retried', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request) {
      if (request.method === 'PATCH') return jsonResponse([]);
    },
  });
  await assert.rejects(updateColumn(client, 'board-1', 'column-a', 'New title'), /Check your edit access/);
  assert.equal(writes(state).length, 1);
  assert.equal(reads(state).length, 2);
  assert.equal(state.row.data.columns[0].title, 'To do');
});

test('an ambiguous transport error after a committed write never replays the operation', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request, state) {
      if (request.method === 'PATCH') {
        state.row.data = structuredClone(request.body.data);
        state.row.updated_at = '2026-09-06T00:00:01.000Z';
        throw new TypeError('connection reset after write');
      }
    },
  });
  await assert.rejects(addCard(client, 'board-1', 'column-a', { title: 'Do this once' }), /connection reset after write/);
  assert.equal(writes(state).length, 1);
  assert.equal(reads(state).length, 1);
  assert.equal(state.row.data.columns[0].cards.filter((card) => card.title === 'Do this once').length, 1);
});

test('a board removed during a conflicting write reports missing instead of retrying writes', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request, state) {
      if (request.method === 'PATCH') state.row = null;
    },
  });
  await assert.rejects(updateColumn(client, 'board-1', 'column-a', 'New title'), /Board board-1 not found/);
  assert.equal(writes(state).length, 1);
});

test('delete reports success only after the API returns the deleted row', async () => {
  const { client, state } = createBoardFixture();
  assert.deepEqual(await deleteBoard(client, 'board-1'), { id: 'board-1' });
  assert.equal(state.row, null);
  assert.equal(state.requests[0].url.searchParams.get('select'), 'id');
  assert.match(state.requests[0].headers.get('prefer'), /return=representation/);
});

test('delete of a missing board does not claim success', async () => {
  const { client } = createBoardFixture({ row: null });
  await assert.rejects(deleteBoard(client, 'board-1'), /was not deleted/);
});

test('delete denied silently by RLS does not claim success', async () => {
  const { client, state } = createBoardFixture({ onRequest: () => jsonResponse([]) });
  await assert.rejects(deleteBoard(client, 'board-1'), /may not have delete access/);
  assert.equal(state.row.id, 'board-1');
  assert.equal(state.requests.length, 1);
});

test('delete preserves server errors and does not retry', async () => {
  const { client, state } = createBoardFixture({
    onRequest: () => jsonResponse({ code: '42501', message: 'delete permission denied' }, 403),
  });
  await assert.rejects(deleteBoard(client, 'board-1'), /delete permission denied/);
  assert.equal(state.requests.length, 1);
});

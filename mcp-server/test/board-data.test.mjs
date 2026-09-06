import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCard,
  deleteBoard,
  getBoard,
  reorderColumns,
  setCoverImage,
  setRecurrence,
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

function boardWithAttachments() {
  const row = makeBoard();
  const card = row.data.columns[0].cards[0];
  card.coverImage = 'https://example.com/old.png';
  card.attachments = [
    { id: 'old', name: 'Old cover', url: card.coverImage, addedAt: '2026-01-01', isCover: true, future: { keep: true } },
    { id: 'next', name: 'New cover', url: 'https://example.com/next.png', addedAt: '2026-01-02', isCover: false },
    { id: 'duplicate-url', name: 'Same image', url: 'https://example.com/next.png', addedAt: '2026-01-03', isCover: true },
  ];
  return row;
}

test('clearing a cover retains attachments and clears every stale selection flag', async () => {
  const row = boardWithAttachments();
  const before = row.data.columns[0].cards[0];
  const { client, state } = createBoardFixture({ row });
  await setCoverImage(client, row.id, before.id, null);
  const card = state.row.data.columns[0].cards[0];
  assert.equal(card.coverImage, undefined);
  assert.deepEqual(card.attachments, before.attachments.map((attachment) => ({ ...attachment, isCover: false })));
  assert.deepEqual(card.content, before.content);
});

test('selecting an existing attachment marks exactly its first matching URL as cover', async () => {
  const { client, state } = createBoardFixture({ row: boardWithAttachments() });
  await setCoverImage(client, 'board-1', 'card-a', 'https://example.com/next.png');
  const card = state.row.data.columns[0].cards[0];
  assert.equal(card.coverImage, 'https://example.com/next.png');
  assert.deepEqual(card.attachments.map((attachment) => attachment.isCover), [false, true, false]);
  assert.deepEqual(card.attachments[0].future, { keep: true });
});

test('a new cover URL clears old flags without removing attachments', async () => {
  const { client, state } = createBoardFixture({ row: boardWithAttachments() });
  await setCoverImage(client, 'board-1', 'card-a', 'https://example.com/external.png');
  const card = state.row.data.columns[0].cards[0];
  assert.equal(card.coverImage, 'https://example.com/external.png');
  assert.equal(card.attachments.length, 3);
  assert.ok(card.attachments.every((attachment) => attachment.isCover === false));
});

test('cover patches reconcile flags and unrelated card patches leave them untouched', async () => {
  const row = boardWithAttachments();
  const { client, state } = createBoardFixture({ row });
  await updateCard(client, 'board-1', 'card-a', { title: 'Unrelated update' });
  assert.deepEqual(state.row.data.columns[0].cards[0].attachments, row.data.columns[0].cards[0].attachments);
  await updateCard(client, 'board-1', 'card-a', { coverImage: 'https://example.com/next.png' });
  assert.deepEqual(state.row.data.columns[0].cards[0].attachments.map((attachment) => attachment.isCover), [false, true, false]);
  await updateCard(client, 'board-1', 'card-a', { coverImage: undefined });
  assert.equal(state.row.data.columns[0].cards[0].coverImage, undefined);
  assert.ok(state.row.data.columns[0].cards[0].attachments.every((attachment) => !attachment.isCover));
});

test('cover clear retries retain concurrently added attachments and clear their flags', async () => {
  const { client, state } = createBoardFixture({
    row: boardWithAttachments(),
    onRequest(request, state) {
      if (request.method === 'PATCH' && writes(state).length === 1) {
        state.row.data.columns[0].cards[0].attachments.push({ id: 'concurrent', name: 'Concurrent', url: 'https://example.com/new.png', addedAt: '2026-09-06', isCover: true });
        state.row.updated_at = '2026-09-06T00:00:00.123456Z';
      }
    },
  });
  await setCoverImage(client, 'board-1', 'card-a', null);
  const card = state.row.data.columns[0].cards[0];
  assert.equal(writes(state).length, 2);
  assert.equal(card.attachments.length, 4);
  assert.equal(card.attachments.at(-1).id, 'concurrent');
  assert.ok(card.attachments.every((attachment) => attachment.isCover === false));
});

test('adding a recurring card clones its input and canonicalizes selected weekdays', async () => {
  const { client, state } = createBoardFixture();
  const input = {
    title: 'Weekly planning',
    targetDate: '2026-09-07T12:00:00.000Z',
    recurrence: { frequency: 'weekly', interval: 2, daysOfWeek: [5, 1, 3] },
    content: { type: 'checklist', checklist: [{ id: 'item', text: 'Plan', completed: false }] },
    labels: ['blue'],
  };
  const original = structuredClone(input);
  const saving = addCard(client, 'board-1', 'column-a', input);
  assert.deepEqual(input, original, 'canonicalization must not sort the caller array');
  input.title = 'Changed after submitting';
  input.recurrence.daysOfWeek.push(0);
  input.recurrence.interval = 99;
  input.content.checklist[0].text = 'Changed';
  input.labels.push('red');
  const result = await saving;
  const card = result.columns[0].cards.at(-1);
  assert.equal(card.title, original.title);
  assert.equal(card.targetDate, original.targetDate);
  assert.deepEqual(card.recurrence, { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3, 5] });
  assert.deepEqual(card.content, original.content);
  assert.deepEqual(card.labels, original.labels);
  assert.deepEqual(state.row.data.columns[0].cards.at(-1).recurrence, card.recurrence);
});

test('setting, replacing and clearing recurrence preserve every unrelated field and target date', async () => {
  const row = boardWithAttachments();
  const before = row.data.columns[0].cards[0];
  Object.assign(before, {
    targetDate: '2026-01-31T12:00:00.000Z',
    labels: ['purple'],
    future: { enabled: true },
    isArchived: true,
    archivedAt: '2026-02-01T12:00:00.000Z',
  });
  const { client, state } = createBoardFixture({ row });
  for (const recurrence of [
    { frequency: 'weekly', interval: 2, daysOfWeek: [0, 6] },
    { frequency: 'monthly', interval: 3, dayOfMonth: 31 },
    { frequency: 'daily', interval: 99 },
    null,
  ]) {
    await setRecurrence(client, row.id, before.id, recurrence);
    const card = state.row.data.columns[0].cards[0];
    const { recurrence: saved, updatedAt, ...unrelated } = card;
    const { updatedAt: priorUpdatedAt, ...expected } = before;
    assert.deepEqual(saved, recurrence ?? undefined);
    assert.deepEqual(unrelated, expected);
    assert.equal(typeof updatedAt, 'string');
    assert.deepEqual(state.row.data.columns.map((column) => column.cards.length), [1, 1], 'configuration does not create recurring copies');
  }
  assert.equal(Object.hasOwn(state.row.data.columns[0].cards[0], 'recurrence'), false);
});

test('recurrence setter clones its input before asynchronous reads and preserves empty or missing selections', async () => {
  const { client, state } = createBoardFixture();
  const recurrence = { frequency: 'weekly', interval: 2, daysOfWeek: [6, 0] };
  const saving = setRecurrence(client, 'board-1', 'card-a', recurrence);
  assert.deepEqual(recurrence.daysOfWeek, [6, 0]);
  recurrence.daysOfWeek.push(4);
  recurrence.interval = 10;
  await saving;
  assert.deepEqual(state.row.data.columns[0].cards[0].recurrence, { frequency: 'weekly', interval: 2, daysOfWeek: [0, 6] });
  for (const config of [
    { frequency: 'weekly', interval: 1 },
    { frequency: 'weekly', interval: 1, daysOfWeek: [] },
    { frequency: 'monthly', interval: 1 },
  ]) {
    await setRecurrence(client, 'board-1', 'card-a', config);
    assert.deepEqual(state.row.data.columns[0].cards[0].recurrence, config);
    assert.equal(state.row.data.columns[0].cards[0].targetDate, undefined);
  }
});

test('invalid recurrence is rejected before database access for both direct mutation APIs', async () => {
  const invalid = [
    {}, { frequency: 'yearly', interval: 1 }, { frequency: 'daily' },
    ...[0, -1, 100, 1.5, Infinity, NaN, '1', null].map((interval) => ({ frequency: 'daily', interval })),
    { frequency: 'daily', interval: 1, daysOfWeek: [] },
    { frequency: 'daily', interval: 1, dayOfMonth: 1 },
    { frequency: 'weekly', interval: 1, dayOfMonth: 1 },
    ...[[1, 1], [-1], [7], [1.5], ['1'], null].map((daysOfWeek) => ({ frequency: 'weekly', interval: 1, daysOfWeek })),
    { frequency: 'monthly', interval: 1, daysOfWeek: [] },
    ...[0, 32, 1.5, '1', null].map((dayOfMonth) => ({ frequency: 'monthly', interval: 1, dayOfMonth })),
    { frequency: 'daily', interval: 1, unexpected: true },
    [], 'daily',
  ];
  const row = makeBoard();
  const { client, state } = createBoardFixture({ row });
  for (const recurrence of invalid) {
    await assert.rejects(addCard(client, row.id, 'column-a', { title: 'Invalid', recurrence }));
    await assert.rejects(setRecurrence(client, row.id, 'card-a', recurrence));
  }
  await assert.rejects(addCard(client, row.id, 'column-a', { title: 'Invalid', recurrence: null }));
  await assert.rejects(setRecurrence(client, row.id, 'card-a', undefined));
  assert.deepEqual(state.row, row);
  assert.equal(state.requests.length, 0);
});

test('recurrence changes follow a concurrently moved card and preserve fresh fields and additions on retry', async () => {
  const { client, state } = createBoardFixture({
    onRequest(request, state) {
      if (request.method === 'PATCH' && writes(state).length === 1) {
        const card = state.row.data.columns[0].cards.shift();
        Object.assign(card, { title: 'Concurrent title', targetDate: '2026-10-01', labels: ['green'], future: { retained: true } });
        state.row.data.columns[1].cards.push(card);
        state.row.data.columns[0].cards.push(makeCard('concurrent-card'));
        state.row.data.futureSettings = { retained: true };
        state.row.updated_at = '2026-09-06T00:00:00.123456Z';
      }
    },
  });
  const recurrence = { frequency: 'monthly', interval: 2, dayOfMonth: 15 };
  await setRecurrence(client, 'board-1', 'card-a', recurrence);
  const card = state.row.data.columns[1].cards.find((card) => card.id === 'card-a');
  assert.deepEqual(card.recurrence, recurrence);
  assert.equal(card.title, 'Concurrent title');
  assert.equal(card.targetDate, '2026-10-01');
  assert.deepEqual(card.labels, ['green']);
  assert.deepEqual(card.future, { retained: true });
  assert.deepEqual(state.row.data.columns[0].cards.map((card) => card.id), ['concurrent-card']);
  assert.deepEqual(state.row.data.futureSettings, { retained: true });
  assert.equal(writes(state).length, 2);
});

test('recurring additions survive concurrent additions once each', async () => {
  const { client, state } = createBoardFixture();
  await Promise.all([
    addCard(client, 'board-1', 'column-a', { title: 'Daily', recurrence: { frequency: 'daily', interval: 1 } }),
    addCard(client, 'board-1', 'column-a', { title: 'Monthly', recurrence: { frequency: 'monthly', interval: 1 } }),
  ]);
  const cards = state.row.data.columns[0].cards;
  assert.equal(cards.length, 3);
  assert.equal(new Set(cards.map((card) => card.id)).size, 3);
  assert.deepEqual(cards.find((card) => card.title === 'Daily').recurrence, { frequency: 'daily', interval: 1 });
  assert.deepEqual(cards.find((card) => card.title === 'Monthly').recurrence, { frequency: 'monthly', interval: 1 });
  assert.equal(writes(state).length, 3);
});

test('recurrence clear preserves concurrent card fields on retry', async () => {
  const row = makeBoard();
  row.data.columns[0].cards[0].recurrence = { frequency: 'daily', interval: 1 };
  const { client, state } = createBoardFixture({ row,
    onRequest(request, state) {
      if (request.method === 'PATCH' && writes(state).length === 1) {
        state.row.data.columns[0].cards[0].description = 'Keep the browser edit';
        state.row.updated_at = '2026-09-06T00:00:00.123456Z';
      }
    },
  });
  await setRecurrence(client, 'board-1', 'card-a', null);
  assert.equal(state.row.data.columns[0].cards[0].recurrence, undefined);
  assert.equal(state.row.data.columns[0].cards[0].description, 'Keep the browser edit');
  assert.equal(writes(state).length, 2);
});

test('setting recurrence on a missing card fails without a write', async () => {
  const { client, state } = createBoardFixture();
  await assert.rejects(setRecurrence(client, 'board-1', 'missing-card', { frequency: 'daily', interval: 1 }), /Card missing-card not found/);
  assert.equal(writes(state).length, 0);
});

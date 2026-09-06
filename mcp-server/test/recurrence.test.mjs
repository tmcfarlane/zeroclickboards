import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setCardArchived } from '../dist/board-data.js';
import { calculateNextTargetDate, createRecurringCardCopy } from '../dist/recurrence.js';
import { createBoardFixture, makeBoard } from './helpers/boards.mjs';

const dateCases = [
  ['daily', '2026-04-15', { frequency: 'daily', interval: 1 }, '2026-04-16'],
  ['daily interval across year', '2026-12-30', { frequency: 'daily', interval: 3 }, '2027-01-02'],
  ['daily across spring DST', '2026-03-07', { frequency: 'daily', interval: 1 }, '2026-03-08'],
  ['weekly', '2026-04-15', { frequency: 'weekly', interval: 1 }, '2026-04-22'],
  ['weekly interval', '2026-04-15', { frequency: 'weekly', interval: 2 }, '2026-04-29'],
  ['next selected weekday', '2026-04-15', { frequency: 'weekly', interval: 1, daysOfWeek: [1, 5] }, '2026-04-17'],
  ['same selected weekday next week', '2026-04-15', { frequency: 'weekly', interval: 1, daysOfWeek: [3] }, '2026-04-22'],
  ['January month end', '2026-01-31', { frequency: 'monthly', interval: 1 }, '2026-02-28'],
  ['explicit month end', '2026-01-31', { frequency: 'monthly', interval: 1, dayOfMonth: 31 }, '2026-02-28'],
  ['leap year month end', '2028-01-31', { frequency: 'monthly', interval: 1, dayOfMonth: 31 }, '2028-02-29'],
  ['month interval', '2026-01-31', { frequency: 'monthly', interval: 3, dayOfMonth: 31 }, '2026-04-30'],
  ['month interval across year', '2026-12-31', { frequency: 'monthly', interval: 2, dayOfMonth: 31 }, '2027-02-28'],
  ['explicit day after short month', '2026-02-28', { frequency: 'monthly', interval: 1, dayOfMonth: 31 }, '2026-03-31'],
];

for (const [name, date, config, expected] of dateCases) {
  test(`next recurrence: ${name}`, () => {
    assert.equal(calculateNextTargetDate(date, config), expected);
  });
}

function recurringCard(overrides = {}) {
  return {
    id: 'card-1',
    title: 'Monthly review',
    description: 'Preserve the full card when the next occurrence starts.',
    content: {
      type: 'checklist',
      text: 'Review notes',
      checklist: [
        { id: 'item-1', text: 'Review report', completed: true },
        { id: 'item-2', text: 'Plan follow-up', completed: false },
      ],
    },
    targetDate: '2026-01-31',
    labels: ['blue', 'green'],
    coverImage: 'https://example.com/cover.png',
    attachments: [{ id: 'attachment-1', name: 'Report', url: 'https://example.com/report.pdf', addedAt: '2026-01-01T00:00:00.000Z', isCover: false }],
    recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 31 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    customMetadata: { nested: ['preserved future field'] },
    ...overrides,
  };
}

function boardClient(cards) {
  return createBoardFixture({
    row: makeBoard({ data: { columns: [{ id: 'column-1', title: 'To Do', order: 0, cards }] } }),
  }).client;
}

test('recurring copies retain fields independently and reset completion/archive metadata', () => {
  const card = recurringCard({ isArchived: true, archivedAt: '2026-01-03T00:00:00.000Z' });
  const original = structuredClone(card);
  const copy = createRecurringCardCopy(card);
  assert.notEqual(copy.id, card.id);
  assert.equal(copy.targetDate, '2026-02-28');
  assert.equal(copy.isArchived, false);
  assert.equal(Object.hasOwn(copy, 'archivedAt'), false);
  assert.equal(copy.createdAt, copy.updatedAt);
  assert.ok(Number.isFinite(Date.parse(copy.createdAt)));
  assert.notEqual(copy.createdAt, card.createdAt);
  for (const key of ['title', 'description', 'labels', 'coverImage', 'attachments', 'recurrence', 'customMetadata']) {
    assert.deepEqual(copy[key], card[key]);
  }
  assert.deepEqual(copy.content.checklist.map(item => item.completed), [false, false]);
  copy.content.checklist[0].text = 'Changed copy';
  copy.attachments[0].name = 'Changed attachment';
  copy.labels.push('red');
  copy.recurrence.dayOfMonth = 15;
  copy.customMetadata.nested.push('Changed metadata');
  assert.deepEqual(card, original);
});

test('archiving an active recurring card creates exactly one copy in the same column', async () => {
  const original = recurringCard();
  const client = boardClient([original]);
  const board = await setCardArchived(client, 'board-1', original.id, true);
  assert.equal(board.columns.length, 1);
  const [archived, copy] = board.columns[0].cards;
  assert.equal(board.columns[0].cards.length, 2);
  assert.equal(archived.id, original.id);
  assert.equal(archived.isArchived, true);
  assert.ok(archived.archivedAt);
  assert.equal(archived.targetDate, '2026-01-31');
  assert.equal(archived.content.checklist[0].completed, true);
  assert.equal(copy.title, original.title);
  assert.equal(copy.targetDate, '2026-02-28');
  assert.equal(copy.isArchived, false);
  assert.equal(copy.content.checklist[0].completed, false);
  assert.deepEqual(copy.attachments, original.attachments);
  assert.deepEqual(copy.customMetadata, original.customMetadata);

  const repeated = await setCardArchived(client, 'board-1', original.id, true);
  assert.equal(repeated.columns[0].cards.length, 2);
  assert.equal(repeated.columns[0].cards[1].id, copy.id);

  const restored = await setCardArchived(client, 'board-1', original.id, false);
  assert.equal(restored.columns[0].cards.length, 2);
  assert.equal(restored.columns[0].cards[0].isArchived, false);
  assert.equal(restored.columns[0].cards[0].archivedAt, undefined);

  const nextOccurrence = await setCardArchived(client, 'board-1', copy.id, true);
  assert.equal(nextOccurrence.columns[0].cards.length, 3);
  assert.equal(nextOccurrence.columns[0].cards[2].targetDate, '2026-03-31');
});

test('restoring an already active recurring card does not create a copy', async () => {
  const client = boardClient([recurringCard()]);
  const board = await setCardArchived(client, 'board-1', 'card-1', false);
  assert.equal(board.columns[0].cards.length, 1);
});

test('archiving and restoring a nonrecurring card does not create a copy', async () => {
  const client = boardClient([recurringCard({ recurrence: undefined })]);
  const archived = await setCardArchived(client, 'board-1', 'card-1', true);
  assert.equal(archived.columns[0].cards.length, 1);
  assert.equal(archived.columns[0].cards[0].isArchived, true);
  const restored = await setCardArchived(client, 'board-1', 'card-1', false);
  assert.equal(restored.columns[0].cards.length, 1);
  assert.equal(restored.columns[0].cards[0].isArchived, false);
});

test('an archive retry respects a recurring copy already created by another writer', async () => {
  let simulatedConflict = false;
  const { client, state } = createBoardFixture({
    row: makeBoard({ data: { columns: [{ id: 'column-1', title: 'To Do', order: 0, cards: [recurringCard()] }] } }),
    onRequest(request, current) {
      if (request.method !== 'PATCH' || simulatedConflict) return;
      simulatedConflict = true;
      const column = current.row.data.columns[0];
      const copy = createRecurringCardCopy(column.cards[0]);
      copy.id = 'concurrent-copy';
      column.cards[0].isArchived = true;
      column.cards[0].archivedAt = '2026-09-06T00:00:01.000Z';
      column.cards.push(copy);
      current.row.updated_at = '2026-09-06T00:00:01.000Z';
    },
  });
  const board = await setCardArchived(client, 'board-1', 'card-1', true);
  assert.equal(board.columns[0].cards.length, 2);
  assert.equal(board.columns[0].cards[1].id, 'concurrent-copy');
  assert.equal(state.requests.filter(request => request.method === 'PATCH').length, 2);
});

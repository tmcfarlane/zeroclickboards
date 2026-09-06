import { describe, expect, it } from 'vitest';
import { documentsEqual, mergeBoardDocuments, validateBoardDocument, type BoardDocument } from '../board-merge';

type TestCard = {
  id: string;
  title: string;
  updatedAt: string;
  description?: string;
  content?: { type: string; text?: string; checklist?: { id: string; text: string; completed: boolean }[] };
  attachments?: { id: string; name: string; url: string; isCover?: boolean; [key: string]: unknown }[];
  labels?: string[];
  recurrence?: { frequency: string; interval: number; daysOfWeek?: number[]; dayOfMonth?: number; [key: string]: unknown };
  [key: string]: unknown;
};
type TestColumn = { id: string; title: string; order: number; cards: TestCard[]; [key: string]: unknown };
type TestDocument = BoardDocument & { data: { columns: TestColumn[]; [key: string]: unknown } };
const timestamp = '2026-09-06T10:00:00.000Z';
const card = (id: string): TestCard => ({ id, title: `Card ${id}`, updatedAt: timestamp });
const column = (id: string, cards: TestCard[] = [], order = 0): TestColumn => ({ id, title: id, cards, order });
function board(): TestDocument {
  return { name: 'Board', description: null, data: { columns: [column('todo', [card('a'), card('b'), card('c')]), column('done', [], 1)] } };
}
const clone = <T,>(value: T): T => structuredClone(value);
const resultBoard = (value: BoardDocument): TestDocument => value as TestDocument;
const allCards = (value: BoardDocument): TestCard[] => resultBoard(value).data.columns.flatMap((entry) => entry.cards);
const byId = (value: BoardDocument, id: string): TestCard | undefined => allCards(value).find((entry) => entry.id === id);
const ids = (value: BoardDocument, col = 'todo'): string[] => resultBoard(value).data.columns.find((entry) => entry.id === col)!.cards.map((entry) => entry.id);
function move(value: TestDocument, cardId: string, target: string, index = 0) {
  const source = value.data.columns.find((entry) => entry.cards.some((entry) => entry.id === cardId))!;
  const moved = source.cards.splice(source.cards.findIndex((entry) => entry.id === cardId), 1)[0];
  value.data.columns.find((entry) => entry.id === target)!.cards.splice(index, 0, moved);
}
function reorder(value: TestDocument, order: string[]) {
  const original = value.data.columns[0].cards;
  value.data.columns[0].cards = order.map((id) => original.find((entry) => entry.id === id)!);
}

describe('documentsEqual', () => {
  it('ignores object key order, absent optional fields, and card update timestamps', () => {
    const a = board(), b = board();
    b.data = { background: undefined, columns: b.data.columns };
    b.data.columns[0].cards[0] = { updatedAt: '2026-09-07T00:00:00Z', title: 'Card a', id: 'a', description: undefined };
    expect(documentsEqual(a, b)).toBe(true);
  });

  it('keeps list order, card changes, and timestamps in other data significant', () => {
    const base = board(), reordered = board(), changed = board();
    reorder(reordered, ['b', 'a', 'c']);
    changed.data.updatedAt = timestamp;
    expect(documentsEqual(base, reordered)).toBe(false);
    expect(documentsEqual(base, changed)).toBe(false);
    changed.data.columns[0].cards[0].title = 'Different';
    expect(documentsEqual(base, changed)).toBe(false);
  });
});

describe('mergeBoardDocuments', () => {
  it.each([
    { choice: 'local', selectedDays: undefined },
    { choice: 'remote', selectedDays: undefined },
    { choice: 'local', selectedDays: [1] },
    { choice: 'remote', selectedDays: [1] },
  ] as const)('reviews incompatible recurrence changes as a complete schedule (%j)', ({ choice, selectedDays }) => {
    const base = board();
    base.data.columns[0].cards[0].recurrence = { frequency: 'weekly', interval: 1, ...(selectedDays ? { daysOfWeek: [...selectedDays] } : {}) };
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].recurrence = { frequency: 'daily', interval: 2 };
    local.data.columns[0].cards[0].title = 'Browser title';
    remote.data.columns[0].cards[0].recurrence = { frequency: 'weekly', interval: 1, daysOfWeek: [3] };
    remote.data.columns[0].cards[0].description = 'MCP summary';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, choice);
    expect(conflicts.map((conflict) => conflict.path)).toEqual(['data.cards[a].card.recurrence']);
    expect(byId(document, 'a')).toMatchObject({ title: 'Browser title', description: 'MCP summary' });
    expect(byId(document, 'a')!.recurrence).toEqual((choice === 'local' ? local : remote).data.columns[0].cards[0].recurrence);
  });

  it('merges independent edits within the same recurrence frequency', () => {
    const base = board();
    base.data.columns[0].cards[0].recurrence = { frequency: 'weekly', interval: 1, daysOfWeek: [1], metadata: { retained: true } };
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].recurrence!.interval = 2;
    remote.data.columns[0].cards[0].recurrence!.daysOfWeek = [1, 3];
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')!.recurrence).toEqual({ frequency: 'weekly', interval: 2, daysOfWeek: [1, 3], metadata: { retained: true } });
  });

  it('accepts a one-sided recurrence frequency change with an unrelated card edit', () => {
    const base = board();
    base.data.columns[0].cards[0].recurrence = { frequency: 'weekly', interval: 1, daysOfWeek: [1] };
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].recurrence = { frequency: 'monthly', interval: 1, dayOfMonth: 31 };
    remote.data.columns[0].cards[0].description = 'Independent summary';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')).toMatchObject({ description: 'Independent summary', recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: 31 } });
    expect(byId(document, 'a')!.recurrence).not.toHaveProperty('daysOfWeek');
  });

  it('does not treat arbitrary metadata named recurrence as a card schedule', () => {
    const base = board();
    base.data.integration = { recurrence: { frequency: 'base', interval: 1 } };
    const local = clone(base), remote = clone(base);
    local.data.integration = { recurrence: { frequency: 'custom', interval: 1 } };
    remote.data.integration = { recurrence: { frequency: 'base', interval: 2 } };
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(document.data.integration).toEqual({ recurrence: { frequency: 'custom', interval: 2 } });
  });

  it('combines independent board, card, and unknown raw fields', () => {
    const base = board(), local = clone(base), remote = clone(base);
    base.data.integration = { vendor: 'source', options: { a: true, b: false } };
    local.data.integration = { vendor: 'source', options: { a: false, b: false } };
    remote.data.integration = { vendor: 'source', options: { a: true, b: true } };
    local.name = 'Renamed';
    local.data.columns[0].cards[0].title = 'Updated title';
    remote.description = 'From MCP';
    remote.data.columns[0].cards[0].description = 'Added description';
    remote.data.columns[1].title = 'Complete';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(document.name).toBe('Renamed');
    expect(document.description).toBe('From MCP');
    expect(document.data.integration).toEqual({ vendor: 'source', options: { a: false, b: true } });
    expect(byId(document, 'a')).toMatchObject({ title: 'Updated title', description: 'Added description' });
    expect(resultBoard(document).data.columns[1].title).toBe('Complete');
  });

  it.each(['local', 'remote'] as const)('retains a card edit when %s moves the card', (side) => {
    const base = board(), local = clone(base), remote = clone(base);
    const moving = side === 'local' ? local : remote;
    const editing = side === 'local' ? remote : local;
    move(moving, 'a', 'done');
    editing.data.columns[0].cards[0].title = 'Edited while moving';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['b', 'c']);
    expect(ids(document, 'done')).toEqual(['a']);
    expect(byId(document, 'a')?.title).toBe('Edited while moving');
    expect(allCards(document)).toHaveLength(3);
  });

  it('merges moves of different cards without duplicating them', () => {
    const base = board(), local = clone(base), remote = clone(base);
    move(local, 'a', 'done');
    move(remote, 'b', 'done');
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['c']);
    expect(ids(document, 'done')).toEqual(['a', 'b']);
    expect(new Set(allCards(document).map((entry) => entry.id)).size).toBe(3);
  });

  it('reports competing destinations and retains independent card fields with either resolution', () => {
    const base = board();
    base.data.columns.push(column('blocked', [], 2));
    const local = clone(base), remote = clone(base);
    move(local, 'a', 'done');
    move(remote, 'a', 'blocked');
    byId(local, 'a')!.title = 'Local title';
    byId(remote, 'a')!.description = 'Remote description';
    const draft = mergeBoardDocuments(base, local, remote);
    expect(draft.conflicts.map((entry) => entry.path)).toEqual(['data.cards[a].columnId']);
    for (const side of ['local', 'remote'] as const) {
      const { document } = mergeBoardDocuments(base, local, remote, side);
      expect(ids(document, side === 'local' ? 'done' : 'blocked')).toEqual(['a']);
      expect(byId(document, 'a')).toMatchObject({ title: 'Local title', description: 'Remote description' });
      expect(allCards(document)).toHaveLength(3);
    }
  });

  it('merges separate nested checklist changes and additions by identity', () => {
    const base = board();
    base.data.columns[0].cards[0].content = { type: 'checklist', checklist: [
      { id: 'first', text: 'First', completed: false }, { id: 'second', text: 'Second', completed: false },
    ] };
    const local = clone(base), remote = clone(base);
    const l = local.data.columns[0].cards[0].content!.checklist!, r = remote.data.columns[0].cards[0].content!.checklist!;
    l[0].completed = true;
    r[0].text = 'First revised';
    l.splice(1, 0, { id: 'local', text: 'Local', completed: false });
    r.push({ id: 'remote', text: 'Remote', completed: false });
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')?.content?.checklist).toEqual([
      { id: 'first', text: 'First revised', completed: true },
      { id: 'local', text: 'Local', completed: false },
      { id: 'second', text: 'Second', completed: false },
      { id: 'remote', text: 'Remote', completed: false },
    ]);
  });

  it.each(['local', 'remote'] as const)('keeps the selected content visible after a type-switch conflict resolved to %s', (choice) => {
    const base = board();
    base.data.columns[0].cards[0].content = { type: 'text', text: 'Original text' };
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].content = { type: 'checklist', checklist: [{ id: 'item', text: 'Checklist', completed: false }] };
    local.data.columns[0].cards[0].title = 'Independent local title';
    remote.data.columns[0].cards[0].content!.text = 'Remote text';
    remote.data.columns[0].cards[0].description = 'Independent remote description';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, choice);
    expect(conflicts.map((entry) => entry.path)).toEqual(['data.cards[a].card.content']);
    expect(byId(document, 'a')?.content).toEqual((choice === 'local' ? local : remote).data.columns[0].cards[0].content);
    expect(byId(document, 'a')).toMatchObject({ title: 'Independent local title', description: 'Independent remote description' });
  });

  it('accepts a one-sided content-type change alongside an unrelated card edit', () => {
    const base = board();
    base.data.columns[0].cards[0].content = { type: 'text', text: 'Original text' };
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].content = { type: 'checklist', checklist: [] };
    remote.data.columns[0].cards[0].title = 'Remote title';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')).toMatchObject({ title: 'Remote title', content: { type: 'checklist', checklist: [] } });
  });

  it('preserves thousands of cards for ordinary field edits and a one-sided insertion', () => {
    const base = board();
    base.data.columns[0].cards = Array.from({ length: 4000 }, (_, index) => card(`card-${index}`));
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].title = 'Local title';
    remote.data.columns[0].cards[3999].description = 'Remote description';
    let merged = mergeBoardDocuments(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.document)).toEqual(base.data.columns[0].cards.map((entry) => entry.id));
    remote.data.columns[0].cards.splice(2000, 0, card('new'));
    merged = mergeBoardDocuments(base, local, remote);
    expect(merged.conflicts).toEqual([]);
    expect(ids(merged.document)[2000]).toBe('new');
    expect(byId(merged.document, 'card-0')?.title).toBe('Local title');
    expect(byId(merged.document, 'card-3999')?.description).toBe('Remote description');
    expect(allCards(merged.document)).toHaveLength(4001);
  });

  it.each(['local', 'remote'] as const)('merges an attachment rename with a %s cover selection despite normalized false flags', (selectingSide) => {
    const base = board();
    base.data.columns[0].cards[0].attachments = [{ id: 'image', name: 'Original', url: '/image', metadata: { base: true } }];
    const local = clone(base), remote = clone(base);
    const selecting = selectingSide === 'local' ? local : remote;
    const renaming = selectingSide === 'local' ? remote : local;
    Object.assign(renaming.data.columns[0].cards[0].attachments![0], {
      name: 'Browser rename', isCover: false, metadata: { base: true, rename: 'preserved' },
    });
    selecting.data.columns[0].cards[0].coverImage = '/image';
    Object.assign(selecting.data.columns[0].cards[0].attachments![0], {
      isCover: true, metadata: { base: true, selection: 'preserved' },
    });
    const originalInputs = [base, local, remote].map(clone);
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')!.coverImage).toBe('/image');
    expect(byId(document, 'a')!.attachments).toEqual([{
      id: 'image', name: 'Browser rename', url: '/image', isCover: true,
      metadata: { base: true, rename: 'preserved', selection: 'preserved' },
    }]);
    expect([base, local, remote]).toEqual(originalInputs);
  });

  it('retains genuine conflicts in unrelated metadata named isCover', () => {
    const base = board();
    base.data.metadata = { attachments: [{ id: 'other', isCover: 'base' }] };
    base.data.columns[0].cards[0].attachments = [{ id: 'image', name: 'Image', url: '/image', metadata: { isCover: 'base' } }];
    const local = clone(base), remote = clone(base);
    local.data.metadata = { attachments: [{ id: 'other', isCover: 'local' }] };
    remote.data.metadata = { attachments: [{ id: 'other', isCover: 'remote' }] };
    local.data.columns[0].cards[0].attachments![0].metadata = { isCover: 'local' };
    remote.data.columns[0].cards[0].attachments![0].metadata = { isCover: 'remote' };
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, 'remote');
    expect(conflicts.map((conflict) => conflict.path).sort()).toEqual([
      'data.cards[a].card.attachments[image].metadata.isCover', 'data.metadata.attachments[other].isCover',
    ]);
    expect(byId(document, 'a')!.attachments![0].metadata).toEqual({ isCover: 'remote' });
    expect(document.data.metadata).toEqual({ attachments: [{ id: 'other', isCover: 'remote' }] });
  });

  it.each(['local', 'remote'] as const)('aligns attachment cover flags with the %s conflict choice', (choice) => {
    const base = board();
    Object.assign(base.data.columns[0].cards[0], {
      coverImage: '/a',
      attachments: [
        { id: 'a', name: 'A', url: '/a', isCover: true },
        { id: 'b', name: 'B', url: '/b', isCover: false, metadata: { preserved: true } },
        { id: 'c', name: 'C', url: '/c', isCover: false },
      ],
    });
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].coverImage = '/b';
    local.data.columns[0].cards[0].attachments!.forEach((attachment) => { attachment.isCover = attachment.id === 'b'; });
    remote.data.columns[0].cards[0].coverImage = '/c';
    remote.data.columns[0].cards[0].attachments!.forEach((attachment) => { attachment.isCover = attachment.id === 'c'; });
    remote.data.columns[0].cards[0].attachments![0].name = 'Remote rename';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, choice);
    const mergedCard = byId(document, 'a')!;
    expect(conflicts.map((conflict) => conflict.path)).toContain('data.cards[a].card.coverImage');
    expect(mergedCard.coverImage).toBe(choice === 'local' ? '/b' : '/c');
    expect(mergedCard.attachments!.filter((attachment) => attachment.isCover).map((attachment) => attachment.id)).toEqual([choice === 'local' ? 'b' : 'c']);
    expect(mergedCard.attachments![0].name).toBe('Remote rename');
    expect(mergedCard.attachments![1].metadata).toEqual({ preserved: true });
  });

  it('keeps an MCP cover clear while preserving an independent attachment rename and addition', () => {
    const base = board();
    Object.assign(base.data.columns[0].cards[0], { coverImage: '/a', attachments: [{ id: 'a', name: 'A', url: '/a', isCover: true }] });
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].attachments![0].name = 'Renamed';
    local.data.columns[0].cards[0].attachments!.push({ id: 'b', name: 'New attachment', url: '/b', metadata: { author: 'local' } });
    delete remote.data.columns[0].cards[0].coverImage;
    remote.data.columns[0].cards[0].attachments![0].isCover = false;
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    const mergedCard = byId(document, 'a')!;
    expect(conflicts).toEqual([]);
    expect(mergedCard.coverImage).toBeUndefined();
    expect(mergedCard.attachments).toEqual([
      { id: 'a', name: 'Renamed', url: '/a', isCover: false },
      { id: 'b', name: 'New attachment', url: '/b', metadata: { author: 'local' } },
    ]);
  });

  it('clears stale true attachment flags when the canonical cover is absent', () => {
    const base = board();
    base.data.columns[0].cards[0].attachments = [{ id: 'a', name: 'A', url: '/a', isCover: true }];
    const { document } = mergeBoardDocuments(base, base, base);
    expect(byId(document, 'a')!.attachments![0].isCover).toBe(false);
  });

  it('marks only the first matching attachment when duplicate URLs share the canonical cover', () => {
    const base = board();
    Object.assign(base.data.columns[0].cards[0], {
      coverImage: '/same',
      attachments: [
        { id: 'first', name: 'First', url: '/same', metadata: { order: 1 } },
        { id: 'second', name: 'Second', url: '/same', isCover: true, metadata: { order: 2 } },
      ],
    });
    const { document, conflicts } = mergeBoardDocuments(base, base, base);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')!.attachments).toEqual([
      { id: 'first', name: 'First', url: '/same', isCover: true, metadata: { order: 1 } },
      { id: 'second', name: 'Second', url: '/same', isCover: false, metadata: { order: 2 } },
    ]);
  });

  it('does not add missing false flags or otherwise change an already coherent cover selection', () => {
    const base = board();
    Object.assign(base.data.columns[0].cards[0], {
      coverImage: '/a',
      attachments: [
        { id: 'a', name: 'A', url: '/a', isCover: true },
        { id: 'b', name: 'B', url: '/b' },
        { id: 'c', name: 'C', url: '/c', isCover: false },
      ],
    });
    const { document } = mergeBoardDocuments(base, base, base);
    expect(document).toEqual(base);
    expect(documentsEqual(document, base)).toBe(true);
  });

  it('merges attachments by id and preserves unrelated additions during resolution', () => {
    const base = board();
    base.data.columns[0].cards[0].attachments = [{ id: 'file', name: 'Original', url: '/file' }];
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].attachments![0].name = 'Local';
    remote.data.columns[0].cards[0].attachments![0].name = 'Remote';
    remote.data.columns[0].cards[0].attachments!.push({ id: 'another', name: 'Another', url: '/another' });
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, 'local');
    expect(conflicts[0].path).toBe('data.cards[a].card.attachments[file].name');
    expect(byId(document, 'a')?.attachments).toEqual([
      { id: 'file', name: 'Local', url: '/file' }, { id: 'another', name: 'Another', url: '/another' },
    ]);
  });

  it('combines unrelated labels and hidden-column changes as set membership', () => {
    const base = board();
    base.data.columns[0].cards[0].labels = ['red'];
    base.data.hiddenColumnIds = ['todo'];
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].labels = [];
    remote.data.columns[0].cards[0].labels!.push('blue');
    local.data.hiddenColumnIds = [];
    remote.data.hiddenColumnIds = ['todo', 'done'];
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')?.labels).toEqual(['blue']);
    expect(document.data.hiddenColumnIds).toEqual(['done']);
  });

  it('keeps concurrent distinct card insertions at their anchors', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns[0].cards.splice(1, 0, card('x'));
    remote.data.columns[0].cards.splice(1, 0, card('y'));
    remote.data.columns[0].cards.push(card('z'));
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['a', 'x', 'y', 'b', 'c', 'z']);
  });

  it('anchors an insertion after its preceding card when that card is concurrently reordered', () => {
    const base = board(), local = clone(base), remote = clone(base);
    reorder(local, ['b', 'a', 'c']);
    remote.data.columns[0].cards.splice(1, 0, card('x'));
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['b', 'a', 'x', 'c']);
  });

  it('anchors additions to surviving neighbors when an earlier neighbor is deleted', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns[0].cards.shift();
    remote.data.columns[0].cards.splice(1, 0, card('x'));
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['x', 'b', 'c']);
  });

  it('keeps an independent reorder when the other client edits card fields', () => {
    const base = board(), local = clone(base), remote = clone(base);
    reorder(local, ['c', 'a', 'b']);
    remote.data.columns[0].cards[1].title = 'Edited B';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['c', 'a', 'b']);
    expect(byId(document, 'b')?.title).toBe('Edited B');
  });

  it('combines compatible independent reorders', () => {
    const base = board();
    base.data.columns[0].cards.push(card('d'));
    const local = clone(base), remote = clone(base);
    reorder(local, ['b', 'a', 'c', 'd']);
    reorder(remote, ['a', 'b', 'd', 'c']);
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['b', 'a', 'd', 'c']);
  });

  it('reports incompatible simultaneous reorders and preserves added cards with either resolution', () => {
    const base = board(), local = clone(base), remote = clone(base);
    reorder(local, ['b', 'a', 'c']);
    reorder(remote, ['a', 'c', 'b']);
    remote.data.columns[0].cards.push(card('x'));
    const draft = mergeBoardDocuments(base, local, remote);
    expect(draft.conflicts.map((entry) => entry.path)).toContain('data.columns[todo].cards.order');
    expect(ids(mergeBoardDocuments(base, local, remote, 'local').document)).toEqual(['b', 'x', 'a', 'c']);
    expect(ids(mergeBoardDocuments(base, local, remote, 'remote').document)).toEqual(['a', 'c', 'b', 'x']);
  });

  it('does not resurrect removed IDs from a stale reorder', () => {
    const base = board();
    base.data.columns[0].cards.push(card('d'));
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards = local.data.columns[0].cards.filter((entry) => entry.id !== 'd');
    reorder(remote, ['b', 'a', 'c', 'd']);
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['b', 'a', 'c']);
  });

  it.each(['edit', 'move', 'reorder'] as const)('reports card deletion versus %s', (change) => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns[0].cards.shift();
    if (change === 'edit') remote.data.columns[0].cards[0].title = 'Edited';
    if (change === 'move') move(remote, 'a', 'done');
    if (change === 'reorder') reorder(remote, ['b', 'a', 'c']);
    const draft = mergeBoardDocuments(base, local, remote);
    expect(draft.conflicts.map((entry) => entry.path)).toContain('data.cards[a]');
    expect(byId(mergeBoardDocuments(base, local, remote, 'local').document, 'a')).toBeUndefined();
    expect(byId(mergeBoardDocuments(base, local, remote, 'remote').document, 'a')).toBeDefined();
  });

  it('allows an unopposed card deletion despite incidental timestamp updates', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns[0].cards.shift();
    remote.data.columns[0].cards[0].updatedAt = '2026-09-07T00:00:00Z';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(ids(document)).toEqual(['b', 'c']);
  });

  it('merges metadata changes without conflicting on updatedAt and keeps the latest timestamp', () => {
    const base = board(), local = clone(base), remote = clone(base);
    Object.assign(local.data.columns[0].cards[0], { title: 'Local', updatedAt: '2026-09-06T12:00:00Z' });
    Object.assign(remote.data.columns[0].cards[0], { description: 'Remote', updatedAt: '2026-09-06T11:00:00Z' });
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(byId(document, 'a')).toMatchObject({ title: 'Local', description: 'Remote', updatedAt: '2026-09-06T12:00:00Z' });
  });

  it.each(['add', 'edit', 'move'] as const)('makes column deletion versus child %s explicit and restores all children when keeping the column', (change) => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns.shift();
    if (change === 'add') remote.data.columns[0].cards.push(card('x'));
    if (change === 'edit') remote.data.columns[0].cards[0].title = 'Edited';
    if (change === 'move') move(remote, 'a', 'done');
    const draft = mergeBoardDocuments(base, local, remote);
    expect(draft.conflicts.map((entry) => entry.path)).toContain('data.columns[todo]');
    const deleted = mergeBoardDocuments(base, local, remote, 'local').document;
    expect(resultBoard(deleted).data.columns.map((entry) => entry.id)).toEqual(['done']);
    expect(allCards(deleted)).toEqual([]);
    const kept = mergeBoardDocuments(base, local, remote, 'remote').document;
    expect(allCards(kept).map((entry) => entry.id).sort()).toEqual(change === 'add' ? ['a', 'b', 'c', 'x'] : ['a', 'b', 'c']);
    if (change === 'move') expect(ids(kept, 'done')).toEqual(['a']);
    if (change === 'edit') expect(byId(kept, 'a')?.title).toBe('Edited');
  });

  it('merges a card moved out before deleting its source column with a concurrent edit', () => {
    const base = board(), local = clone(base), remote = clone(base);
    move(local, 'a', 'done');
    local.data.columns.shift();
    remote.data.columns[0].cards[0].title = 'Edited A';
    const { document } = mergeBoardDocuments(base, local, remote, 'local');
    expect(ids(document, 'done')).toEqual(['a']);
    expect(byId(document, 'a')?.title).toBe('Edited A');
  });

  it.each(['local', 'remote'] as const)('keeps the source card when %s deletes the destination of a concurrent move', (side) => {
    const base = board(), local = clone(base), remote = clone(base);
    const deleting = side === 'local' ? local : remote;
    const moving = side === 'local' ? remote : local;
    deleting.data.columns.pop();
    move(moving, 'a', 'done');
    byId(moving, 'a')!.description = 'Independent edit';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, side);
    expect(conflicts.map((entry) => entry.path)).toContain('data.columns[done]');
    expect(ids(document)).toEqual(['a', 'b', 'c']);
    expect(byId(document, 'a')?.description).toBe('Independent edit');
    expect(allCards(document)).toHaveLength(3);
  });

  it('preserves unrelated changes to other columns through a column lifecycle resolution', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns.shift();
    local.data.columns[0].title = 'Local done';
    remote.data.columns[0].cards.push(card('x'));
    remote.data.columns[1].cards.push(card('y'));
    const { document } = mergeBoardDocuments(base, local, remote, 'local');
    expect(resultBoard(document).data.columns[0].title).toBe('Local done');
    expect(ids(document, 'done')).toEqual(['y']);
  });

  it('merges column additions and reorders while regenerating contiguous order values', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns.reverse();
    local.data.columns.forEach((entry, index) => { entry.order = index; });
    remote.data.columns.splice(1, 0, column('new', [card('x')], 1));
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(resultBoard(document).data.columns.map((entry) => [entry.id, entry.order])).toEqual([['done', 0], ['todo', 1], ['new', 2]]);
    expect(ids(document, 'new')).toEqual(['x']);
  });

  it('supports clearing backgrounds and nested optional properties', () => {
    const base = board();
    base.data.background = 'blue';
    base.data.options = { background: 'red', other: true };
    const local = clone(base), remote = clone(base);
    delete local.data.background;
    local.data.options = { other: true };
    remote.description = 'Remote';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(document.data).not.toHaveProperty('background');
    expect(document.data.options).toEqual({ other: true });
    expect(document.description).toBe('Remote');
  });

  it('reports clear versus replacement and preserves independent fields on resolution', () => {
    const base = board();
    base.data.background = 'blue';
    const local = clone(base), remote = clone(base);
    delete local.data.background;
    remote.data.background = 'red';
    remote.description = 'Remote description';
    local.name = 'Local name';
    const draft = mergeBoardDocuments(base, local, remote);
    expect(draft.conflicts).toEqual([{ path: 'data.background', local: undefined, remote: 'red' }]);
    expect(draft.document.data).not.toHaveProperty('background');
    const { document } = mergeBoardDocuments(base, local, remote, 'remote');
    expect(document).toMatchObject({ name: 'Local name', description: 'Remote description', data: { background: 'red' } });
  });

  it('conflicts on nested delete versus edit without replacing unrelated checklist entries', () => {
    const base = board();
    base.data.columns[0].cards[0].content = { type: 'checklist', checklist: [
      { id: 'x', text: 'X', completed: false }, { id: 'y', text: 'Y', completed: false },
    ] };
    const local = clone(base), remote = clone(base);
    local.data.columns[0].cards[0].content!.checklist!.shift();
    remote.data.columns[0].cards[0].content!.checklist![0].completed = true;
    remote.data.columns[0].cards[0].content!.checklist![1].text = 'Changed Y';
    const { document, conflicts } = mergeBoardDocuments(base, local, remote, 'local');
    expect(conflicts[0].path).toBe('data.cards[a].card.content.checklist[x]');
    expect(byId(document, 'a')?.content?.checklist).toEqual([{ id: 'y', text: 'Changed Y', completed: false }]);
  });

  it('does not mutate any input', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.columns.shift();
    remote.data.columns[0].cards[0].title = 'Edited';
    const originals = [base, local, remote].map(clone);
    const { document } = mergeBoardDocuments(base, local, remote, 'remote');
    byId(document, 'a')!.title = 'Mutated output';
    expect([base, local, remote]).toEqual(originals);
  });

  it('preserves arbitrary JSON keys without reading inherited object properties', () => {
    const base = board(), local = clone(base), remote = clone(base);
    local.data.metadata = JSON.parse('{"constructor":"local","__proto__":{"safe":true}}');
    remote.data.metadata = JSON.parse('{"remote":true}');
    const { document, conflicts } = mergeBoardDocuments(base, local, remote);
    expect(conflicts).toEqual([]);
    expect(document.data.metadata).toEqual(JSON.parse('{"constructor":"local","__proto__":{"safe":true},"remote":true}'));
    expect(Object.prototype).not.toHaveProperty('safe');
  });

  it('rejects null columns instead of silently interpreting corrupted data as a deletion', () => {
    const base = board(), remote: BoardDocument = { ...base, data: { columns: null } };
    expect(() => mergeBoardDocuments(base, base, remote)).toThrow('expected an array');
  });

  it('validates remote collection structure before it enters the store', () => {
    expect(() => validateBoardDocument(board())).not.toThrow();
    const duplicated = board();
    duplicated.data.columns[1].cards.push(card('a'));
    expect(() => validateBoardDocument(duplicated)).toThrow('duplicate card id');
    expect(() => validateBoardDocument({ name: 'Board', description: null, data: { columns: [{ id: 'x', cards: null }] } })).toThrow('expected an array');
    expect(() => validateBoardDocument({ name: 'Board', description: null, data: null } as unknown as BoardDocument)).toThrow('Invalid board document');
  });

  it('fails closed on duplicate card or column identities', () => {
    const base = board(), cardsDuplicated = board(), columnsDuplicated = board();
    cardsDuplicated.data.columns[1].cards.push(card('a'));
    columnsDuplicated.data.columns.push(clone(columnsDuplicated.data.columns[0]));
    expect(() => mergeBoardDocuments(base, cardsDuplicated, base)).toThrow('duplicate card id a');
    expect(() => mergeBoardDocuments(base, base, columnsDuplicated)).toThrow('missing or duplicate id');
  });
});

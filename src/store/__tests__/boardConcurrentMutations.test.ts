import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Card } from '@/types';
import { documentsEqual } from '@/lib/board-merge';
import { useBoardStore } from '../useBoardStore';
import { useUndoStore } from '../useUndoStore';

vi.mock('uuid', async (importOriginal) => {
  const actual = await importOriginal<typeof import('uuid')>();
  let serial = 0;
  return { ...actual, v4: vi.fn(() => `concurrent-${++serial}`) };
});

const boardId = 'board';
const card = (id: string): Card => ({ id, title: id, labels: ['red'], content: { type: 'text', text: '' }, createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z' });
const current = (): Board => useBoardStore.getState().boards[0];
const document = (board: Board) => ({ name: board.name, description: board.description ?? null, data: { columns: board.columns } });
const cards = (): Card[] => current().columns.flatMap((column) => column.cards);
const cardIds = (columnId: string): string[] => current().columns.find((column) => column.id === columnId)!.cards.map((entry) => entry.id);
function externalChange(change: (board: Board) => void) {
  const board = structuredClone(current());
  change(board);
  useBoardStore.setState({ boards: [board] });
}
function remoteMove() {
  externalChange((board) => {
    const moved = board.columns[0].cards.shift()!;
    board.columns[1].cards.push(moved);
  });
}

beforeEach(() => {
  useBoardStore.getState().setCurrentUserId(null);
  useBoardStore.setState({
    currentUserId: null, activeBoardId: boardId, boardSyncStates: {}, remoteStatus: 'idle', remoteError: null,
    boards: [{
      id: boardId, name: 'Concurrent board', createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z',
      columns: [
        { id: 'source', title: 'Source', order: 0, cards: [card('a'), card('b')] },
        { id: 'destination', title: 'Destination', order: 1, cards: [] },
        { id: 'third', title: 'Third', order: 2, cards: [] },
      ],
    }],
  });
  useUndoStore.setState({ undoStack: [], redoStack: [], _skipRecord: false });
});

describe('board mutations after concurrent updates', () => {
  it('keeps new columns once when a stale reorder includes duplicate and deleted IDs', () => {
    externalChange((board) => { board.columns.push({ id: 'new', title: 'Remote column', order: 3, cards: [] }); });
    useBoardStore.getState().reorderColumns(boardId, ['destination', 'source', 'source', 'deleted']);
    expect(current().columns.map((column) => column.id)).toEqual(['destination', 'source', 'third', 'new']);
    expect(current().columns.map((column) => column.order)).toEqual([0, 1, 2, 3]);
  });

  it('keeps newly arrived cards once and rejects unknown IDs in a stale reorder', () => {
    externalChange((board) => { board.columns[0].cards.push(card('new')); });
    useBoardStore.getState().reorderCards(boardId, 'source', ['b', 'a', 'a', 'deleted']);
    expect(cardIds('source')).toEqual(['b', 'a', 'new']);
  });

  it('does not copy a card back from another column through stale reorder IDs', () => {
    remoteMove();
    useBoardStore.getState().reorderCards(boardId, 'source', ['b', 'a']);
    expect(cardIds('source')).toEqual(['b']);
    expect(cardIds('destination')).toEqual(['a']);
    expect(cards()).toHaveLength(2);
  });

  it('edits a moved card using its board-wide identity', () => {
    remoteMove();
    useBoardStore.getState().editCard(boardId, 'source', 'a', { title: 'Still editable' });
    expect(cards().find((entry) => entry.id === 'a')?.title).toBe('Still editable');
    expect(cardIds('source')).toEqual(['b']);
  });

  it('removes a moved card using its board-wide identity', () => {
    remoteMove();
    useBoardStore.getState().removeCard(boardId, 'source', 'a');
    expect(cards().map((entry) => entry.id)).toEqual(['b']);
  });

  it('moves a card from its actual location when the supplied source is stale', () => {
    remoteMove();
    useBoardStore.getState().moveCard(boardId, 'source', 'third', 'a');
    expect(cardIds('source')).toEqual(['b']);
    expect(cardIds('destination')).toEqual([]);
    expect(cardIds('third')).toEqual(['a']);
    expect(cards()).toHaveLength(2);
  });

  it('retains the source card if its destination was removed remotely', () => {
    externalChange((board) => { board.columns = board.columns.filter((column) => column.id !== 'destination'); });
    useBoardStore.getState().moveCard(boardId, 'source', 'destination', 'a');
    expect(cardIds('source')).toEqual(['a', 'b']);
  });

  it('reorders within the same column without deleting the moved card', () => {
    useBoardStore.getState().moveCard(boardId, 'source', 'source', 'a', 1);
    expect(cardIds('source')).toEqual(['b', 'a']);
    expect(cards()).toHaveLength(2);
  });

  it('undoes only edited fields while retaining unrelated remote labels', () => {
    useBoardStore.getState().editCard(boardId, 'source', 'a', { title: 'Local title' });
    externalChange((board) => { board.columns[0].cards[0].labels = ['blue']; });
    useUndoStore.getState().undo();
    expect(cards().find((entry) => entry.id === 'a')).toMatchObject({ title: 'a', labels: ['blue'] });
    useUndoStore.getState().redo();
    expect(cards().find((entry) => entry.id === 'a')).toMatchObject({ title: 'Local title', labels: ['blue'] });
  });

  it('undoes an edit after the edited card has moved remotely', () => {
    useBoardStore.getState().editCard(boardId, 'source', 'a', { title: 'Local title' });
    remoteMove();
    useUndoStore.getState().undo();
    expect(cards().find((entry) => entry.id === 'a')?.title).toBe('a');
    expect(cardIds('destination')).toEqual(['a']);
  });

  it('undoes adding an optional field by restoring its absence', () => {
    useBoardStore.getState().editCard(boardId, 'source', 'a', { coverImage: '/cover.png' });
    useUndoStore.getState().undo();
    expect(cards().find((entry) => entry.id === 'a')?.coverImage).toBeUndefined();
  });

  it('reuses the same column ID over repeated redo and undo', () => {
    useBoardStore.getState().addColumn(boardId, 'Local new column');
    const id = current().columns.at(-1)!.id;
    useUndoStore.getState().undo();
    expect(current().columns.some((column) => column.id === id)).toBe(false);
    useUndoStore.getState().redo();
    expect(current().columns.at(-1)!.id).toBe(id);
    useUndoStore.getState().undo();
    expect(current().columns.some((column) => column.id === id)).toBe(false);
    useUndoStore.getState().redo();
    expect(current().columns.filter((column) => column.id === id)).toHaveLength(1);
  });

  it('does not duplicate a restored card already present at another remote location', () => {
    const original = structuredClone(cards().find((entry) => entry.id === 'a')!);
    useBoardStore.getState().removeCard(boardId, 'source', 'a');
    externalChange((board) => { board.columns[1].cards.push({ ...original, title: 'Remote restored' }); });
    useUndoStore.getState().undo();
    expect(cards().filter((entry) => entry.id === 'a')).toHaveLength(1);
    expect(cardIds('destination')).toEqual(['a']);
    expect(cards().find((entry) => entry.id === 'a')?.title).toBe('Remote restored');
  });

  it('does not duplicate a removed column that was restored remotely', () => {
    const removed = structuredClone(current().columns[0]);
    useBoardStore.getState().removeColumn(boardId, 'source');
    externalChange((board) => { board.columns.unshift({ ...removed, title: 'Remote restored' }); });
    useUndoStore.getState().undo();
    expect(current().columns.filter((column) => column.id === 'source')).toHaveLength(1);
    expect(current().columns[0].title).toBe('Remote restored');
    expect(cards()).toHaveLength(2);
  });

  it('restores a removed column without duplicating children that were restored elsewhere', () => {
    const original = structuredClone(cards().find((entry) => entry.id === 'a')!);
    useBoardStore.getState().removeColumn(boardId, 'source');
    externalChange((board) => { board.columns[0].cards.push(original); });
    useUndoStore.getState().undo();
    expect(cardIds('source')).toEqual(['b']);
    expect(cardIds('destination')).toEqual(['a']);
    expect(cards()).toHaveLength(2);
  });
});


describe('recurring archive transactions', () => {
  function recurringSources() {
    externalChange((board) => {
      for (const entry of board.columns[0].cards) {
        entry.recurrence = { frequency: 'daily', interval: 1 };
        entry.targetDate = '2026-04-15';
      }
    });
  }

  it.each(['single', 'bulk'] as const)('undoes/redoes a %s archive and all its copies in one action, preserving remote edits and additions', (scope) => {
    recurringSources();
    if (scope === 'single') useBoardStore.getState().archiveCard(boardId, 'source', 'a');
    else useBoardStore.getState().archiveAllCards(boardId, 'source');
    const successorIds = cards().filter((entry) => !['a', 'b'].includes(entry.id)).map((entry) => entry.id);
    expect(successorIds).toHaveLength(scope === 'single' ? 1 : 2);
    expect(useUndoStore.getState().undoStack).toHaveLength(1);
    externalChange((board) => {
      const moved = board.columns[0].cards.shift()!;
      moved.description = 'New MCP description';
      board.columns[1].cards.push(moved);
      board.columns[0].cards.push(card('remote-addition'));
    });
    useUndoStore.getState().undo();
    expect(cards()).toHaveLength(3);
    expect(cards().every((entry) => !entry.isArchived)).toBe(true);
    expect(cards().find((entry) => entry.id === 'a')).toMatchObject({ description: 'New MCP description' });
    expect(cardIds('destination')).toEqual(['a']);
    expect(useUndoStore.getState().undoStack).toHaveLength(0);
    useUndoStore.getState().redo();
    expect(cards()).toHaveLength(3 + successorIds.length);
    expect(cards().filter((entry) => entry.isArchived).map((entry) => entry.id).sort()).toEqual(scope === 'single' ? ['a'] : ['a', 'b']);
    expect(cards().filter((entry) => successorIds.includes(entry.id))).toHaveLength(successorIds.length);
    expect(cards().find((entry) => entry.id === 'a')).toMatchObject({ description: 'New MCP description' });
    expect(cards().find((entry) => entry.id === 'remote-addition')?.isArchived).toBeUndefined();
    expect(cardIds('destination')).toEqual(['a']);
    useUndoStore.getState().undo();
    expect(cards()).toHaveLength(3);
  });

  it.each(['single', 'bulk'] as const)('a %s rearchive reuses a moved, already archived successor and undo leaves it intact', (scope) => {
    recurringSources();
    useBoardStore.getState().archiveCard(boardId, 'source', 'a');
    const successor = cards().find((entry) => !['a', 'b'].includes(entry.id))!;
    useBoardStore.getState().restoreCard(boardId, 'source', 'a');
    externalChange((board) => {
      board.columns[0].cards = board.columns[0].cards.filter((entry) => entry.id !== successor.id && entry.id !== 'b');
      board.columns[1].cards.push({ ...successor, title: 'Edited successor', isArchived: true, archivedAt: '2026-04-17' });
    });
    const before = structuredClone(current());
    useUndoStore.getState().clearHistory();
    if (scope === 'single') useBoardStore.getState().archiveCard(boardId, 'source', 'a');
    else useBoardStore.getState().archiveAllCards(boardId, 'source');
    expect(cards()).toHaveLength(2);
    expect(cardIds('destination')).toEqual([successor.id]);
    useUndoStore.getState().undo();
    // Replay may refresh updatedAt and normalize absent optional fields.
    expect(documentsEqual(document(current()), document(before))).toBe(true);
    useUndoStore.getState().redo();
    expect(cards()).toHaveLength(2);
    expect(cards().find((entry) => entry.id === successor.id)).toMatchObject({ title: 'Edited successor', isArchived: true });
  });

  it('repeated single archive is a no-op with no extra undo entry or timestamp changes', () => {
    recurringSources();
    useBoardStore.getState().archiveCard(boardId, 'source', 'a');
    const before = structuredClone(current());
    useBoardStore.getState().archiveCard(boardId, 'source', 'a');
    expect(current()).toEqual(before);
    expect(useUndoStore.getState().undoStack).toHaveLength(1);
  });

  it('undo keeps a successor edited remotely and redo does not add it twice', () => {
    recurringSources();
    useBoardStore.getState().archiveCard(boardId, 'source', 'a');
    const successorId = cards().find((entry) => !['a', 'b'].includes(entry.id))!.id;
    externalChange((board) => {
      board.columns[0].cards.find((entry) => entry.id === successorId)!.description = 'MCP work after archive';
    });
    useUndoStore.getState().undo();
    expect(cards().find((entry) => entry.id === 'a')?.isArchived).toBeUndefined();
    expect(cards().find((entry) => entry.id === successorId)?.description).toBe('MCP work after archive');
    useUndoStore.getState().redo();
    expect(cards().filter((entry) => entry.id === successorId)).toHaveLength(1);
    expect(cards().find((entry) => entry.id === successorId)?.description).toBe('MCP work after archive');
  });
});

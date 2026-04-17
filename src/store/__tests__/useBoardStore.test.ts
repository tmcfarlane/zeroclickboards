import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useBoardStore } from '../useBoardStore';
import { useUndoStore } from '../useUndoStore';

vi.mock('uuid', () => {
  let counter = 0;
  return {
    v4: vi.fn(() => `store-uuid-${++counter}`),
  };
});

function resetStores() {
  useBoardStore.setState({
    boards: [],
    activeBoardId: null,
    viewMode: 'board',
    currentUserId: null,
    remoteStatus: 'idle',
    remoteError: null,
  });
  useUndoStore.setState({ undoStack: [], redoStack: [], _skipRecord: false });
}

describe('useBoardStore', () => {
  beforeEach(() => {
    resetStores();
  });

  describe('createBoard', () => {
    it('adds a board and sets it as active', () => {
      const store = useBoardStore.getState();
      const id = store.createBoard('My Board', 'desc');

      const state = useBoardStore.getState();
      expect(state.boards).toHaveLength(1);
      expect(state.boards[0].name).toBe('My Board');
      expect(state.boards[0].description).toBe('desc');
      expect(state.activeBoardId).toBe(id);
    });

    it('creates default columns when none provided', () => {
      useBoardStore.getState().createBoard('Board');
      const board = useBoardStore.getState().boards[0];
      expect(board.columns.length).toBe(5);
      expect(board.columns[0].title).toBe('To Do');
    });

    it('uses provided columns', () => {
      const customCols = [
        { id: 'c1', title: 'Custom', cards: [], order: 0 },
      ];
      useBoardStore.getState().createBoard('Board', undefined, customCols);
      const board = useBoardStore.getState().boards[0];
      expect(board.columns).toHaveLength(1);
      expect(board.columns[0].title).toBe('Custom');
    });
  });

  describe('deleteBoard', () => {
    it('removes the board', () => {
      const id = useBoardStore.getState().createBoard('Board');
      useBoardStore.getState().deleteBoard(id);
      expect(useBoardStore.getState().boards).toHaveLength(0);
    });

    it('selects next board as active when active is deleted', () => {
      const id1 = useBoardStore.getState().createBoard('Board 1');
      useBoardStore.getState().createBoard('Board 2');
      useBoardStore.setState({ activeBoardId: id1 });

      useBoardStore.getState().deleteBoard(id1);
      expect(useBoardStore.getState().activeBoardId).not.toBe(id1);
      expect(useBoardStore.getState().activeBoardId).not.toBeNull();
    });

    it('sets activeBoardId to null when last board deleted', () => {
      const id = useBoardStore.getState().createBoard('Only Board');
      useBoardStore.getState().deleteBoard(id);
      expect(useBoardStore.getState().activeBoardId).toBeNull();
    });
  });

  describe('renameBoard', () => {
    it('renames the board', () => {
      const id = useBoardStore.getState().createBoard('Old Name');
      useBoardStore.getState().renameBoard(id, 'New Name');
      expect(useBoardStore.getState().boards[0].name).toBe('New Name');
    });
  });

  describe('column operations', () => {
    let boardId: string;

    beforeEach(() => {
      boardId = useBoardStore.getState().createBoard('Board');
    });

    it('addColumn adds a column', () => {
      const before = useBoardStore.getState().boards[0].columns.length;
      useBoardStore.getState().addColumn(boardId, 'New Column');
      const after = useBoardStore.getState().boards[0].columns.length;
      expect(after).toBe(before + 1);
      expect(useBoardStore.getState().boards[0].columns[after - 1].title).toBe('New Column');
    });

    it('removeColumn removes a column', () => {
      const board = useBoardStore.getState().boards[0];
      const colId = board.columns[0].id;
      const before = board.columns.length;

      useBoardStore.getState().removeColumn(boardId, colId);
      expect(useBoardStore.getState().boards[0].columns.length).toBe(before - 1);
    });

    it('renameColumn updates column title', () => {
      const board = useBoardStore.getState().boards[0];
      const colId = board.columns[0].id;

      useBoardStore.getState().renameColumn(boardId, colId, 'Renamed');
      expect(useBoardStore.getState().boards[0].columns[0].title).toBe('Renamed');
    });

    it('reorderColumns changes column order', () => {
      const board = useBoardStore.getState().boards[0];
      const ids = board.columns.map(c => c.id);
      const reversed = [...ids].reverse();

      useBoardStore.getState().reorderColumns(boardId, reversed);
      const reordered = useBoardStore.getState().boards[0].columns;
      expect(reordered.map(c => c.id)).toEqual(reversed);
    });
  });

  describe('card operations', () => {
    let boardId: string;
    let columnId: string;

    beforeEach(() => {
      boardId = useBoardStore.getState().createBoard('Board');
      columnId = useBoardStore.getState().boards[0].columns[0].id;
    });

    it('addCard adds a card to the specified column', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'New Card');
      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      expect(col.cards).toHaveLength(1);
      expect(col.cards[0].title).toBe('New Card');
      expect(cardId).toBeDefined();
    });

    it('addCard with content and targetDate', () => {
      useBoardStore.getState().addCard(
        boardId,
        columnId,
        'Card',
        { type: 'checklist', checklist: [{ id: '1', text: 'Item', completed: false }] },
        '2026-04-15'
      );
      const card = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!.cards[0];
      expect(card.content.type).toBe('checklist');
      expect(card.targetDate).toBe('2026-04-15');
    });

    it('removeCard removes a card', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'To Remove');
      useBoardStore.getState().removeCard(boardId, columnId, cardId);
      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      expect(col.cards).toHaveLength(0);
    });

    it('editCard updates card fields', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'Original');
      useBoardStore.getState().editCard(boardId, columnId, cardId, { title: 'Edited' });
      const card = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!.cards[0];
      expect(card.title).toBe('Edited');
    });

    it('moveCard moves card between columns', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'Move Me');
      const targetColumnId = useBoardStore.getState().boards[0].columns[1].id;

      useBoardStore.getState().moveCard(boardId, columnId, targetColumnId, cardId);

      const sourceCol = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      const targetCol = useBoardStore.getState().boards[0].columns.find(c => c.id === targetColumnId)!;
      expect(sourceCol.cards).toHaveLength(0);
      expect(targetCol.cards).toHaveLength(1);
      expect(targetCol.cards[0].title).toBe('Move Me');
    });

    it('moveCard to specific index', () => {
      const targetColumnId = useBoardStore.getState().boards[0].columns[1].id;
      useBoardStore.getState().addCard(boardId, targetColumnId, 'Existing');
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'Insert At 0');

      useBoardStore.getState().moveCard(boardId, columnId, targetColumnId, cardId, 0);

      const targetCol = useBoardStore.getState().boards[0].columns.find(c => c.id === targetColumnId)!;
      expect(targetCol.cards[0].title).toBe('Insert At 0');
      expect(targetCol.cards[1].title).toBe('Existing');
    });

    it('reorderCards reorders within a column', () => {
      const id1 = useBoardStore.getState().addCard(boardId, columnId, 'A');
      const id2 = useBoardStore.getState().addCard(boardId, columnId, 'B');
      const id3 = useBoardStore.getState().addCard(boardId, columnId, 'C');

      useBoardStore.getState().reorderCards(boardId, columnId, [id3, id1, id2]);

      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      expect(col.cards.map(c => c.title)).toEqual(['C', 'A', 'B']);
    });
  });

  describe('archive operations', () => {
    let boardId: string;
    let columnId: string;

    beforeEach(() => {
      boardId = useBoardStore.getState().createBoard('Board');
      columnId = useBoardStore.getState().boards[0].columns[0].id;
    });

    it('archiveCard sets isArchived to true', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'Archive Me');
      useBoardStore.getState().archiveCard(boardId, columnId, cardId);

      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      const card = col.cards.find(c => c.id === cardId)!;
      expect(card.isArchived).toBe(true);
      expect(card.archivedAt).toBeDefined();
    });

    it('restoreCard sets isArchived to false', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'Restore Me');
      useBoardStore.getState().archiveCard(boardId, columnId, cardId);
      useBoardStore.getState().restoreCard(boardId, columnId, cardId);

      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      const card = col.cards.find(c => c.id === cardId)!;
      expect(card.isArchived).toBe(false);
    });

    it('duplicateCard creates a copy', () => {
      const cardId = useBoardStore.getState().addCard(boardId, columnId, 'Original');
      useBoardStore.getState().duplicateCard(boardId, columnId, cardId);

      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      expect(col.cards).toHaveLength(2);
      expect(col.cards[1].title).toBe('Original (copy)');
      expect(col.cards[1].id).not.toBe(cardId);
    });

    it('archiveCard with recurrence creates a new copy', () => {
      const cardId = useBoardStore.getState().addCard(
        boardId,
        columnId,
        'Recurring',
        { type: 'text', text: '' },
        '2026-04-15',
        { recurrence: { frequency: 'daily', interval: 1 } }
      );

      useBoardStore.getState().archiveCard(boardId, columnId, cardId);

      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      // Original is archived, new copy exists
      const archived = col.cards.find(c => c.id === cardId)!;
      const newCopy = col.cards.find(c => c.id !== cardId)!;
      expect(archived.isArchived).toBe(true);
      expect(newCopy).toBeDefined();
      expect(newCopy.isArchived).toBe(false);
      expect(newCopy.targetDate).toBe('2026-04-16');
    });

    it('archiveAllCards archives all non-archived cards', () => {
      useBoardStore.getState().addCard(boardId, columnId, 'Card 1');
      useBoardStore.getState().addCard(boardId, columnId, 'Card 2');

      useBoardStore.getState().archiveAllCards(boardId, columnId);

      const col = useBoardStore.getState().boards[0].columns.find(c => c.id === columnId)!;
      const archivedCards = col.cards.filter(c => c.isArchived);
      expect(archivedCards).toHaveLength(2);
    });
  });

  describe('view and board settings', () => {
    it('setViewMode changes viewMode', () => {
      useBoardStore.getState().setViewMode('timeline');
      expect(useBoardStore.getState().viewMode).toBe('timeline');
    });

    it('setActiveBoard changes active board and clears undo', () => {
      const id1 = useBoardStore.getState().createBoard('Board 1');
      useBoardStore.getState().createBoard('Board 2');

      useUndoStore.getState().pushAction({ description: 'A', undo: vi.fn(), redo: vi.fn() });
      expect(useUndoStore.getState().undoStack).toHaveLength(1);

      useBoardStore.getState().setActiveBoard(id1);
      expect(useBoardStore.getState().activeBoardId).toBe(id1);
      expect(useUndoStore.getState().undoStack).toHaveLength(0);
    });

    it('toggleBoardPublic sets isPublic', () => {
      const id = useBoardStore.getState().createBoard('Board');
      useBoardStore.getState().toggleBoardPublic(id, true);
      expect(useBoardStore.getState().boards[0].isPublic).toBe(true);

      useBoardStore.getState().toggleBoardPublic(id, false);
      expect(useBoardStore.getState().boards[0].isPublic).toBe(false);
    });

    it('toggleBoardEmbed sets embedEnabled', () => {
      const id = useBoardStore.getState().createBoard('Board');
      useBoardStore.getState().toggleBoardEmbed(id, true);
      expect(useBoardStore.getState().boards[0].embedEnabled).toBe(true);
    });

    it('setBoardBackground sets background', () => {
      const id = useBoardStore.getState().createBoard('Board');
      useBoardStore.getState().setBoardBackground(id, 'bg-blue');
      expect(useBoardStore.getState().boards[0].background).toBe('bg-blue');
    });

    it('setBoardHiddenColumns sets hiddenColumnIds', () => {
      const id = useBoardStore.getState().createBoard('Board');
      useBoardStore.getState().setBoardHiddenColumns(id, ['col-1', 'col-2']);
      expect(useBoardStore.getState().boards[0].hiddenColumnIds).toEqual(['col-1', 'col-2']);
    });
  });

  describe('getters', () => {
    it('getActiveBoard returns null when no active board', () => {
      expect(useBoardStore.getState().getActiveBoard()).toBeNull();
    });

    it('getActiveBoard returns the active board', () => {
      useBoardStore.getState().createBoard('Board');
      const board = useBoardStore.getState().getActiveBoard();
      expect(board).not.toBeNull();
      expect(board!.name).toBe('Board');
    });

    it('getBoards returns all boards', () => {
      useBoardStore.getState().createBoard('A');
      useBoardStore.getState().createBoard('B');
      expect(useBoardStore.getState().getBoards()).toHaveLength(2);
    });

    it('getBoardsForUser returns all boards', () => {
      useBoardStore.getState().createBoard('A');
      expect(useBoardStore.getState().getBoardsForUser()).toHaveLength(1);
    });
  });
});

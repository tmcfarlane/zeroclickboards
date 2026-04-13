import { create } from 'zustand';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';
import type { AppState, Attachment, Board, Card, CardContent, CardLabel, Column, Json, RecurrenceConfig } from '@/types';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createRecurringCardCopy } from '@/lib/recurrence';
import { useUndoStore } from './useUndoStore';

interface BoardStore extends AppState {
  currentUserId: string | null;
  remoteStatus: 'idle' | 'loading' | 'ready' | 'error';
  remoteError: string | null;

  setCurrentUserId: (userId: string | null) => void;
  refreshFromRemote: () => Promise<void>;

  createBoard: (name: string, description?: string, columns?: Column[]) => string;
  deleteBoard: (boardId: string) => void;
  renameBoard: (boardId: string, newName: string) => void;
  setBoardBackground: (boardId: string, background: string | undefined) => void;
  setActiveBoard: (boardId: string) => void;

  addColumn: (boardId: string, title: string) => void;
  removeColumn: (boardId: string, columnId: string) => void;
  renameColumn: (boardId: string, columnId: string, newTitle: string) => void;
  reorderColumns: (boardId: string, columnIds: string[]) => void;

  addCard: {
    (boardId: string, columnId: string, title: string, content?: CardContent, targetDate?: string): string;
    (
      boardId: string,
      columnId: string,
      title: string,
      content: CardContent | undefined,
      targetDate: string | undefined,
      options: { labels?: CardLabel[]; coverImage?: string; attachments?: Attachment[]; recurrence?: RecurrenceConfig }
    ): string;
  };
  removeCard: (boardId: string, columnId: string, cardId: string) => void;
  editCard: (boardId: string, columnId: string, cardId: string, updates: Partial<Card>) => void;
  moveCard: (boardId: string, sourceColumnId: string, targetColumnId: string, cardId: string, targetIndex?: number) => void;
  reorderCards: (boardId: string, columnId: string, cardIds: string[]) => void;

  archiveCard: (boardId: string, columnId: string, cardId: string) => void;
  archiveAllCards: (boardId: string, columnId: string) => void;
  restoreCard: (boardId: string, columnId: string, cardId: string) => void;
  duplicateCard: (boardId: string, columnId: string, cardId: string) => void;

  setViewMode: (mode: 'board' | 'timeline') => void;

  toggleBoardPublic: (boardId: string, isPublic: boolean) => void;
  toggleBoardEmbed: (boardId: string, enabled: boolean) => void;

  getActiveBoard: () => Board | null;
  getBoards: () => Board[];
  getBoardsForUser: () => Board[];
}

const createDefaultColumns = (): Column[] => [
  { id: uuidv4(), title: 'To Do', cards: [], order: 0 },
  { id: uuidv4(), title: 'Blocked', cards: [], order: 1 },
  { id: uuidv4(), title: 'In Progress', cards: [], order: 2 },
  { id: uuidv4(), title: 'Resolved', cards: [], order: 3 },
  { id: uuidv4(), title: 'Closed', cards: [], order: 4 },
];

type BoardData = {
  columns: Column[];
};

function boardToData(board: Board): BoardData & { background?: string } {
  return { columns: board.columns, ...(board.background ? { background: board.background } : {}) };
}

function dataToColumns(data: Json | null | undefined): Column[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return createDefaultColumns();
  const columns = (data as Record<string, unknown>).columns;
  if (!Array.isArray(columns)) return createDefaultColumns();
  return columns as unknown as Column[];
}

function dataToBackground(data: Json | null | undefined): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const bg = (data as Record<string, unknown>).background;
  return typeof bg === 'string' ? bg : undefined;
}

const pendingBoardSync = new Map<string, ReturnType<typeof setTimeout>>();
let boardsChannel: RealtimeChannel | null = null;

function ensureBoardsSubscription(userId: string) {
  if (boardsChannel) {
    supabase.removeChannel(boardsChannel);
    boardsChannel = null;
  }

  boardsChannel = supabase
    .channel(`boards-${userId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'boards',
        filter: `user_id=eq.${userId}`,
      },
      (payload: { eventType: string; new: unknown; old: unknown }) => {
        const state = useBoardStore.getState();
        const rowToBoard = (row: unknown): Board | null => {
          if (!row || typeof row !== 'object') return null;
          const r = row as Record<string, unknown>;
          if (typeof r.id !== 'string') return null;
          if (typeof r.user_id !== 'string') return null;
          if (typeof r.name !== 'string') return null;
          if (typeof r.created_at !== 'string') return null;
          if (typeof r.updated_at !== 'string') return null;
          const description = typeof r.description === 'string' ? r.description : undefined;

          return {
            id: r.id,
            name: r.name,
            description,
            columns: dataToColumns(r.data as Json | null | undefined),
            background: dataToBackground(r.data as Json | null | undefined),
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            userId: r.user_id,
            isPublic: typeof r.is_public === 'boolean' ? r.is_public : false,
            embedEnabled: typeof r.embed_enabled === 'boolean' ? r.embed_enabled : false,
          };
        };

        if (payload.eventType === 'INSERT') {
          const next = rowToBoard(payload.new);
          if (!next) return;
          // Skip if board already exists locally (optimistic create)
          if (state.boards.some((b) => b.id === next.id)) return;
          useBoardStore.setState({
            boards: [...state.boards, next].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          });
        }
        if (payload.eventType === 'UPDATE') {
          const next = rowToBoard(payload.new);
          if (!next) return;
          useBoardStore.setState({
            boards: state.boards.map((b) => {
              if (b.id !== next.id) return b;
              // Merge: keep local fields that the realtime payload may not include
              return {
                ...b,
                ...next,
                background: next.background ?? b.background,
              };
            }),
          });
        }
        if (payload.eventType === 'DELETE') {
          const oldId = (() => {
            const old = payload.old;
            if (!old || typeof old !== 'object') return null;
            const r = old as Record<string, unknown>;
            return typeof r.id === 'string' ? r.id : null;
          })();
          if (!oldId) return;
          useBoardStore.setState({
            boards: state.boards.filter((b) => b.id !== oldId),
            activeBoardId: state.activeBoardId === oldId ? (state.boards.find((b) => b.id !== oldId)?.id ?? null) : state.activeBoardId,
          });
        }
      }
    )
    .subscribe();
}

function scheduleBoardSync(boardId: string) {
  const { currentUserId } = useBoardStore.getState();
  if (!currentUserId) return;

  const existing = pendingBoardSync.get(boardId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingBoardSync.delete(boardId);
    const state = useBoardStore.getState();
    const board = state.boards.find((b) => b.id === boardId);
    if (!board?.userId) return;

    supabase
      .from('boards')
      .update({
        name: board.name,
        description: board.description ?? null,
        data: boardToData(board) as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq('id', board.id)
      .then(({ error }) => {
        if (error) {
          console.error('[boards] sync failed:', error.message);
          toast.error('Failed to sync changes');
        }
      });
  }, 400);

  pendingBoardSync.set(boardId, timer);
}

export const useBoardStore = create<BoardStore>()((set, get) => ({
  boards: [],
  activeBoardId: null,
  viewMode: 'board',
  currentUserId: null,
  remoteStatus: 'idle',
  remoteError: null,

  setCurrentUserId: (userId) => {
    set({ currentUserId: userId });
    if (userId) {
      ensureBoardsSubscription(userId);
      void get().refreshFromRemote();
    } else {
      if (boardsChannel) {
        supabase.removeChannel(boardsChannel);
        boardsChannel = null;
      }
      set({ boards: [], activeBoardId: null, remoteStatus: 'idle', remoteError: null });
    }
  },

  refreshFromRemote: async () => {
    const userId = get().currentUserId;
    if (!userId) return;
    set({ remoteStatus: 'loading', remoteError: null });

    // Fetch owned boards and shared boards in parallel
    const [ownResult, memberResult] = await Promise.all([
      supabase
        .from('boards')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true }),
      supabase
        .from('board_members')
        .select('board_id')
        .eq('user_id', userId),
    ]);

    if (ownResult.error) {
      set({ remoteStatus: 'error', remoteError: ownResult.error.message });
      toast.error('Failed to load boards');
      return;
    }

    let sharedBoards: typeof ownResult.data = [];
    if (memberResult.data && memberResult.data.length > 0) {
      const sharedIds = memberResult.data.map((m) => m.board_id);
      const { data: shared } = await supabase
        .from('boards')
        .select('*')
        .in('id', sharedIds)
        .order('created_at', { ascending: true });
      if (shared) sharedBoards = shared;
    }

    // Merge and deduplicate
    const allRows = [...(ownResult.data || []), ...sharedBoards];
    const seen = new Set<string>();
    const data = allRows.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });

    const nextBoards: Board[] = data.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      columns: dataToColumns(row.data),
      background: dataToBackground(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userId: row.user_id,
      isPublic: row.is_public ?? false,
      embedEnabled: row.embed_enabled ?? false,
    }));

    set((state) => {
      const activeBoardStillExists = state.activeBoardId && nextBoards.some((b) => b.id === state.activeBoardId);
      return {
        boards: nextBoards,
        activeBoardId: activeBoardStillExists ? state.activeBoardId : nextBoards[0]?.id ?? null,
        remoteStatus: 'ready',
        remoteError: null,
      };
    });

  },

  createBoard: (name, description, columns) => {
    const userId = get().currentUserId;
    const now = new Date().toISOString();

    const newBoard: Board = {
      id: uuidv4(),
      name,
      description,
      columns: columns || createDefaultColumns(),
      createdAt: now,
      updatedAt: now,
      userId: userId ?? undefined,
    };

    set((state) => ({
      boards: [...state.boards, newBoard],
      activeBoardId: newBoard.id,
    }));
    toast.success('Board created');

    if (userId) {
      supabase.from('boards').upsert({
        id: newBoard.id,
        user_id: userId,
        name: newBoard.name,
        description: newBoard.description ?? null,
        data: boardToData(newBoard) as unknown as Json,
        created_at: newBoard.createdAt,
        updated_at: newBoard.updatedAt,
      }).then(({ error }) => {
        if (error) {
          console.error('[boards] upsert failed:', error.message);
          toast.error('Failed to save board');
        }
      });
    }

    return newBoard.id;
  },

  deleteBoard: (boardId) => {
    const userId = get().currentUserId;

    set((state) => ({
      boards: state.boards.filter((b) => b.id !== boardId),
      activeBoardId:
        state.activeBoardId === boardId
          ? state.boards.find((b) => b.id !== boardId)?.id || null
          : state.activeBoardId,
    }));

    toast.success('Board deleted');

    if (userId) {
      supabase.from('boards').delete().eq('id', boardId).eq('user_id', userId)
        .then(({ error }) => {
          if (error) {
            console.error('[boards] delete failed:', error.message);
            toast.error('Failed to delete board');
          }
        });
    }
  },

  renameBoard: (boardId, newName) => {
    set((state) => ({
      boards: state.boards.map((b) => (b.id === boardId ? { ...b, name: newName, updatedAt: new Date().toISOString() } : b)),
    }));
    toast.success('Board renamed');
    scheduleBoardSync(boardId);
  },

  setBoardBackground: (boardId, background) => {
    set((state) => ({
      boards: state.boards.map((b) => (b.id === boardId ? { ...b, background, updatedAt: new Date().toISOString() } : b)),
    }));
    scheduleBoardSync(boardId);
  },

  setActiveBoard: (boardId) => {
    set({ activeBoardId: boardId });
    useUndoStore.getState().clearHistory();
  },

  addColumn: (boardId, title) => {
    const newId = uuidv4();
    set((state) => ({
      boards: state.boards.map((b) => {
        if (b.id !== boardId) return b;
        const maxOrder = Math.max(...b.columns.map((c) => c.order), -1);
        return {
          ...b,
          columns: [...b.columns, { id: newId, title, cards: [], order: maxOrder + 1 }],
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    toast.success('Column added');
    scheduleBoardSync(boardId);

    useUndoStore.getState().pushAction({
      description: `Add column '${title}'`,
      undo: () => useBoardStore.getState().removeColumn(boardId, newId),
      redo: () => useBoardStore.getState().addColumn(boardId, title),
    });
  },

  removeColumn: (boardId, columnId) => {
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const columnClone = column ? structuredClone(column) : null;
    const columnIndex = board?.columns.findIndex((c) => c.id === columnId) ?? -1;

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? { ...b, columns: b.columns.filter((c) => c.id !== columnId), updatedAt: new Date().toISOString() }
          : b
      ),
    }));
    toast.success('Column removed');
    scheduleBoardSync(boardId);

    if (columnClone) {
      useUndoStore.getState().pushAction({
        description: `Remove column '${columnClone.title}'`,
        undo: () => {
          useBoardStore.setState((state) => ({
            boards: state.boards.map((b) => {
              if (b.id !== boardId) return b;
              const cols = [...b.columns];
              cols.splice(Math.min(columnIndex, cols.length), 0, columnClone);
              return { ...b, columns: cols, updatedAt: new Date().toISOString() };
            }),
          }));
          scheduleBoardSync(boardId);
          toast.success('Column restored');
        },
        redo: () => useBoardStore.getState().removeColumn(boardId, columnId),
      });
    }
  },

  renameColumn: (boardId, columnId, newTitle) => {
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const oldTitle = column?.title ?? '';

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? {
              ...b,
              columns: b.columns.map((c) => (c.id === columnId ? { ...c, title: newTitle } : c)),
              updatedAt: new Date().toISOString(),
            }
          : b
      ),
    }));
    scheduleBoardSync(boardId);

    if (oldTitle !== newTitle) {
      useUndoStore.getState().pushAction({
        description: `Rename column '${oldTitle}' to '${newTitle}'`,
        undo: () => useBoardStore.getState().renameColumn(boardId, columnId, oldTitle),
        redo: () => useBoardStore.getState().renameColumn(boardId, columnId, newTitle),
      });
    }
  },

  reorderColumns: (boardId, columnIds) => {
    set((state) => ({
      boards: state.boards.map((b) => {
        if (b.id !== boardId) return b;
        const columnMap = new Map(b.columns.map((c) => [c.id, c]));
        return {
          ...b,
          columns: columnIds.map((id, index) => ({ ...columnMap.get(id)!, order: index })),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleBoardSync(boardId);
  },

  addCard: (
    boardId,
    columnId,
    title,
    content,
    targetDate,
    options?: { labels?: CardLabel[]; coverImage?: string; attachments?: Attachment[]; recurrence?: RecurrenceConfig }
  ) => {
    const now = new Date().toISOString();
    const newCard: Card = {
      id: uuidv4(),
      title,
      content: content || { type: 'text', text: '' },
      targetDate,
      labels: options?.labels ?? [],
      coverImage: options?.coverImage,
      attachments: options?.attachments,
      recurrence: options?.recurrence,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? {
              ...b,
              columns: b.columns.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, newCard] } : c)),
              updatedAt: now,
            }
          : b
      ),
    }));
    toast.success('Card added');
    scheduleBoardSync(boardId);

    useUndoStore.getState().pushAction({
      description: `Add card '${title}'`,
      undo: () => useBoardStore.getState().removeCard(boardId, columnId, newCard.id),
      redo: () => {
        useBoardStore.setState((state) => ({
          boards: state.boards.map((b) =>
            b.id === boardId
              ? {
                  ...b,
                  columns: b.columns.map((c) =>
                    c.id === columnId ? { ...c, cards: [...c.cards, newCard] } : c
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : b
          ),
        }));
        scheduleBoardSync(boardId);
      },
    });

    return newCard.id;
  },

  removeCard: (boardId, columnId, cardId) => {
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const card = column?.cards.find((c) => c.id === cardId);
    const cardIndex = column?.cards.findIndex((c) => c.id === cardId) ?? -1;
    const cardClone = card ? structuredClone(card) : null;

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? {
              ...b,
              columns: b.columns.map((c) =>
                c.id === columnId ? { ...c, cards: c.cards.filter((card) => card.id !== cardId) } : c
              ),
              updatedAt: new Date().toISOString(),
            }
          : b
      ),
    }));
    toast.success('Card deleted');
    scheduleBoardSync(boardId);

    if (cardClone) {
      useUndoStore.getState().pushAction({
        description: `Delete card '${cardClone.title}'`,
        undo: () => {
          useBoardStore.setState((state) => ({
            boards: state.boards.map((b) =>
              b.id === boardId
                ? {
                    ...b,
                    columns: b.columns.map((c) => {
                      if (c.id !== columnId) return c;
                      const cards = [...c.cards];
                      cards.splice(Math.min(cardIndex, cards.length), 0, cardClone);
                      return { ...c, cards };
                    }),
                    updatedAt: new Date().toISOString(),
                  }
                : b
            ),
          }));
          scheduleBoardSync(boardId);
          toast.success('Card restored');
        },
        redo: () => useBoardStore.getState().removeCard(boardId, columnId, cardId),
      });
    }
  },

  editCard: (boardId, columnId, cardId, updates) => {
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const card = column?.cards.find((c) => c.id === cardId);
    const prevState = card ? structuredClone(card) : null;

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? {
              ...b,
              columns: b.columns.map((c) =>
                c.id === columnId
                  ? {
                      ...c,
                      cards: c.cards.map((card) =>
                        card.id === cardId ? { ...card, ...updates, updatedAt: new Date().toISOString() } : card
                      ),
                    }
                  : c
              ),
              updatedAt: new Date().toISOString(),
            }
          : b
      ),
    }));
    scheduleBoardSync(boardId);

    if (prevState) {
      useUndoStore.getState().pushAction({
        description: `Edit card '${prevState.title}'`,
        undo: () => {
          useBoardStore.getState().editCard(boardId, columnId, cardId, prevState);
        },
        redo: () => {
          useBoardStore.getState().editCard(boardId, columnId, cardId, updates);
        },
      });
    }
  },

  moveCard: (boardId, sourceColumnId, targetColumnId, cardId, targetIndex) => {
    set((state) => {
      const board = state.boards.find((b) => b.id === boardId);
      if (!board) return state;
      const sourceColumn = board.columns.find((c) => c.id === sourceColumnId);
      if (!sourceColumn) return state;
      const card = sourceColumn.cards.find((c) => c.id === cardId);
      if (!card) return state;

      return {
        boards: state.boards.map((b) => {
          if (b.id !== boardId) return b;
          return {
            ...b,
            columns: b.columns.map((c) => {
              if (c.id === sourceColumnId) {
                return { ...c, cards: c.cards.filter((x) => x.id !== cardId) };
              }
              if (c.id === targetColumnId) {
                const nextCards = [...c.cards];
                const insertIndex = targetIndex !== undefined ? targetIndex : nextCards.length;
                nextCards.splice(insertIndex, 0, card);
                return { ...c, cards: nextCards };
              }
              return c;
            }),
            updatedAt: new Date().toISOString(),
          };
        }),
      };
    });
    scheduleBoardSync(boardId);
    // Undo for cross-column moves is handled in KanbanBoard handleDragEnd
    // to avoid stale references from intermediate handleDragOver calls.
  },

  reorderCards: (boardId, columnId, cardIds) => {
    set((state) => ({
      boards: state.boards.map((b) => {
        if (b.id !== boardId) return b;
        const column = b.columns.find((c) => c.id === columnId);
        if (!column) return b;
        const cardMap = new Map(column.cards.map((c) => [c.id, c] as const));
        return {
          ...b,
          columns: b.columns.map((c) =>
            c.id === columnId ? { ...c, cards: cardIds.map((id) => cardMap.get(id)!).filter(Boolean) } : c
          ),
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    scheduleBoardSync(boardId);
  },

  archiveCard: (boardId, columnId, cardId) => {
    // Look up card BEFORE archiving to check for recurrence
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const card = column?.cards.find((c) => c.id === cardId);
    const hasRecurrence = card?.recurrence && !card.isArchived;

    get().editCard(boardId, columnId, cardId, { isArchived: true, archivedAt: new Date().toISOString() });

    // If card has recurrence, create a new copy in the same column
    if (hasRecurrence && card) {
      const newCard = createRecurringCardCopy(card);
      set((state) => ({
        boards: state.boards.map((b) =>
          b.id === boardId
            ? {
                ...b,
                columns: b.columns.map((c) =>
                  c.id === columnId ? { ...c, cards: [...c.cards, newCard] } : c
                ),
                updatedAt: new Date().toISOString(),
              }
            : b
        ),
      }));
      scheduleBoardSync(boardId);
      toast.success('Card archived — recurring copy created');
    } else {
      toast.success('Card archived');
    }

    // editCard already pushed an undo action — replace its description with a cleaner one
    const undoStore = useUndoStore.getState();
    const lastAction = undoStore.undoStack[undoStore.undoStack.length - 1];
    if (lastAction) {
      useUndoStore.setState((s) => ({
        undoStack: [...s.undoStack.slice(0, -1), { ...lastAction, description: `Archive card` }],
      }));
    }
  },

  archiveAllCards: (boardId, columnId) => {
    const now = new Date().toISOString();
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const recurringCards = column?.cards.filter((c) => c.recurrence && !c.isArchived) || [];
    const newRecurringCards = recurringCards.map((c) => createRecurringCardCopy(c));

    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? {
              ...b,
              columns: b.columns.map((c) =>
                c.id === columnId
                  ? {
                      ...c,
                      cards: [
                        ...c.cards.map((card) =>
                          card.isArchived ? card : { ...card, isArchived: true, archivedAt: now, updatedAt: now }
                        ),
                        ...newRecurringCards,
                      ],
                    }
                  : c
              ),
              updatedAt: now,
            }
          : b
      ),
    }));
    toast.success(newRecurringCards.length > 0 ? `All cards archived — ${newRecurringCards.length} recurring copies created` : 'All cards archived');
    scheduleBoardSync(boardId);
  },

  restoreCard: (boardId, columnId, cardId) => {
    get().editCard(boardId, columnId, cardId, { isArchived: false, archivedAt: undefined });
    toast.success('Card restored');

    // editCard already pushed an undo action — replace its description with a cleaner one
    const undoStore = useUndoStore.getState();
    const lastAction = undoStore.undoStack[undoStore.undoStack.length - 1];
    if (lastAction) {
      useUndoStore.setState((s) => ({
        undoStack: [...s.undoStack.slice(0, -1), { ...lastAction, description: `Restore card` }],
      }));
    }
  },

  duplicateCard: (boardId, columnId, cardId) => {
    const board = get().boards.find((b) => b.id === boardId);
    const column = board?.columns.find((c) => c.id === columnId);
    const card = column?.cards.find((c) => c.id === cardId);
    if (!card) return;
    const now = new Date().toISOString();
    const copy: Card = {
      ...card,
      id: uuidv4(),
      title: `${card.title} (copy)`,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? {
              ...b,
              columns: b.columns.map((c) => (c.id === columnId ? { ...c, cards: [...c.cards, copy] } : c)),
              updatedAt: now,
            }
          : b
      ),
    }));
    toast.success('Card duplicated');
    scheduleBoardSync(boardId);
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  toggleBoardPublic: (boardId, isPublic) => {
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId ? { ...b, isPublic, updatedAt: new Date().toISOString() } : b
      ),
    }));
    const userId = get().currentUserId;
    if (userId) {
      supabase
        .from('boards')
        .update({ is_public: isPublic, updated_at: new Date().toISOString() })
        .eq('id', boardId)
        .eq('user_id', userId)
        .then(({ error }) => {
          if (error) {
            console.error('[boards] toggle public failed:', error.message);
            toast.error('Failed to update board visibility');
          }
        });
    }
  },

  toggleBoardEmbed: (boardId, enabled) => {
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId ? { ...b, embedEnabled: enabled, updatedAt: new Date().toISOString() } : b
      ),
    }));
    const userId = get().currentUserId;
    if (userId) {
      supabase
        .from('boards')
        .update({ embed_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', boardId)
        .eq('user_id', userId)
        .then(({ error }) => {
          if (error) {
            console.error('[boards] toggle embed failed:', error.message);
            toast.error('Failed to update embed settings');
          }
        });
    }
  },

  getActiveBoard: () => {
    const { boards, activeBoardId } = get();
    return boards.find((b) => b.id === activeBoardId) || null;
  },

  getBoards: () => get().boards,

  getBoardsForUser: () => {
    return get().boards;
  },
}));

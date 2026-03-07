import { create } from 'zustand';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';
import type { AppState, Board, Card, CardContent, CardLabel, Column, Json } from '@/types';
import type { RealtimeChannel } from '@supabase/supabase-js';

interface BoardStore extends AppState {
  currentUserId: string | null;
  remoteStatus: 'idle' | 'loading' | 'ready' | 'error';
  remoteError: string | null;

  setCurrentUserId: (userId: string | null) => void;
  refreshFromRemote: () => Promise<void>;

  createBoard: (name: string, description?: string) => string;
  deleteBoard: (boardId: string) => void;
  renameBoard: (boardId: string, newName: string) => void;
  setActiveBoard: (boardId: string) => void;

  addColumn: (boardId: string, title: string) => void;
  removeColumn: (boardId: string, columnId: string) => void;
  renameColumn: (boardId: string, columnId: string, newTitle: string) => void;
  reorderColumns: (boardId: string, columnIds: string[]) => void;

  addCard: {
    (boardId: string, columnId: string, title: string, content?: CardContent, targetDate?: string): void;
    (
      boardId: string,
      columnId: string,
      title: string,
      content: CardContent | undefined,
      targetDate: string | undefined,
      options: { labels?: CardLabel[]; coverImage?: string }
    ): void;
  };
  removeCard: (boardId: string, columnId: string, cardId: string) => void;
  editCard: (boardId: string, columnId: string, cardId: string, updates: Partial<Card>) => void;
  moveCard: (boardId: string, sourceColumnId: string, targetColumnId: string, cardId: string, targetIndex?: number) => void;
  reorderCards: (boardId: string, columnId: string, cardIds: string[]) => void;

  archiveCard: (boardId: string, columnId: string, cardId: string) => void;
  restoreCard: (boardId: string, columnId: string, cardId: string) => void;
  duplicateCard: (boardId: string, columnId: string, cardId: string) => void;

  setViewMode: (mode: 'board' | 'timeline') => void;

  getActiveBoard: () => Board | null;
  getBoards: () => Board[];
  getBoardsForUser: (userId: string | null) => Board[];
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

function boardToData(board: Board): BoardData {
  return { columns: board.columns };
}

function dataToColumns(data: Json | null | undefined): Column[] {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return createDefaultColumns();
  const columns = (data as Record<string, unknown>).columns;
  if (!Array.isArray(columns)) return createDefaultColumns();
  return columns as unknown as Column[];
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
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            userId: r.user_id,
          };
        };

        if (payload.eventType === 'INSERT') {
          const next = rowToBoard(payload.new);
          if (!next) return;
          useBoardStore.setState({
            boards: [...state.boards, next].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          });
        }
        if (payload.eventType === 'UPDATE') {
          const next = rowToBoard(payload.new);
          if (!next) return;
          useBoardStore.setState({
            boards: state.boards.map((b) => (b.id === next.id ? next : b)),
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
      .eq('user_id', board.userId)
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

    const { data, error } = await supabase
      .from('boards')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });

    if (error) {
      set({ remoteStatus: 'error', remoteError: error.message });
      toast.error('Failed to load boards');
      return;
    }

    const nextBoards: Board[] = (data || []).map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? undefined,
      columns: dataToColumns(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      userId: row.user_id,
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

  createBoard: (name, description) => {
    const userId = get().currentUserId;
    const now = new Date().toISOString();

    const newBoard: Board = {
      id: uuidv4(),
      name,
      description,
      columns: createDefaultColumns(),
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

  setActiveBoard: (boardId) => {
    set({ activeBoardId: boardId });
  },

  addColumn: (boardId, title) => {
    set((state) => ({
      boards: state.boards.map((b) => {
        if (b.id !== boardId) return b;
        const maxOrder = Math.max(...b.columns.map((c) => c.order), -1);
        return {
          ...b,
          columns: [...b.columns, { id: uuidv4(), title, cards: [], order: maxOrder + 1 }],
          updatedAt: new Date().toISOString(),
        };
      }),
    }));
    toast.success('Column added');
    scheduleBoardSync(boardId);
  },

  removeColumn: (boardId, columnId) => {
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId
          ? { ...b, columns: b.columns.filter((c) => c.id !== columnId), updatedAt: new Date().toISOString() }
          : b
      ),
    }));
    toast.success('Column removed');
    scheduleBoardSync(boardId);
  },

  renameColumn: (boardId, columnId, newTitle) => {
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
    options?: { labels?: CardLabel[]; coverImage?: string }
  ) => {
    const now = new Date().toISOString();
    const newCard: Card = {
      id: uuidv4(),
      title,
      content: content || { type: 'text', text: '' },
      targetDate,
      labels: options?.labels ?? [],
      coverImage: options?.coverImage,
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
  },

  removeCard: (boardId, columnId, cardId) => {
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
  },

  editCard: (boardId, columnId, cardId, updates) => {
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
    get().editCard(boardId, columnId, cardId, { isArchived: true, archivedAt: new Date().toISOString() });
    toast.success('Card archived');
  },

  restoreCard: (boardId, columnId, cardId) => {
    get().editCard(boardId, columnId, cardId, { isArchived: false, archivedAt: undefined });
    toast.success('Card restored');
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

  getActiveBoard: () => {
    const { boards, activeBoardId, currentUserId } = get();
    const board = boards.find((b) => b.id === activeBoardId) || null;
    if (!board) return null;
    if (!board.userId || board.userId === currentUserId) return board;
    return null;
  },

  getBoards: () => get().boards,

  getBoardsForUser: (userId) => {
    const { boards } = get();
    return boards.filter((b) => !b.userId || b.userId === userId);
  },
}));

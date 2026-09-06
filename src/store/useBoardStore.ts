import { create } from 'zustand';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '@/lib/supabase';
import type { AppState, Attachment, Board, Card, CardContent, CardLabel, Column, Json, RecurrenceConfig } from '@/types';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createRecurringCardCopy } from '@/lib/recurrence';
import { useUndoStore } from './useUndoStore';
import { BoardSyncCoordinator, type BoardSnapshot, type BoardSyncState } from '@/lib/board-sync';
import { validateBoardDocument, mergeBoardDocuments, type BoardDocument } from '@/lib/board-merge';
import type { BoardRow } from '@/types/database';
import type { CardEditorSaveData } from '@/components/board/CardEditor';

export interface CardEditorSession {
  boardId: string;
  cardId: string;
  board: Board;
  document: BoardDocument;
  baseline?: BoardDocument;
  card: Card;
}

interface BoardStore extends AppState {
  currentUserId: string | null;
  remoteStatus: 'idle' | 'loading' | 'ready' | 'error';
  remoteError: string | null;
  boardSyncStates: Record<string, BoardSyncState>;
  cardEditorSession: CardEditorSession | null;
  openCardEditor: (boardId: string, cardId: string) => void;
  closeCardEditor: () => void;
  saveCardEditor: (data: CardEditorSaveData, initialForm?: CardEditorSaveData) => void;
  retryBoardSync: (boardId: string) => void;
  resolveBoardConflict: (boardId: string, choice: 'local' | 'remote') => void;
  saveBoardDraftAsCopy: (boardId: string) => void;
  discardBoardDraft: (boardId: string) => void;

  setCurrentUserId: (userId: string | null) => void;
  refreshFromRemote: () => Promise<void>;

  createBoard: (name: string, description?: string, columns?: Column[]) => string;
  deleteBoard: (boardId: string) => void;
  renameBoard: (boardId: string, newName: string) => void;
  setBoardBackground: (boardId: string, background: string | undefined) => void;
  setBoardHiddenColumns: (boardId: string, hiddenColumnIds: string[]) => void;
  setActiveBoard: (boardId: string) => void;
  syncBoard: (boardId: string) => void;

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

// Keep opaque JSONB fields so older browser versions cannot erase MCP extensions.
const rawBoardData = new Map<string, Record<string, unknown>>();
let sessionEpoch = 0;
let refreshSequence = 0;
let boardsChannel: RealtimeChannel | null = null;
let boardSync: BoardSyncCoordinator | null = null;
type BoardSettings = Pick<Board, 'isPublic' | 'embedEnabled'>;
const pendingSettings = new Map<string, Partial<BoardSettings>>();
const settingJobs = new Map<string, Promise<void>>();
const creatingBoards = new Map<string, { snapshot: BoardSnapshot; job?: Promise<boolean> }>();

function boardToDocument(board: Board): BoardDocument {
  return {
    name: board.name,
    description: board.description ?? null,
    data: {
      ...rawBoardData.get(board.id),
      columns: board.columns,
      background: board.background,
      hiddenColumnIds: board.hiddenColumnIds?.length || rawBoardData.get(board.id)?.hiddenColumnIds !== undefined ? board.hiddenColumnIds ?? [] : undefined,
    },
  };
}

function documentToBoard(board: Board, document: BoardDocument): Board {
  const data = document.data;
  return {
    ...board, name: document.name, description: document.description ?? undefined,
    columns: data.columns as Column[],
    background: typeof data.background === 'string' ? data.background : undefined,
    hiddenColumnIds: Array.isArray(data.hiddenColumnIds) ? data.hiddenColumnIds.filter((id): id is string => typeof id === 'string') : [],
  };
}

function rowToSnapshot(row: BoardRow): BoardSnapshot {
  if (!row.data || typeof row.data !== 'object' || Array.isArray(row.data)) throw new Error('Board data could not be read safely');
  const data = { ...row.data, columns: row.data.columns === undefined ? [] : row.data.columns } as Record<string, unknown>;
  if (!Array.isArray(data.columns)) throw new Error('Board columns could not be read safely');
  if (data.background === null) data.background = undefined;
  if (data.hiddenColumnIds === null) data.hiddenColumnIds = undefined;
  if (data.background !== undefined && typeof data.background !== 'string') throw new Error('Board background could not be read safely');
  if (data.hiddenColumnIds !== undefined && (!Array.isArray(data.hiddenColumnIds) || data.hiddenColumnIds.some((id) => typeof id !== 'string'))) throw new Error('Hidden columns could not be read safely');
  const document = { name: row.name, description: row.description ?? null, data };
  validateBoardDocument(document);
  return {
    revision: row.updated_at, document,
    board: documentToBoard({
      id: row.id, name: row.name, columns: [], createdAt: row.created_at, updatedAt: row.updated_at,
      userId: row.user_id, isPublic: row.is_public ?? false, embedEnabled: row.embed_enabled ?? false,
    }, document),
  };
}

function removeLocalBoard(id: string) {
  rawBoardData.delete(id);
  pendingSettings.delete(id);
  useBoardStore.setState((state) => {
    const boardSyncStates = { ...state.boardSyncStates };
    delete boardSyncStates[id];
    const boards = state.boards.filter((board) => board.id !== id);
    return { boards, boardSyncStates, activeBoardId: state.activeBoardId === id ? boards[0]?.id ?? null : state.activeBoardId };
  });
}

function createSyncCoordinator(epoch: number) {
  return new BoardSyncCoordinator({
    read: async (id) => {
      if (epoch !== sessionEpoch) return null;
      const { data, error } = await supabase.from('boards').select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data ? rowToSnapshot(data) : null;
    },
    write: async (id, revision, document) => {
      if (epoch !== sessionEpoch) return null;
      const { data, error } = await supabase.from('boards')
        .update({ name: document.name, description: document.description, data: document.data as Json })
        .eq('id', id).eq('updated_at', revision).select('*').maybeSingle();
      if (error) throw error;
      return data ? rowToSnapshot(data) : null;
    },
    local: (id) => {
      const board = useBoardStore.getState().boards.find((candidate) => candidate.id === id);
      return board ? boardToDocument(board) : undefined;
    },
    apply: (snapshot, document) => {
      if (epoch !== sessionEpoch) return;
      rawBoardData.set(snapshot.board.id, structuredClone(document.data));
      const next = { ...documentToBoard(snapshot.board, document), ...pendingSettings.get(snapshot.board.id) };
      useBoardStore.setState((state) => ({
        boards: (state.boards.some((board) => board.id === next.id)
          ? state.boards.map((board) => board.id === next.id ? next : board)
          : [...state.boards, next]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
        activeBoardId: state.activeBoardId ?? next.id,
      }));
    },
    remove: (id) => { if (epoch === sessionEpoch) removeLocalBoard(id); },
    state: (id, state) => {
      if (epoch === sessionEpoch) useBoardStore.setState((current) => ({ boardSyncStates: { ...current.boardSyncStates, [id]: state } }));
    },
  });
}

function ensureBoardsSubscription(userId: string, epoch: number) {
  // RLS filters delivery. The callback also limits public-board events to the
  // boards actually loaded by this user, while including shared editor boards.
  boardsChannel = supabase.channel(`boards-${userId}-${epoch}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boards' },
      (payload: { eventType: string; new: unknown; old: unknown }) => {
        if (epoch !== sessionEpoch) return;
        const state = useBoardStore.getState();
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { id?: string })?.id;
          if (id) boardSync?.remoteDeleted(id);
          return;
        }
        const row = payload.new as BoardRow;
        if (!row?.id || (row.user_id !== userId && !state.boards.some((board) => board.id === row.id))) return;
        try { boardSync?.observe(rowToSnapshot(row)); }
        catch { boardSync?.failed(row.id, 'Incoming board data could not be read safely. Your draft is kept.'); }
      })
    .subscribe();
}

function scheduleBoardSync(boardId: string) {
  if (useBoardStore.getState().currentUserId) boardSync?.schedule(boardId);
}

function persistCreation(id: string): Promise<boolean> {
  const pending = creatingBoards.get(id);
  if (!pending) return Promise.resolve(false);
  if (pending.job) return pending.job;
  const epoch = sessionEpoch;
  const coordinator = boardSync;
  const snapshot = pending.snapshot;
  const run = async () => {
    try {
      // A lost response may hide a successful insert. Read first on retry and
      // never upsert an initial snapshot over a board that already exists.
      const existing = await supabase.from('boards').select('*').eq('id', id).maybeSingle();
      if (epoch !== sessionEpoch) return false;
      if (existing.error) throw existing.error;
      let row = existing.data;
      if (!row) {
        const result = await supabase.from('boards').insert({
          id, user_id: snapshot.board.userId!, name: snapshot.document.name,
          description: snapshot.document.description, data: snapshot.document.data as Json,
        }).select('*').single();
        if (epoch !== sessionEpoch) return false;
        if (result.error) throw result.error;
        row = result.data;
      }
      if (!row) throw new Error('The new board could not be saved');
      coordinator?.created(rowToSnapshot(row));
      creatingBoards.delete(id);
      return true;
    } catch (error) {
      if (epoch === sessionEpoch) coordinator?.failed(id, error instanceof Error ? error.message : 'Unable to create board. Your draft is kept; retry saving.');
      return false;
    }
  };
  pending.job = run().finally(() => { pending.job = undefined; });
  return pending.job;
}

function registerNewBoard(board: Board) {
  const snapshot = { board: structuredClone(board), document: structuredClone(boardToDocument(board)), revision: board.updatedAt };
  boardSync?.register(snapshot, true);
  creatingBoards.set(board.id, { snapshot });
  return persistCreation(board.id);
}

function updateBoardSetting(id: string, field: keyof BoardSettings, value: boolean) {
  const state = useBoardStore.getState();
  const userId = state.currentUserId;
  const board = state.boards.find((candidate) => candidate.id === id);
  if (!board || (userId && board.userId !== userId)) return;
  useBoardStore.setState({ boards: state.boards.map((candidate) => candidate.id === id ? { ...candidate, [field]: value } : candidate) });
  if (!userId) return;
  const epoch = sessionEpoch;
  const coordinator = boardSync;
  const pending = { ...pendingSettings.get(id), [field]: value };
  pendingSettings.set(id, pending);
  const previous = settingJobs.get(id);
  const creation = creatingBoards.get(id)?.job;
  const run = async () => {
    await previous;
    const created = await creation;
    if (epoch !== sessionEpoch || !useBoardStore.getState().boards.some((board) => board.id === id)) return;
    try {
      if (created === false) throw new Error('Save the board before updating its sharing settings');
      const updates = field === 'isPublic' ? { is_public: value } : { embed_enabled: value };
      const result = await supabase.from('boards').update(updates).eq('id', id).eq('user_id', userId).select('*').maybeSingle();
      if (epoch !== sessionEpoch) return;
      if (result.error) throw result.error;
      if (!result.data) throw new Error('Sharing settings could not be saved');
      if (pendingSettings.get(id) === pending) pendingSettings.delete(id);
      coordinator?.observe(rowToSnapshot(result.data));
    } catch {
      if (epoch !== sessionEpoch) return;
      if (pendingSettings.get(id) === pending) {
        pendingSettings.delete(id);
        void useBoardStore.getState().refreshFromRemote();
      }
      toast.error('Failed to update sharing settings');
    }
  };
  const job = run().finally(() => { if (settingJobs.get(id) === job) settingJobs.delete(id); });
  settingJobs.set(id, job);
}

export const useBoardStore = create<BoardStore>()((set, get) => ({
  boards: [],
  activeBoardId: null,
  viewMode: 'board',
  currentUserId: null,
  remoteStatus: 'idle',
  remoteError: null,
  boardSyncStates: {},
  cardEditorSession: null,

  setCurrentUserId: (userId) => {
    if (get().currentUserId === userId) return;
    sessionEpoch++;
    refreshSequence++;
    boardSync?.dispose();
    boardSync = null;
    rawBoardData.clear();
    creatingBoards.clear();
    pendingSettings.clear();
    settingJobs.clear();
    if (boardsChannel) { void supabase.removeChannel(boardsChannel); boardsChannel = null; }
    useUndoStore.getState().clearHistory();
    set({ currentUserId: userId, boards: [], activeBoardId: null, boardSyncStates: {}, cardEditorSession: null, remoteStatus: 'idle', remoteError: null });
    if (userId) {
      boardSync = createSyncCoordinator(sessionEpoch);
      ensureBoardsSubscription(userId, sessionEpoch);
      void get().refreshFromRemote();
    }
  },

  refreshFromRemote: async () => {
    const userId = get().currentUserId;
    if (!userId) return;
    const epoch = sessionEpoch;
    const sequence = ++refreshSequence;
    const coordinator = boardSync;
    const priorIds = get().boards.filter((board) => !coordinator?.isCreating(board.id)).map((board) => board.id);
    const current = () => epoch === sessionEpoch && sequence === refreshSequence;
    set({ remoteStatus: 'loading', remoteError: null });
    try {
      const [own, members] = await Promise.all([
        supabase.from('boards').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
        supabase.from('board_members').select('board_id').eq('user_id', userId),
      ]);
      if (!current()) return;
      if (own.error) throw own.error;
      if (members.error) throw members.error;
      let shared: BoardRow[] = [];
      if (members.data?.length) {
        const result = await supabase.from('boards').select('*').in('id', members.data.map((member) => member.board_id)).order('created_at', { ascending: true });
        if (!current()) return;
        if (result.error) throw result.error;
        shared = result.data ?? [];
      }
      const snapshots = [...(own.data ?? []), ...shared].map(rowToSnapshot);
      const ids = new Set(snapshots.map((snapshot) => snapshot.board.id));
      for (const snapshot of snapshots) coordinator?.observe(snapshot);
      for (const id of priorIds) if (!ids.has(id)) coordinator?.remoteDeleted(id);
      set({ remoteStatus: 'ready', remoteError: null });
    } catch (error) {
      if (current()) {
        set({ remoteStatus: 'error', remoteError: error instanceof Error ? error.message : 'Unable to load boards' });
        toast.error('Failed to load boards. Your open drafts are kept.');
      }
    }
  },

  createBoard: (name, description, columns) => {
    const userId = get().currentUserId;
    const now = new Date().toISOString();
    const board: Board = {
      id: uuidv4(), name, description, columns: columns ?? createDefaultColumns(),
      createdAt: now, updatedAt: now, userId: userId ?? undefined,
    };
    set((state) => ({ boards: [...state.boards, board], activeBoardId: board.id }));
    if (userId) void registerNewBoard(board);
    toast.success('Board created');
    return board.id;
  },

  deleteBoard: (boardId) => {
    const userId = get().currentUserId;
    const board = get().boards.find((candidate) => candidate.id === boardId);
    if (!board) return;
    if (userId && board.userId !== userId) { toast.error('Only the board owner can delete it'); return; }
    const epoch = sessionEpoch;
    const coordinator = boardSync;
    const data = boardToDocument(board).data;
    if (get().cardEditorSession?.boardId === boardId) set({ cardEditorSession: null });
    const pendingWrite = coordinator?.forget(boardId);
    const creation = creatingBoards.get(boardId)?.job;
    const settings = settingJobs.get(boardId);
    removeLocalBoard(boardId);
    if (!userId) { toast.success('Board deleted'); return; }
    void (async () => {
      try {
        // Finish any dispatched insert/write before deleting, so it cannot
        // complete later and restore a board the user has already removed.
        await creation;
        await pendingWrite;
        await settings;
        if (epoch !== sessionEpoch) return;
        const result = await supabase.from('boards').delete().eq('id', boardId).eq('user_id', userId).select('id').maybeSingle();
        if (epoch !== sessionEpoch) return;
        if (result.error) throw result.error;
        if (!result.data) {
          const existing = await supabase.from('boards').select('id').eq('id', boardId).maybeSingle();
          if (epoch !== sessionEpoch) return;
          if (existing.error) throw existing.error;
          if (existing.data) throw new Error('The board could not be deleted');
        }
        creatingBoards.delete(boardId);
        toast.success('Board deleted');
      } catch {
        if (epoch !== sessionEpoch) return;
        rawBoardData.set(boardId, data);
        set((state) => ({ boards: [...state.boards, board], activeBoardId: state.activeBoardId ?? boardId }));
        coordinator?.resume(boardId);
        coordinator?.failed(boardId, 'The board could not be deleted. Your draft is restored.');
        toast.error('Failed to delete board');
      }
    })();
  },

  openCardEditor: (boardId, cardId) => {
    const board = get().boards.find((candidate) => candidate.id === boardId);
    const card = board?.columns.flatMap((column) => column.cards).find((candidate) => candidate.id === cardId);
    if (board && card) set({ cardEditorSession: structuredClone({ boardId, cardId, board, card, document: boardToDocument(board), baseline: boardSync?.getBaseline(boardId) }) });
  },
  closeCardEditor: () => { set({ cardEditorSession: null }); },
  saveCardEditor: (data, initialForm) => {
    const session = get().cardEditorSession;
    if (!session) return;
    // Submit only changes to the displayed form. Legacy body/cover migration
    // and empty optional fields must not masquerade as deliberate user edits.
    const updates = Object.fromEntries(Object.entries(data).filter(([key, value]) =>
      !initialForm || JSON.stringify(value) !== JSON.stringify(initialForm[key as keyof CardEditorSaveData]))) as Partial<Card>;
    if (!Object.keys(updates).length) { set({ cardEditorSession: null }); return; }
    const draft = structuredClone(session.document);
    draft.data.columns = (draft.data.columns as Column[]).map((column) => ({ ...column, cards: column.cards.map((card) =>
      card.id === session.cardId ? { ...card, ...updates, updatedAt: new Date().toISOString() } : card) }));
    const epoch = sessionEpoch;
    const previousCard = get().boards.find((board) => board.id === session.boardId)?.columns.flatMap((column) => column.cards).find((card) => card.id === session.cardId);
    const recordUndo = () => {
      if (!previousCard || ['conflict', 'deleted', 'error'].includes(get().boardSyncStates[session.boardId]?.status ?? '')) return;
      const previous = Object.fromEntries(Object.keys(updates).map((key) => [key, structuredClone(previousCard[key as keyof Card])])) as Partial<Card>;
      useUndoStore.getState().pushAction({
        description: `Edit card '${previousCard.title}'`,
        undo: () => get().editCard(session.boardId, '', session.cardId, previous),
        redo: () => get().editCard(session.boardId, '', session.cardId, updates),
      });
    };
    if (get().currentUserId && boardSync) {
      void boardSync.stage(session.boardId, session.document, draft, session.baseline).then(() => {
        if (epoch !== sessionEpoch) return;
        if (get().boards.some((board) => board.id === session.boardId)) set({ activeBoardId: session.boardId });
        if (get().cardEditorSession === session) set({ cardEditorSession: null });
        recordUndo();
      }).catch(() => {
        if (epoch === sessionEpoch) toast.error('Unable to reconcile this card. Your open draft is kept.');
      });
    } else {
      const current = get().boards.find((board) => board.id === session.boardId);
      if (!current) return;
      const merged = mergeBoardDocuments(session.document, draft, boardToDocument(current));
      set((state) => ({ boards: state.boards.map((board) => board.id === session.boardId ? documentToBoard(board, merged.document) : board), cardEditorSession: null }));
      recordUndo();
    }
  },

  retryBoardSync: (id) => {
    if (creatingBoards.has(id)) void persistCreation(id);
    else void boardSync?.flush(id);
  },
  resolveBoardConflict: (id, choice) => { boardSync?.resolve(id, choice); },
  discardBoardDraft: (id) => { boardSync?.forget(id); creatingBoards.delete(id); removeLocalBoard(id); },
  saveBoardDraftAsCopy: (id) => {
    const original = get().boards.find((board) => board.id === id);
    const userId = get().currentUserId;
    if (!original || !userId) return;
    const epoch = sessionEpoch;
    const now = new Date().toISOString();
    const copy = { ...structuredClone(original), id: uuidv4(), name: `${original.name} (recovered)`, userId, isPublic: false, embedEnabled: false, createdAt: now, updatedAt: now };
    rawBoardData.set(copy.id, structuredClone(boardToDocument(original).data));
    set((state) => ({ boards: [...state.boards, copy], activeBoardId: copy.id }));
    void registerNewBoard(copy).then((saved) => {
      if (saved && epoch === sessionEpoch) get().discardBoardDraft(id);
    });
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

  setBoardHiddenColumns: (boardId, hiddenColumnIds) => {
    set((state) => ({
      boards: state.boards.map((b) =>
        b.id === boardId ? { ...b, hiddenColumnIds, updatedAt: new Date().toISOString() } : b
      ),
    }));
    scheduleBoardSync(boardId);
  },

  setActiveBoard: (boardId) => {
    set({ activeBoardId: boardId });
    useUndoStore.getState().clearHistory();
  },

  syncBoard: (boardId) => {
    scheduleBoardSync(boardId);
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
      redo: () => {
        useBoardStore.setState((state) => ({ boards: state.boards.map((board) =>
          board.id === boardId && !board.columns.some((column) => column.id === newId)
            ? { ...board, columns: [...board.columns, { id: newId, title, cards: [], order: board.columns.length }] }
            : board) }));
        scheduleBoardSync(boardId);
      },
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
              if (b.id !== boardId || b.columns.some((candidate) => candidate.id === columnId)) return b;
              const existingCardIds = new Set(b.columns.flatMap((candidate) => candidate.cards.map((card) => card.id)));
              const restoredColumn = { ...columnClone, cards: columnClone.cards.filter((card) => !existingCardIds.has(card.id)) };
              const cols = [...b.columns];
              cols.splice(Math.min(columnIndex, cols.length), 0, restoredColumn);
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
          columns: [...new Set([...columnIds, ...b.columns.map((column) => column.id)])]
            .filter((id) => columnMap.has(id)).map((id, index) => ({ ...columnMap.get(id)!, order: index })),
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
                    c.id === columnId && !b.columns.some((column) => column.cards.some((card) => card.id === newCard.id)) ? { ...c, cards: [...c.cards, newCard] } : c
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
    const column = board?.columns.find((c) => c.cards.some((card) => card.id === cardId));
    columnId = column?.id ?? columnId;
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
                      if (c.id !== columnId || b.columns.some((candidate) => candidate.cards.some((card) => card.id === cardId))) return c;
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
    const column = board?.columns.find((c) => c.cards.some((card) => card.id === cardId));
    columnId = column?.id ?? columnId;
    const card = column?.cards.find((c) => c.id === cardId);
    const prevState = card ? structuredClone(card) : null;
    const previousUpdates = card ? Object.fromEntries(Object.keys(updates).map((key) => [key, structuredClone(card[key as keyof Card])])) as Partial<Card> : {};

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
          useBoardStore.getState().editCard(boardId, columnId, cardId, previousUpdates);
        },
        redo: () => {
          useBoardStore.getState().editCard(boardId, columnId, cardId, updates);
        },
      });
    }
  },

  moveCard: (boardId, _sourceColumnId, targetColumnId, cardId, targetIndex) => {
    set((state) => {
      const board = state.boards.find((candidate) => candidate.id === boardId);
      const source = board?.columns.find((column) => column.cards.some((card) => card.id === cardId));
      const card = source?.cards.find((candidate) => candidate.id === cardId);
      if (!board || !source || !card || !board.columns.some((column) => column.id === targetColumnId)) return state;
      return { boards: state.boards.map((candidate) => candidate.id !== boardId ? candidate : {
        ...candidate,
        columns: candidate.columns.map((column) => {
          const cards = column.cards.filter((candidate) => candidate.id !== cardId);
          if (column.id === targetColumnId) cards.splice(targetIndex ?? cards.length, 0, card);
          return column.id === source.id || column.id === targetColumnId ? { ...column, cards } : column;
        }),
        updatedAt: new Date().toISOString(),
      }) };
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
            c.id === columnId ? { ...c, cards: [...new Set([...cardIds, ...c.cards.map((card) => card.id)])].filter((id) => cardMap.has(id)).map((id) => cardMap.get(id)!) } : c
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
    const column = board?.columns.find((c) => c.cards.some((card) => card.id === cardId));
    columnId = column?.id ?? columnId;
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
    const column = board?.columns.find((c) => c.cards.some((card) => card.id === cardId));
    columnId = column?.id ?? columnId;
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

  toggleBoardPublic: (boardId, isPublic) => { updateBoardSetting(boardId, 'isPublic', isPublic); },

  toggleBoardEmbed: (boardId, enabled) => { updateBoardSetting(boardId, 'embedEnabled', enabled); },

  getActiveBoard: () => {
    const { boards, activeBoardId } = get();
    return boards.find((b) => b.id === activeBoardId) || null;
  },

  getBoards: () => get().boards,

  getBoardsForUser: () => {
    return get().boards;
  },
}));

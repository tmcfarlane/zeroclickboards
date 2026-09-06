import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardRow } from '@/types/database';
import type { Card, Column } from '@/types';
import { useBoardStore } from '../useBoardStore';
import { useUndoStore } from '../useUndoStore';

type Request = {
  table: string;
  action: 'select' | 'insert' | 'update' | 'delete';
  values?: Record<string, unknown>;
  filters: Record<string, unknown>;
  single: boolean;
};
type Response = { data: unknown; error: { message: string } | null };
type Change = { eventType: string; new: unknown; old: unknown };

const transport = vi.hoisted(() => ({
  execute: vi.fn<(request: Request) => Promise<Response>>(),
  callbacks: [] as Array<(payload: Change) => void>,
  removeChannel: vi.fn(),
}));

vi.mock('@/lib/supabase', () => {
  function query(table: string) {
    const request: Request = { table, action: 'select', filters: {}, single: false };
    const chain = {
      select: () => chain,
      eq: (key: string, value: unknown) => { request.filters[key] = value; return chain; },
      in: (key: string, values: unknown[]) => { request.filters[key] = values; return chain; },
      order: () => chain,
      maybeSingle: () => { request.single = true; return chain; },
      single: () => { request.single = true; return chain; },
      insert: (values: Record<string, unknown>) => { request.action = 'insert'; request.values = values; return chain; },
      update: (values: Record<string, unknown>) => { request.action = 'update'; request.values = values; return chain; },
      delete: () => { request.action = 'delete'; return chain; },
      then: (resolve: (value: Response) => unknown, reject?: (error: unknown) => unknown) =>
        transport.execute(structuredClone(request)).then(resolve, reject),
    };
    return chain;
  }
  return { supabase: {
    from: query,
    channel: () => {
      const channel = {
        on: (_kind: string, _filter: unknown, callback: (payload: Change) => void) => {
          transport.callbacks.push(callback);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: transport.removeChannel,
  } };
});

const USER = 'user-1';
const OTHER_USER = 'user-2';
const FIRST_REVISION = '2026-09-06T12:00:00.123001+00:00';
const SECOND_REVISION = '2026-09-06T12:00:00.123002+00:00';
let rows: Map<string, BoardRow>;
let memberships: Array<{ user_id: string; board_id: string }>;
let serial: number;

function card(id = 'card-1', title = 'Original card'): Card {
  return { id, title, content: { type: 'text', text: '' }, createdAt: FIRST_REVISION, updatedAt: FIRST_REVISION };
}

function row(id = 'board-1', userId = USER): BoardRow {
  return {
    id, user_id: userId, name: 'Original board', description: null,
    data: { columns: [{ id: 'column-1', title: 'To Do', order: 0, cards: [card()] }] },
    created_at: FIRST_REVISION, updated_at: FIRST_REVISION, is_public: false, embed_enabled: false,
  } as unknown as BoardRow;
}

function columns(value: BoardRow): Column[] {
  return (value.data as unknown as { columns: Column[] }).columns;
}

function result(data: unknown): Response { return { data: structuredClone(data), error: null }; }

function execute(request: Request): Response {
  if (request.table === 'board_members') {
    return result(memberships.filter((membership) => membership.user_id === request.filters.user_id)
      .map(({ board_id }) => ({ board_id })));
  }
  if (request.table !== 'boards') throw new Error(`Unexpected table ${request.table}`);
  const matches = [...rows.values()].filter((value) => Object.entries(request.filters).every(([key, expected]) => {
    const actual = value[key as keyof BoardRow];
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  }));
  if (request.action === 'select') return result(request.single ? matches[0] ?? null : matches);
  if (request.action === 'insert') {
    const value = {
      created_at: FIRST_REVISION, updated_at: FIRST_REVISION, is_public: false, embed_enabled: false,
      ...structuredClone(request.values),
    } as BoardRow;
    if (rows.has(value.id)) return { data: null, error: { message: 'duplicate key' } };
    rows.set(value.id, value);
    return result(value);
  }
  if (request.action === 'update') {
    const previous = matches[0];
    if (!previous) return result(null);
    const updated = {
      ...previous, ...structuredClone(request.values),
      updated_at: `2026-09-06T12:00:00.123${String(serial++).padStart(3, '0')}+00:00`,
    } as BoardRow;
    rows.set(updated.id, updated);
    return result(updated);
  }
  for (const value of matches) rows.delete(value.id);
  return result(matches[0] ? { id: matches[0].id } : null);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function settle() { await vi.advanceTimersByTimeAsync(0); }
async function signIn(userId = USER) {
  useBoardStore.getState().setCurrentUserId(userId);
  await settle();
  expect(useBoardStore.getState().remoteStatus).toBe('ready');
}
function updateRequests() {
  return transport.execute.mock.calls.map(([request]) => request).filter((request) => request.action === 'update');
}
function emit(value: BoardRow, eventType = 'UPDATE') {
  transport.callbacks.at(-1)!({ eventType, new: value, old: {} });
}

describe('signed-in board sync integration', () => {
  beforeEach(() => {
    useBoardStore.getState().setCurrentUserId(null);
    useBoardStore.setState({ boards: [], activeBoardId: null, boardSyncStates: {}, remoteStatus: 'idle', remoteError: null });
    useUndoStore.getState().clearHistory();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
    rows = new Map();
    memberships = [];
    serial = 10;
    transport.execute.mockReset();
    transport.execute.mockImplementation(async (request) => execute(request));
    transport.callbacks.length = 0;
    transport.removeChannel.mockClear();
  });
  afterEach(() => {
    useBoardStore.getState().setCurrentUserId(null);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('guards browser writes by remote revision and retains opaque data plus concurrent MCP cards', async () => {
    const original = row();
    original.data = { ...original.data as object, futureSetting: { mode: 'enabled' } };
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().editCard(original.id, 'column-1', 'card-1', { title: 'Browser title' });
    const remote = structuredClone(original);
    columns(remote)[0].cards.push(card('mcp-card', 'MCP addition'));
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toHaveLength(1);
    expect(updateRequests()[0].filters).toMatchObject({ id: original.id, updated_at: SECOND_REVISION });
    expect(columns(rows.get(original.id)!)[0].cards.map((value) => value.title)).toEqual(['Browser title', 'MCP addition']);
    expect(rows.get(original.id)?.data).toMatchObject({ futureSetting: { mode: 'enabled' } });
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it('loads shared boards and receives updates from their different owner', async () => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id });
    await signIn();
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual([shared.id]);
    const updated = { ...shared, name: 'Owner changed this', updated_at: SECOND_REVISION };
    rows.set(shared.id, updated);
    emit(updated);
    expect(useBoardStore.getState().boards[0].name).toBe('Owner changed this');
    useBoardStore.getState().renameBoard(shared.id, 'Editor changed this');
    await vi.advanceTimersByTimeAsync(400);
    expect(rows.get(shared.id)?.name).toBe('Editor changed this');
    expect(updateRequests()[0].filters).not.toHaveProperty('user_id');
  });

  it.each(['board_members', 'shared boards'] as const)('keeps loaded shared drafts if refreshing %s fails', async (failure) => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id });
    await signIn();
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved shared draft');
    transport.execute.mockImplementation(async (request) => {
      const failing = failure === 'board_members' ? request.table === 'board_members' : Array.isArray(request.filters.id);
      return failing ? { data: null, error: { message: 'Shared lookup failed' } } : execute(request);
    });
    await useBoardStore.getState().refreshFromRemote();
    expect(useBoardStore.getState().remoteStatus).toBe('error');
    expect(useBoardStore.getState().boards).toHaveLength(1);
    expect(useBoardStore.getState().boards[0].name).toBe('Unsaved shared draft');
    expect(useBoardStore.getState().boardSyncStates[shared.id].status).toBe('pending');
  });

  it('does not invent unsaved edits when an unchanged board lacks optional data keys and is deleted remotely', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    rows.delete(original.id);
    transport.callbacks.at(-1)!({ eventType: 'DELETE', new: {}, old: { id: original.id } });
    expect(useBoardStore.getState().boards).toEqual([]);
    expect(useBoardStore.getState().boardSyncStates[original.id]).toBeUndefined();
  });

  it('keeps edits made while a board creation request is unfinished', async () => {
    await signIn();
    const pending = deferred<Response>();
    let inserted: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'insert') { inserted = request; return pending.promise; }
      return execute(request);
    });
    const id = useBoardStore.getState().createBoard('Created board');
    await settle();
    expect(inserted).toBeDefined();
    const columnId = useBoardStore.getState().boards[0].columns[0].id;
    useBoardStore.getState().addCard(id, columnId, 'Added before creation finished');
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toHaveLength(0);
    pending.resolve(execute(inserted!));
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(id)!)[0].cards.map((value) => value.title)).toEqual(['Added before creation finished']);
    expect(useBoardStore.getState().boardSyncStates[id].status).toBe('saved');
  });

  it('recovers an ambiguous creation response by reading the inserted board without replacing later remote data', async () => {
    await signIn();
    let failInsertResponse = true;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'insert' && failInsertResponse) {
        failInsertResponse = false;
        execute(request);
        return { data: null, error: { message: 'Response lost' } };
      }
      return execute(request);
    });
    const id = useBoardStore.getState().createBoard('Created board');
    await settle();
    expect(useBoardStore.getState().boardSyncStates[id].status).toBe('error');
    const columnId = useBoardStore.getState().boards[0].columns[0].id;
    useBoardStore.getState().addCard(id, columnId, 'Local draft card');
    const updated = structuredClone(rows.get(id)!);
    columns(updated)[0].cards.push(card('mcp-card', 'Remote card after insert'));
    updated.updated_at = SECOND_REVISION;
    rows.set(id, updated);
    useBoardStore.getState().retryBoardSync(id);
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(transport.execute.mock.calls.filter(([request]) => request.action === 'insert')).toHaveLength(1);
    expect(columns(rows.get(id)!)[0].cards.map((value) => value.title)).toEqual(['Local draft card', 'Remote card after insert']);
    expect(useBoardStore.getState().boardSyncStates[id].status).toBe('saved');
  });

  it('waits for an in-flight creation before deleting its row and ignores the late acknowledgement', async () => {
    await signIn();
    const pending = deferred<Response>();
    let inserted: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'insert') { inserted = request; return pending.promise; }
      return execute(request);
    });
    const id = useBoardStore.getState().createBoard('Created then deleted');
    await settle();
    useBoardStore.getState().deleteBoard(id);
    await settle();
    expect(transport.execute.mock.calls.filter(([request]) => request.action === 'delete')).toHaveLength(0);
    pending.resolve(execute(inserted!));
    await settle();
    expect(transport.execute.mock.calls.filter(([request]) => request.action === 'delete')).toHaveLength(1);
    expect(rows.has(id)).toBe(false);
    expect(useBoardStore.getState().boards).toEqual([]);
  });

  it('restores an editable board if deleting it fails after its in-flight creation succeeds', async () => {
    await signIn();
    const pending = deferred<Response>();
    let inserted: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'insert') { inserted = request; return pending.promise; }
      if (request.action === 'delete') return { data: null, error: { message: 'Delete failed' } };
      return execute(request);
    });
    const id = useBoardStore.getState().createBoard('Restorable board');
    await settle();
    useBoardStore.getState().deleteBoard(id);
    pending.resolve(execute(inserted!));
    await settle();
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual([id]);
    expect(useBoardStore.getState().boardSyncStates[id].status).toBe('error');
    useBoardStore.getState().renameBoard(id, 'Recovered editable board');
    useBoardStore.getState().retryBoardSync(id);
    await settle();
    expect(rows.get(id)?.name).toBe('Recovered editable board');
    expect(useBoardStore.getState().boardSyncStates[id].status).toBe('saved');
  });

  it('waits for a dispatched content write before deleting and never restores the saved response', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    const pending = deferred<Response>();
    let dispatched: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'update') { dispatched = request; return pending.promise; }
      return execute(request);
    });
    useBoardStore.getState().renameBoard(original.id, 'Saving then deleting');
    await vi.advanceTimersByTimeAsync(400);
    useBoardStore.getState().deleteBoard(original.id);
    await settle();
    expect(transport.execute.mock.calls.filter(([request]) => request.action === 'delete')).toHaveLength(0);
    pending.resolve(execute(dispatched!));
    await settle();
    expect(rows.has(original.id)).toBe(false);
    expect(useBoardStore.getState().boards).toEqual([]);
    expect(useBoardStore.getState().boardSyncStates).toEqual({});
  });

  it('keeps pending sharing choices visible during content updates and serializes rapid setting writes', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    const pending = deferred<Response>();
    let dispatched: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'update' && request.values?.is_public === true) { dispatched = request; return pending.promise; }
      return execute(request);
    });
    useBoardStore.getState().toggleBoardPublic(original.id, true);
    await settle();
    useBoardStore.getState().toggleBoardEmbed(original.id, true);
    useBoardStore.getState().toggleBoardPublic(original.id, false);
    const remote = { ...original, name: 'MCP title while setting saves', updated_at: SECOND_REVISION };
    rows.set(remote.id, remote);
    emit(remote);
    await settle();
    expect(updateRequests()).toHaveLength(1);
    expect(useBoardStore.getState().boards[0]).toMatchObject({ name: remote.name, isPublic: false, embedEnabled: true });
    pending.resolve(execute(dispatched!));
    await settle();
    expect(updateRequests().map((request) => request.values)).toEqual([
      { is_public: true }, { embed_enabled: true }, { is_public: false },
    ]);
    expect(rows.get(original.id)).toMatchObject({ name: remote.name, is_public: false, embed_enabled: true });
    expect(useBoardStore.getState().boards[0]).toMatchObject({ isPublic: false, embedEnabled: true });
  });

  it('waits for creation before dispatching a sharing update', async () => {
    await signIn();
    const pending = deferred<Response>();
    let inserted: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'insert') { inserted = request; return pending.promise; }
      return execute(request);
    });
    const id = useBoardStore.getState().createBoard('Public new board');
    await settle();
    useBoardStore.getState().toggleBoardPublic(id, true);
    await settle();
    expect(updateRequests()).toHaveLength(0);
    pending.resolve(execute(inserted!));
    await settle();
    expect(rows.get(id)?.is_public).toBe(true);
    expect(useBoardStore.getState().boards[0].isPublic).toBe(true);
  });

  it('waits for a sharing write before deleting its board', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    const pending = deferred<Response>();
    let dispatched: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'update') { dispatched = request; return pending.promise; }
      return execute(request);
    });
    useBoardStore.getState().toggleBoardPublic(original.id, true);
    await settle();
    useBoardStore.getState().deleteBoard(original.id);
    await settle();
    expect(transport.execute.mock.calls.filter(([request]) => request.action === 'delete')).toHaveLength(0);
    pending.resolve(execute(dispatched!));
    await settle();
    expect(rows.has(original.id)).toBe(false);
    expect(useBoardStore.getState().boards).toEqual([]);
  });

  it('ignores an old account refresh and subscription after switching accounts', async () => {
    const oldBoard = row();
    const newBoard = row('new-account-board', OTHER_USER);
    rows.set(oldBoard.id, oldBoard);
    rows.set(newBoard.id, newBoard);
    const pending = deferred<Response>();
    transport.execute.mockImplementation(async (request) =>
      request.table === 'boards' && request.filters.user_id === USER ? pending.promise : execute(request));
    useBoardStore.getState().setCurrentUserId(USER);
    await settle();
    const oldCallback = transport.callbacks[0];
    await signIn(OTHER_USER);
    pending.resolve(result([oldBoard]));
    oldCallback({ eventType: 'UPDATE', new: { ...oldBoard, name: 'Stale event' }, old: {} });
    await settle();
    expect(useBoardStore.getState().currentUserId).toBe(OTHER_USER);
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual([newBoard.id]);
    expect(useBoardStore.getState().remoteStatus).toBe('ready');
  });

  it('cancels a queued save on logout and clears undo history', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().editCard(original.id, 'column-1', 'card-1', { title: 'Account draft' });
    expect(useUndoStore.getState().canUndo()).toBe(true);
    useBoardStore.getState().setCurrentUserId(null);
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toHaveLength(0);
    expect(useBoardStore.getState().boards).toEqual([]);
    expect(useUndoStore.getState().canUndo()).toBe(false);
  });

  it('ignores an in-flight save response after logout', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    const pending = deferred<Response>();
    let dispatched: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'update') { dispatched = request; return pending.promise; }
      return execute(request);
    });
    useBoardStore.getState().renameBoard(original.id, 'Old account save');
    await vi.advanceTimersByTimeAsync(400);
    expect(dispatched).toBeDefined();
    useBoardStore.getState().setCurrentUserId(null);
    pending.resolve(execute(dispatched!));
    await settle();
    expect(useBoardStore.getState().boards).toEqual([]);
    expect(useBoardStore.getState().boardSyncStates).toEqual({});
    expect(useBoardStore.getState().remoteStatus).toBe('idle');
  });

  it('ignores a creation response after logout and does not dispatch queued edits', async () => {
    await signIn();
    const pending = deferred<Response>();
    let dispatched: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'insert') { dispatched = request; return pending.promise; }
      return execute(request);
    });
    const id = useBoardStore.getState().createBoard('Old account board');
    await settle();
    useBoardStore.getState().renameBoard(id, 'Queued name');
    useBoardStore.getState().setCurrentUserId(null);
    pending.resolve(execute(dispatched!));
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().boards).toEqual([]);
    expect(useBoardStore.getState().boardSyncStates).toEqual({});
    expect(updateRequests()).toHaveLength(0);
  });

  it('does not restart subscriptions or erase a draft when the same user is set again', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().renameBoard(original.id, 'Kept draft');
    const reads = transport.execute.mock.calls.length;
    useBoardStore.getState().setCurrentUserId(USER);
    expect(transport.callbacks).toHaveLength(1);
    expect(transport.execute).toHaveBeenCalledTimes(reads);
    expect(useBoardStore.getState().boards[0].name).toBe('Kept draft');
    await vi.advanceTimersByTimeAsync(400);
    expect(rows.get(original.id)?.name).toBe('Kept draft');
  });
  it('submits only form changes while preserving MCP body, labels, and moved card identity', async () => {
    const original = row();
    columns(original)[0].cards[0].content.text = 'Original MCP body';
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const session = useBoardStore.getState().cardEditorSession!;
    const remote = structuredClone(original);
    const moved = columns(remote)[0].cards.pop()!;
    moved.content.text = 'Updated MCP body';
    moved.labels = ['blue'];
    columns(remote).push({ id: 'destination', title: 'Moved', order: 1, cards: [moved] });
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    expect(useBoardStore.getState().cardEditorSession).toBe(session);
    expect(session.card.content.text).toBe('Original MCP body');
    const initialForm = { title: 'Original card', description: 'Original MCP body', content: { type: 'text' as const, text: 'Original MCP body' }, labels: [] };
    useBoardStore.getState().saveCardEditor({ ...initialForm, title: 'Edited title' }, initialForm);
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[0].cards).toEqual([]);
    expect(columns(rows.get(original.id)!)[1].cards[0]).toMatchObject({ title: 'Edited title', content: { text: 'Updated MCP body' }, labels: ['blue'] });
    expect(columns(rows.get(original.id)!)[1].cards[0].description).toBeUndefined();
    expect(useBoardStore.getState().cardEditorSession).toBeNull();
    useUndoStore.getState().undo();
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[1].cards[0]).toMatchObject({ title: 'Original card', content: { text: 'Updated MCP body' }, labels: ['blue'] });
  });

  it('requires review if MCP changes a field after the card editor opened', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const remote = structuredClone(original);
    columns(remote)[0].cards[0].title = 'Incoming title';
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    const initialForm = { title: 'Original card', content: { type: 'text' as const, text: '' }, labels: [] };
    useBoardStore.getState().saveCardEditor({ ...initialForm, title: 'My title' }, initialForm);
    await vi.advanceTimersByTimeAsync(800);
    expect(updateRequests()).toHaveLength(0);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('conflict');
    useBoardStore.getState().resolveBoardConflict(original.id, 'remote');
    await settle();
    expect(useBoardStore.getState().boards[0].columns[0].cards[0].title).toBe('Incoming title');
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it.each([false, true])('preserves legacy image conversion and concurrent attachments (explicit removal: %s)', async (removeLegacyImage) => {
    const original = row();
    const imageUrl = 'https://example.com/legacy-body.png';
    columns(original)[0].cards[0].content = { type: 'image', imageUrl };
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const migration = { id: 'legacy-migration', name: 'Image', url: imageUrl, addedAt: FIRST_REVISION, isCover: false };
    const initialForm = {
      title: 'Original card', content: { type: 'text' as const, text: '' }, labels: [], attachments: [migration],
    };
    const remote = structuredClone(original);
    const remoteAttachment = { id: 'remote-image', name: 'Remote addition', url: 'https://example.com/remote.png', addedAt: SECOND_REVISION, isCover: true };
    columns(remote)[0].cards[0].attachments = [remoteAttachment];
    columns(remote)[0].cards[0].coverImage = remoteAttachment.url;
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);

    useBoardStore.getState().saveCardEditor({
      ...initialForm, content: { type: 'text', text: 'New text body' },
      attachments: removeLegacyImage ? undefined : [migration],
    }, initialForm);
    await vi.advanceTimersByTimeAsync(400);
    const saved = columns(rows.get(original.id)!)[0].cards[0];
    expect(saved.content).toEqual({ type: 'text', text: 'New text body' });
    expect(saved.attachments).toContainEqual(remoteAttachment);
    expect(saved.attachments?.some((attachment) => attachment.url === imageUrl)).toBe(!removeLegacyImage);
    expect(saved.coverImage).toBe(remoteAttachment.url);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it.each(['remove image', 'edit title', 'no change'] as const)('handles a legacy image without a body edit: %s', async (action) => {
    const original = row();
    const imageUrl = 'https://example.com/legacy-body.png';
    Object.assign(columns(original)[0].cards[0], {
      description: 'Original summary', content: { type: 'image', imageUrl },
    });
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const migration = { id: 'legacy-migration', name: 'Image', url: imageUrl, addedAt: FIRST_REVISION, isCover: false };
    const initialForm = {
      title: 'Original card', description: 'Original summary',
      content: { type: 'text' as const, text: '' }, labels: [], attachments: [migration],
    };
    const remote = structuredClone(original);
    const remoteAttachment = { id: 'remote-image', name: 'Remote addition', url: 'https://example.com/remote.png', addedAt: SECOND_REVISION, isCover: true };
    Object.assign(columns(remote)[0].cards[0], {
      description: 'Remote summary', attachments: [remoteAttachment], coverImage: remoteAttachment.url,
    });
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);

    useBoardStore.getState().saveCardEditor({
      ...initialForm,
      title: action === 'edit title' ? 'Edited title' : initialForm.title,
      attachments: action === 'remove image' ? undefined : initialForm.attachments,
    }, initialForm);
    await vi.advanceTimersByTimeAsync(400);

    const saved = columns(rows.get(original.id)!)[0].cards[0];
    expect(saved.content).toEqual(action === 'remove image' ? { type: 'text', text: '' } : { type: 'image', imageUrl });
    expect(saved.title).toBe(action === 'edit title' ? 'Edited title' : 'Original card');
    expect(saved.description).toBe('Remote summary');
    expect(saved.attachments).toEqual([remoteAttachment]);
    expect(saved.coverImage).toBe(remoteAttachment.url);
    expect(updateRequests()).toHaveLength(action === 'no change' ? 0 : 1);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it('recovers a submitted editor draft after remote board deletion as a new private board', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    rows.delete(original.id);
    transport.callbacks.at(-1)!({ eventType: 'DELETE', new: {}, old: { id: original.id } });
    expect(useBoardStore.getState().boards).toEqual([]);
    const initialForm = { title: 'Original card', content: { type: 'text' as const, text: '' }, labels: [] };
    useBoardStore.getState().saveCardEditor({ ...initialForm, title: 'Recovered edit' }, initialForm);
    await settle();
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('deleted');
    expect(updateRequests()).toHaveLength(0);
    useBoardStore.getState().saveBoardDraftAsCopy(original.id);
    await settle();
    expect(rows.has(original.id)).toBe(false);
    expect(rows.size).toBe(1);
    const copy = [...rows.values()][0];
    expect(copy.id).not.toBe(original.id);
    expect(copy.is_public).toBe(false);
    expect(columns(copy)[0].cards[0].title).toBe('Recovered edit');
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual([copy.id]);
  });

  it('retains the deleted draft if saving its recovery copy fails', async () => {
    const original = row();
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().renameBoard(original.id, 'Unsaved draft');
    rows.delete(original.id);
    transport.callbacks.at(-1)!({ eventType: 'DELETE', new: {}, old: { id: original.id } });
    transport.execute.mockImplementation(async (request) => request.action === 'insert' ? { data: null, error: { message: 'Insert failed' } } : execute(request));
    useBoardStore.getState().saveBoardDraftAsCopy(original.id);
    await settle();
    expect(useBoardStore.getState().boards.find((board) => board.id === original.id)?.name).toBe('Unsaved draft');
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('deleted');
    expect(rows.size).toBe(0);
  });

  it.each(['local', 'remote'] as const)('preserves pending edits from before opening an editor when resolving to %s', async (choice) => {
    const original = row();
    columns(original)[0].cards.push(card('remove-me', 'Delete before opening'));
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().renameBoard(original.id, 'Prior unsaved rename');
    useBoardStore.getState().removeCard(original.id, 'column-1', 'remove-me');
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const remote = structuredClone(original);
    columns(remote)[0].cards[0].title = 'Incoming title';
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    const initialForm = { title: 'Original card', content: { type: 'text' as const, text: '' }, labels: [] };
    useBoardStore.getState().saveCardEditor({ ...initialForm, title: 'My title' }, initialForm);
    await settle();
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('conflict');
    useBoardStore.getState().resolveBoardConflict(original.id, choice);
    await settle();
    expect(rows.get(original.id)?.name).toBe('Prior unsaved rename');
    expect(columns(rows.get(original.id)!)[0].cards.map((card) => card.id)).toEqual(['card-1']);
    expect(columns(rows.get(original.id)!)[0].cards[0].title).toBe(choice === 'local' ? 'My title' : 'Incoming title');
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, useEffect } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, useAuthContext, type AuthContextValue } from '@/components/auth/AuthProvider';
import type { BoardRow } from '@/types/database';
import type { Card, Column } from '@/types';
import { useBoardStore } from '../useBoardStore';
import { useUndoStore } from '../useUndoStore';
import { createRecurringCardCopy as createMcpRecurringCardCopy } from '../../../mcp-server/src/recurrence';

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
  authCallback: null as ((event: string, session: Session | null) => void) | null,
  getSession: vi.fn(),
  getUser: vi.fn(),
  signOut: vi.fn(),
  passwordSignIn: vi.fn(),
  signUp: vi.fn(),
  oauthSignIn: vi.fn(),
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
  return {
    authSignInWithPassword: transport.passwordSignIn,
    authSignUp: transport.signUp,
    authSignInWithOAuth: transport.oauthSignIn,
    supabase: {
    auth: {
      getSession: transport.getSession,
      getUser: transport.getUser,
      signOut: transport.signOut,
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        transport.authCallback = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      },
    },
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
let memberships: Array<{ user_id: string; board_id: string; role: string }>;
let serial: number;
let currentAuth: AuthContextValue | null;

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
    const matching = memberships.filter((membership) => membership.user_id === request.filters.user_id &&
      (!request.filters.board_id || membership.board_id === request.filters.board_id));
    return result(request.single ? matching[0] ?? null : matching);
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
    transport.authCallback = null;
    transport.getSession.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    transport.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
    transport.signOut.mockReset().mockResolvedValue({ error: null });
    transport.passwordSignIn.mockReset().mockResolvedValue({ error: null });
    transport.signUp.mockReset().mockResolvedValue({ data: { session: null }, error: null });
    transport.oauthSignIn.mockReset().mockResolvedValue({ error: null });
    currentAuth = null;
  });
  afterEach(() => {
    cleanup();
    useBoardStore.getState().setCurrentUserId(null);
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function authSession(userId: string): Session {
    return { access_token: `fixture-token-${userId}`, user: { id: userId } } as Session;
  }

  async function mountAuthProvider(userId = USER) {
    transport.getSession.mockResolvedValue({ data: { session: authSession(userId) }, error: null });
    function AccountOnly() {
      const auth = useAuthContext();
      useEffect(() => { currentAuth = auth; }, [auth]);
      return createElement('div', null, 'Account page');
    }
    render(createElement(AuthProvider, { children: createElement(AccountOnly) }));
    await act(settle);
  }

  it('auth provider cancels queued writes on account-page logout without an AppShell', async () => {
    rows.set('board-1', row());
    await signIn(); // The board page already initialized this account before navigation.
    await mountAuthProvider();
    expect(useBoardStore.getState().currentUserId).toBe(USER);
    expect(useBoardStore.getState().remoteStatus).toBe('ready');
    useBoardStore.getState().editCard('board-1', 'column-1', 'card-1', { title: 'Queued account draft' });
    expect(useUndoStore.getState().canUndo()).toBe(true);
    act(() => transport.authCallback!('SIGNED_OUT', null));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(updateRequests()).toHaveLength(0);
    expect(useBoardStore.getState().boards).toEqual([]);
    expect(useBoardStore.getState().cardEditorSession).toBeNull();
    expect(useUndoStore.getState().canUndo()).toBe(false);
  });

  it('auth provider preserves a same-account draft through token refresh', async () => {
    rows.set('board-1', row());
    await signIn();
    await mountAuthProvider();
    expect(useBoardStore.getState().currentUserId).toBe(USER);
    useBoardStore.getState().renameBoard('board-1', 'Draft survives refresh');
    act(() => transport.authCallback!('TOKEN_REFRESHED', authSession(USER)));
    expect(useBoardStore.getState().boards[0].name).toBe('Draft survives refresh');
    expect(transport.callbacks).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(rows.get('board-1')?.name).toBe('Draft survives refresh');
    expect(updateRequests()).toHaveLength(1);
  });

  it('auth provider discards old in-flight responses after account replacement outside AppShell', async () => {
    rows.set('board-1', row());
    rows.set('new-account-board', row('new-account-board', OTHER_USER));
    await signIn();
    await mountAuthProvider();
    expect(useBoardStore.getState().currentUserId).toBe(USER);
    const pending = deferred<Response>();
    let dispatched: Request | undefined;
    transport.execute.mockImplementation(async (request) => {
      if (request.action === 'update') { dispatched = request; return pending.promise; }
      return execute(request);
    });
    useBoardStore.getState().renameBoard('board-1', 'Already sent old-account save');
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(dispatched).toBeDefined();
    useBoardStore.getState().renameBoard('board-1', 'Must not dispatch after replacement');
    act(() => transport.authCallback!('SIGNED_IN', authSession(OTHER_USER)));
    pending.resolve(execute(dispatched!));
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(useBoardStore.getState().currentUserId).toBe(OTHER_USER);
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['new-account-board']);
    expect(updateRequests()).toHaveLength(1);
    expect(useUndoStore.getState().canUndo()).toBe(false);
  });

  it('auth provider ignores a late cached session after a newer auth event', async () => {
    rows.set('board-1', row());
    rows.set('new-account-board', row('new-account-board', OTHER_USER));
    const cached = deferred<{ data: { session: Session }; error: null }>();
    transport.getSession.mockReturnValue(cached.promise);
    render(createElement(AuthProvider, { children: null }));
    act(() => transport.authCallback!('SIGNED_IN', authSession(OTHER_USER)));
    cached.resolve({ data: { session: authSession(USER) }, error: null });
    await act(settle);
    expect(useBoardStore.getState().currentUserId).toBe(OTHER_USER);
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['new-account-board']);
    expect(transport.getUser).toHaveBeenCalledOnce(); // Validate the accepted account, never replay the old cache.
  });

  it('auth provider does not sign out a successor account for an old validation failure', async () => {
    rows.set('board-1', row());
    rows.set('new-account-board', row('new-account-board', OTHER_USER));
    const validation = deferred<{ error: { message: string } }>();
    transport.getUser.mockReturnValueOnce(validation.promise).mockResolvedValue({ data: { user: null }, error: null });
    await mountAuthProvider();
    expect(transport.getUser).toHaveBeenCalledOnce();
    act(() => transport.authCallback!('SIGNED_IN', authSession(OTHER_USER)));
    validation.resolve({ error: { message: 'Previous session expired' } });
    await act(settle);
    expect(transport.signOut).not.toHaveBeenCalled();
    expect(useBoardStore.getState().currentUserId).toBe(OTHER_USER);
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['new-account-board']);
  });

  it('auth provider invalidates old validation before a new sign-in has emitted its session', async () => {
    rows.set('board-1', row());
    const validation = deferred<{ error: { message: string } }>();
    const login = deferred<{ error: null }>();
    transport.getUser.mockReturnValueOnce(validation.promise);
    transport.passwordSignIn.mockReturnValue(login.promise);
    await mountAuthProvider();
    let pendingLogin!: Promise<{ error: string | null }>;
    act(() => { pendingLogin = currentAuth!.signInWithEmail('fixture@example.invalid', 'fixture-only-password'); });
    validation.resolve({ error: { message: 'Previous token invalid' } });
    await act(settle);
    expect(transport.signOut).not.toHaveBeenCalled();
    login.resolve({ error: null });
    await act(async () => { expect(await pendingLogin).toEqual({ error: null }); });
  });

  it('auth provider returns retryable errors when public auth locks reject', async () => {
    await mountAuthProvider();
    transport.passwordSignIn.mockRejectedValue(new Error('fixture lock timeout'));
    transport.signUp.mockRejectedValue(new Error('fixture lock timeout'));
    transport.oauthSignIn.mockRejectedValue(new Error('fixture lock timeout'));
    expect(await currentAuth!.signInWithEmail('fixture@example.invalid', 'fixture-only-password')).toEqual({ error: 'Could not sign in. Try again.' });
    expect(await currentAuth!.signUpWithEmail('fixture@example.invalid', 'fixture-only-password')).toEqual({ error: 'Could not sign up. Try again.', needsEmailConfirmation: false });
    expect(await currentAuth!.signInWithGoogle()).toEqual({ error: 'Could not start sign-in. Try again.' });
  });

  it('auth provider validates INITIAL_SESSION when it arrives before the cached read', async () => {
    rows.set('board-1', row());
    const cached = deferred<{ data: { session: Session }; error: null }>();
    transport.getSession.mockReturnValue(cached.promise);
    transport.getUser.mockResolvedValue({ error: { message: 'Cached session was revoked' } });
    render(createElement(AuthProvider, { children: null }));
    act(() => transport.authCallback!('INITIAL_SESSION', authSession(USER)));
    cached.resolve({ data: { session: authSession(USER) }, error: null });
    await act(settle);
    expect(transport.getUser).toHaveBeenCalledOnce();
    expect(transport.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
  });

  it('auth provider keeps same-session INITIAL_SESSION validation and rejects stale initial notifications', async () => {
    rows.set('board-1', row());
    rows.set('new-account-board', row('new-account-board', OTHER_USER));
    const validation = deferred<{ error: { message: string } }>();
    transport.getUser.mockReturnValueOnce(validation.promise).mockResolvedValue({ data: { user: null }, error: null });
    await mountAuthProvider();
    act(() => transport.authCallback!('INITIAL_SESSION', authSession(USER)));
    validation.resolve({ error: { message: 'Cached session was revoked' } });
    await act(settle);
    expect(transport.getUser).toHaveBeenCalledOnce();
    expect(transport.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    act(() => transport.authCallback!('SIGNED_IN', authSession(OTHER_USER)));
    act(() => transport.authCallback!('INITIAL_SESSION', authSession(USER)));
    await act(settle);
    expect(useBoardStore.getState().currentUserId).toBe(OTHER_USER);
    expect(useBoardStore.getState().boards.map((board) => board.id)).toEqual(['new-account-board']);
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
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
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

  it.each(['viewer', 'commenter', 'owner', 'unrecognized'])('fails closed for all mutation entry points on a shared %s board', async (role) => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role });
    await signIn();
    const store = useBoardStore.getState();
    const before = structuredClone(store.boards);
    expect(store.canEditBoard(shared.id)).toBe(false);
    expect(store.canManageBoard(shared.id)).toBe(false);
    store.renameBoard(shared.id, 'Denied');
    store.setBoardBackground(shared.id, 'red');
    store.setBoardHiddenColumns(shared.id, ['column-1']);
    store.addColumn(shared.id, 'Denied');
    store.removeColumn(shared.id, 'column-1');
    store.renameColumn(shared.id, 'column-1', 'Denied');
    store.reorderColumns(shared.id, []);
    expect(store.addCard(shared.id, 'column-1', 'Denied')).toBe('');
    store.removeCard(shared.id, 'column-1', 'card-1');
    store.editCard(shared.id, 'column-1', 'card-1', { title: 'Denied' });
    store.moveCard(shared.id, 'column-1', 'column-1', 'card-1', 0);
    store.reorderCards(shared.id, 'column-1', []);
    store.archiveCard(shared.id, 'column-1', 'card-1');
    store.archiveAllCards(shared.id, 'column-1');
    store.restoreCard(shared.id, 'column-1', 'card-1');
    store.duplicateCard(shared.id, 'column-1', 'card-1');
    store.openCardEditor(shared.id, 'card-1');
    store.syncBoard(shared.id);
    store.retryBoardSync(shared.id);
    store.resolveBoardConflict(shared.id, 'local');
    store.toggleBoardPublic(shared.id, true);
    store.toggleBoardEmbed(shared.id, true);
    store.deleteBoard(shared.id);
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().boards).toEqual(before);
    expect(useBoardStore.getState().cardEditorSession).toBeNull();
    expect(useUndoStore.getState().undoStack).toEqual([]);
    expect(updateRequests()).toEqual([]);
  });

  it('cancels a queued save on role downgrade and reloads only after explicit discard', async () => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved editor draft');
    memberships[0].role = 'viewer';
    await useBoardStore.getState().refreshFromRemote();
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toEqual([]);
    expect(useBoardStore.getState().boardSyncStates[shared.id].status).toBe('readonly');
    expect(useBoardStore.getState().boards[0].name).toBe('Unsaved editor draft');
    expect(useUndoStore.getState().undoStack).toEqual([]);
    useBoardStore.getState().discardBoardDraft(shared.id);
    await settle();
    expect(useBoardStore.getState().boards[0].name).toBe(shared.name);
    expect(useBoardStore.getState().getBoardAccess(shared.id)).toBe('viewer');
    expect(updateRequests()).toEqual([]);
  });

  it.each(['viewer', 'lookup error', 'lookup throws'])('rechecks shared write access immediately before UPDATE (%s)', async (outcome) => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved editor draft');
    if (outcome === 'viewer') memberships[0].role = 'viewer';
    else transport.execute.mockImplementation(async (request) => {
      if (request.table === 'board_members' && request.single) {
        if (outcome === 'lookup throws') throw new Error('Connection lost');
        return { data: null, error: { message: 'Membership lookup unavailable' } };
      }
      return execute(request);
    });
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toEqual([]);
    expect(useBoardStore.getState().getBoardAccess(shared.id)).toBe(outcome === 'viewer' ? 'viewer' : 'unknown');
    expect(useBoardStore.getState().boardSyncStates[shared.id].status).toBe('readonly');
    expect(useBoardStore.getState().boards[0].name).toBe('Unsaved editor draft');
    const requests = transport.execute.mock.calls.length;
    useBoardStore.getState().retryBoardSync(shared.id);
    await settle();
    expect(transport.execute).toHaveBeenCalledTimes(requests);
  });

  it('does not let a stale membership response restore permission after a newer downgrade', async () => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    const pending = deferred<Response>();
    transport.execute.mockImplementation(async (request) => request.table === 'board_members' && request.single ? pending.promise : execute(request));
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved editor draft');
    await vi.advanceTimersByTimeAsync(400);
    memberships[0].role = 'viewer';
    await useBoardStore.getState().refreshFromRemote();
    pending.resolve(result({ ...memberships[0], role: 'editor' }));
    await settle();
    expect(useBoardStore.getState().getBoardAccess(shared.id)).toBe('viewer');
    expect(useBoardStore.getState().boardSyncStates[shared.id].status).toBe('readonly');
    expect(updateRequests()).toEqual([]);
  });

  it('does not let an older full refresh overwrite a fresh permission denial', async () => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    const pending = deferred<Response>();
    const oldMemberships = result(memberships);
    transport.execute.mockImplementation(async (request) => request.table === 'board_members' && !request.single ? pending.promise : execute(request));
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved editor draft');
    const refreshing = useBoardStore.getState().refreshFromRemote();
    await settle();
    memberships[0].role = 'viewer';
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().getBoardAccess(shared.id)).toBe('viewer');
    pending.resolve(oldMemberships);
    await refreshing;
    expect(useBoardStore.getState().getBoardAccess(shared.id)).toBe('viewer');
    expect(updateRequests()).toEqual([]);
  });

  it('recovers a readonly editor draft as an owned private board without altering the original', async () => {
    const shared = row('shared-board', OTHER_USER);
    shared.is_public = true;
    shared.embed_enabled = true;
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved editor draft');
    memberships[0].role = 'viewer';
    await useBoardStore.getState().refreshFromRemote();
    useBoardStore.getState().saveBoardDraftAsCopy(shared.id);
    await settle();
    const copy = useBoardStore.getState().boards.find((board) => board.id !== shared.id)!;
    expect(copy.name).toBe('Unsaved editor draft (recovered)');
    expect(copy.userId).toBe(USER);
    expect(copy.isPublic).toBe(false);
    expect(copy.embedEnabled).toBe(false);
    expect(useBoardStore.getState().canManageBoard(copy.id)).toBe(true);
    expect(useBoardStore.getState().boards.find((board) => board.id === shared.id)?.name).toBe(shared.name);
    expect(rows.get(shared.id)).toEqual(shared);
    expect(updateRequests()).toEqual([]);
  });

  it('does not apply a late save acknowledgement or reschedule after a role downgrade', async () => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    const pending = deferred<Response>();
    transport.execute.mockImplementation(async (request) => request.action === 'update' ? pending.promise : execute(request));
    useBoardStore.getState().renameBoard(shared.id, 'Unsaved editor draft');
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toHaveLength(1);
    memberships[0].role = 'viewer';
    await useBoardStore.getState().refreshFromRemote();
    pending.resolve(result({ ...shared, name: 'Late acknowledgement', updated_at: SECOND_REVISION }));
    await settle();
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toHaveLength(1);
    expect(useBoardStore.getState().boards[0].name).toBe('Unsaved editor draft');
    expect(useBoardStore.getState().boardSyncStates[shared.id].status).toBe('readonly');
  });

  it('preserves an open form when edit access is lost while staging waits for a save', async () => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    const pending = deferred<Response>();
    transport.execute.mockImplementation(async (request) => request.action === 'update' ? pending.promise : execute(request));
    useBoardStore.getState().renameBoard(shared.id, 'Already dispatched draft');
    await vi.advanceTimersByTimeAsync(400);
    useBoardStore.getState().openCardEditor(shared.id, 'card-1');
    const session = useBoardStore.getState().cardEditorSession;
    useBoardStore.getState().saveCardEditor({ title: 'Form draft', content: { type: 'text', text: '' }, labels: [], attachments: [] });
    memberships[0].role = 'commenter';
    await useBoardStore.getState().refreshFromRemote();
    pending.resolve(result({ ...shared, name: 'Already dispatched draft', updated_at: SECOND_REVISION }));
    await settle();
    expect(useBoardStore.getState().cardEditorSession).toBe(session);
    expect(columns(rows.get(shared.id)!)[0].cards[0].title).toBe('Original card');
    expect(useBoardStore.getState().boards[0].columns[0].cards[0].title).toBe('Original card');
    expect(updateRequests()).toHaveLength(1);
    expect(useBoardStore.getState().canRecoverCardDraft(shared.id)).toBe(false);
  });

  it.each(['add column redo', 'remove column undo', 'add card redo', 'remove card undo'] as const)('guards captured %s callbacks after downgrade', async (action) => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
    await signIn();
    const store = useBoardStore.getState();
    if (action === 'add column redo') store.addColumn(shared.id, 'New column');
    if (action === 'remove column undo') store.removeColumn(shared.id, 'column-1');
    if (action === 'add card redo') store.addCard(shared.id, 'column-1', 'New card');
    if (action === 'remove card undo') store.removeCard(shared.id, 'column-1', 'card-1');
    const callback = useUndoStore.getState().undoStack.at(-1)![action.endsWith('redo') ? 'redo' : 'undo'];
    memberships[0].role = 'viewer';
    await store.refreshFromRemote();
    const draft = structuredClone(useBoardStore.getState().boards);
    callback();
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().boards).toEqual(draft);
    expect(updateRequests()).toEqual([]);
  });

  it.each(['board_members', 'shared boards'] as const)('keeps loaded shared drafts if refreshing %s fails', async (failure) => {
    const shared = row('shared-board', OTHER_USER);
    rows.set(shared.id, shared);
    memberships.push({ user_id: USER, board_id: shared.id, role: 'editor' });
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
    expect(useBoardStore.getState().boardSyncStates[shared.id].status).toBe('readonly');
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

  it('merges a checkbox edit with an incoming body addition without introducing normalized empty fields', async () => {
    const original = row();
    const item = { id: 'task-1', text: 'Keep the task', completed: false, source: 'imported' };
    columns(original)[0].cards[0].content = Object.assign({ type: 'checklist' as const, checklist: [item] }, { metadata: { version: 1 } });
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const initialForm = { title: 'Original card', content: { type: 'checklist' as const, text: '', checklist: [item] }, labels: [] };
    const remote = structuredClone(original);
    Object.assign(columns(remote)[0].cards[0].content, { text: 'Body added through MCP', metadata: { version: 2 } });
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    useBoardStore.getState().saveCardEditor({ ...initialForm, content: { ...initialForm.content, checklist: [{ ...item, completed: true }] } }, initialForm);
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[0].cards[0].content).toEqual({
      type: 'checklist', text: 'Body added through MCP', checklist: [{ ...item, completed: true }], metadata: { version: 2 },
    });
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it('enables a stored checklist while preserving an incoming MCP body edit', async () => {
    const original = row();
    const item = { id: 'task-1', text: 'Previously hidden task', completed: true };
    columns(original)[0].cards[0].content = { type: 'text', text: 'Original body', checklist: [item] };
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const initialForm = { title: 'Original card', content: structuredClone(columns(original)[0].cards[0].content), labels: [] };
    const remote = structuredClone(original);
    columns(remote)[0].cards[0].content.text = 'MCP changed only the body';
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    useBoardStore.getState().saveCardEditor({ ...initialForm, content: { ...initialForm.content, type: 'checklist' } }, initialForm);
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[0].cards[0].content).toEqual({ type: 'checklist', text: 'MCP changed only the body', checklist: [item] });
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it('replays editor undo and redo without erasing later MCP content', async () => {
    const original = row();
    const first = { id: 'task-1', text: 'Keep this task', completed: false };
    columns(original)[0].cards[0].content = { type: 'checklist', text: 'Original body', checklist: [first], metadata: { version: 1 } } as unknown as Card['content'];
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const initialForm = { title: 'Original card', content: structuredClone(columns(original)[0].cards[0].content), labels: [] };
    const remote = structuredClone(original);
    const remoteContent = columns(remote)[0].cards[0].content as unknown as Record<string, unknown>;
    Object.assign(remoteContent, {
      text: 'MCP body', metadata: { version: 2 },
      checklist: [first, { id: 'task-2', text: 'Added by MCP', completed: true }],
    });
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    useBoardStore.getState().saveCardEditor({ ...initialForm, content: { ...initialForm.content, checklist: [{ ...first, completed: true }] } }, initialForm);
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[0].cards[0].content).toMatchObject({
      text: 'MCP body', metadata: { version: 2 }, checklist: [{ ...first, completed: true }, { id: 'task-2', text: 'Added by MCP', completed: true }],
    });

    useUndoStore.getState().undo();
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[0].cards[0].content).toMatchObject({
      text: 'MCP body', metadata: { version: 2 }, checklist: [{ ...first, completed: false }, { id: 'task-2', text: 'Added by MCP', completed: true }],
    });
    useUndoStore.getState().redo();
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(rows.get(original.id)!)[0].cards[0].content).toMatchObject({
      text: 'MCP body', metadata: { version: 2 }, checklist: [{ ...first, completed: true }, { id: 'task-2', text: 'Added by MCP', completed: true }],
    });
  });

  it.each([false, true])('retains mixed-content metadata and incoming body while repairing a legacy image (remove: %s)', async (removeImage) => {
    const original = row();
    const imageUrl = 'https://example.com/mixed-legacy.png';
    const item = { id: 'task-1', text: 'Review image', completed: false };
    columns(original)[0].cards[0].content = Object.assign({ type: 'checklist' as const, text: 'Original body', checklist: [item], imageUrl }, { metadata: { owner: 'original' } });
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const image = { id: 'legacy-image', name: 'Image', url: imageUrl, addedAt: FIRST_REVISION, isCover: false };
    const initialForm = { title: 'Original card', content: { type: 'checklist' as const, text: 'Original body', checklist: [item] }, labels: [], attachments: [image] };
    const remote = structuredClone(original);
    columns(remote)[0].cards[0].content.text = 'New MCP body';
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    useBoardStore.getState().saveCardEditor({
      ...initialForm,
      content: { ...initialForm.content, checklist: [{ ...item, completed: true }] },
      attachments: removeImage ? undefined : initialForm.attachments,
    }, initialForm);
    await vi.advanceTimersByTimeAsync(400);
    const saved = columns(rows.get(original.id)!)[0].cards[0];
    expect(saved.content).toEqual({ type: 'checklist', text: 'New MCP body', checklist: [{ ...item, completed: true }], metadata: { owner: 'original' } });
    expect(saved.attachments?.some((attachment) => attachment.url === imageUrl) ?? false).toBe(!removeImage);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it.each(['local', 'remote'] as const)('resolves competing recurrence frequencies to the complete %s schedule', async (choice) => {
    const original = row();
    const originalRecurrence = { frequency: 'weekly' as const, interval: 1 };
    columns(original)[0].cards[0].recurrence = originalRecurrence;
    rows.set(original.id, original);
    await signIn();
    useBoardStore.getState().openCardEditor(original.id, 'card-1');
    const remote = structuredClone(original);
    const remoteRecurrence = { frequency: 'weekly' as const, interval: 1, daysOfWeek: [3] };
    Object.assign(columns(remote)[0].cards[0], { recurrence: remoteRecurrence, description: 'MCP summary' });
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    const localRecurrence = { frequency: 'daily' as const, interval: 2 };
    const initialForm = { title: 'Original card', content: { type: 'text' as const, text: '' }, recurrence: originalRecurrence, labels: [] };
    useBoardStore.getState().saveCardEditor({ ...initialForm, title: 'Browser title', recurrence: localRecurrence }, initialForm);
    await vi.advanceTimersByTimeAsync(800);
    expect(updateRequests()).toHaveLength(0);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('conflict');
    useBoardStore.getState().resolveBoardConflict(original.id, choice);
    await settle();
    const saved = columns(rows.get(original.id)!)[0].cards[0];
    expect(saved.recurrence).toEqual(choice === 'local' ? localRecurrence : remoteRecurrence);
    expect(saved.title).toBe('Browser title');
    expect(saved.description).toBe('MCP summary');
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it.each([
    ['single', 'local'], ['single', 'remote'], ['bulk', 'local'], ['bulk', 'remote'],
  ] as const)('deduplicates overlapping %s browser/MCP archives with %s conflict resolution', async (scope, choice) => {
    const original = row();
    const source = columns(original)[0].cards[0];
    Object.assign(source, { recurrence: { frequency: 'daily', interval: 1 }, targetDate: '2026-04-15', futureField: { nested: ['MCP metadata'] } });
    columns(original)[0].cards.push(card('other-source'));
    rows.set(original.id, original);
    await signIn();
    if (scope === 'single') useBoardStore.getState().archiveCard(original.id, 'column-1', source.id);
    else useBoardStore.getState().archiveAllCards(original.id, 'column-1');
    expect(useUndoStore.getState().undoStack).toHaveLength(1);
    // MCP commits before the queued browser archive: different clocks, one source.
    vi.setSystemTime(new Date('2026-09-06T12:00:01Z'));
    const remote = structuredClone(original);
    const copy = createMcpRecurringCardCopy(source);
    columns(remote)[0].cards.push(copy, card('mcp-addition'));
    Object.assign(columns(remote)[0].cards[0], { isArchived: true, archivedAt: new Date().toISOString() });
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('conflict');
    const draftCards = useBoardStore.getState().boards[0].columns.flatMap((column) => column.cards);
    expect(draftCards.filter((entry) => entry.id === copy.id)).toHaveLength(1);
    useBoardStore.getState().resolveBoardConflict(original.id, choice);
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
    const saved = columns(rows.get(original.id)!)[0].cards;
    expect(saved).toHaveLength(4);
    expect(saved.filter((entry) => entry.id === copy.id)).toHaveLength(1);
    expect(saved.find((entry) => entry.id === copy.id)).toMatchObject({ isArchived: false, targetDate: '2026-04-16', futureField: { nested: ['MCP metadata'] } });
    expect(saved.find((entry) => entry.id === source.id)?.isArchived).toBe(true);
    expect(saved.find((entry) => entry.id === 'other-source')?.isArchived).toBe(scope === 'bulk' ? true : undefined);
    expect(saved.find((entry) => entry.id === 'mcp-addition')?.isArchived).toBeUndefined();
  });

  it.each(['single', 'bulk'] as const)('persists %s archive undo/redo as one transaction against the latest board', async (scope) => {
    const original = row();
    Object.assign(columns(original)[0].cards[0], { recurrence: { frequency: 'daily', interval: 1 }, targetDate: '2026-04-15' });
    columns(original)[0].cards.push(card('other-source'));
    rows.set(original.id, original);
    await signIn();
    if (scope === 'single') useBoardStore.getState().archiveCard(original.id, 'column-1', 'card-1');
    else useBoardStore.getState().archiveAllCards(original.id, 'column-1');
    await vi.advanceTimersByTimeAsync(400);
    expect(updateRequests()).toHaveLength(1);
    expect(useUndoStore.getState().undoStack).toHaveLength(1);
    const copyId = columns(rows.get(original.id)!)[0].cards[2].id;
    const remote = structuredClone(rows.get(original.id)!);
    columns(remote)[0].cards[0].description = 'MCP description after archive';
    columns(remote)[0].cards.push(card('mcp-addition'));
    remote.updated_at = SECOND_REVISION;
    rows.set(remote.id, remote);
    emit(remote);
    useUndoStore.getState().undo();
    await vi.advanceTimersByTimeAsync(400);
    let saved = columns(rows.get(original.id)!)[0].cards;
    expect(saved.map((entry) => entry.id)).toEqual(['card-1', 'other-source', 'mcp-addition']);
    expect(saved.every((entry) => !entry.isArchived)).toBe(true);
    expect(saved[0].description).toBe('MCP description after archive');
    useUndoStore.getState().redo();
    await vi.advanceTimersByTimeAsync(400);
    saved = columns(rows.get(original.id)!)[0].cards;
    expect(saved).toHaveLength(4);
    expect(saved.find((entry) => entry.id === copyId)?.isArchived).toBe(false);
    expect(saved[0]).toMatchObject({ isArchived: true, description: 'MCP description after archive' });
    expect(saved.find((entry) => entry.id === 'mcp-addition')?.isArchived).toBeUndefined();
    expect(updateRequests()).toHaveLength(3);
    expect(useBoardStore.getState().boardSyncStates[original.id].status).toBe('saved');
  });

  it.each(['card', 'column'] as const)('does not partially archive a %s when a recurring due date is invalid', async (scope) => {
    const original = row();
    Object.assign(columns(original)[0].cards[0], {
      targetDate: '2026-02-31', recurrence: { frequency: 'daily', interval: 1 },
    });
    columns(original)[0].cards.push(card('other-card', 'Preserve this card too'));
    rows.set(original.id, original);
    await signIn();
    const before = structuredClone(useBoardStore.getState().boards[0]);
    expect(() => {
      if (scope === 'card') useBoardStore.getState().archiveCard(original.id, 'column-1', 'card-1');
      else useBoardStore.getState().archiveAllCards(original.id, 'column-1');
    }).not.toThrow();
    await vi.advanceTimersByTimeAsync(400);
    expect(useBoardStore.getState().boards[0]).toEqual(before);
    expect(rows.get(original.id)).toEqual(original);
    expect(updateRequests()).toHaveLength(0);
    expect(useUndoStore.getState().undoStack).toHaveLength(0);
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

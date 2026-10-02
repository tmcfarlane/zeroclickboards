import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { toast } from 'sonner';
import type { Board } from '@/types';
import type { BoardSyncState } from '@/lib/board-sync';
import { boardAccessFor, editableAccess, type BoardAccess } from '@/lib/board-access';
import type { CardEditorSession } from '@/store/useBoardStore';
import { AppShell } from '../AppShell';
import { useBoardDialogs } from '@/hooks/useBoardDialogs';

const state = vi.hoisted(() => ({
  auth: { isSignedIn: true, isLoaded: true, userId: 'current-user' as string | null },
  signOut: vi.fn(),
  aiCallbacks: [] as Array<(hasDraft: boolean) => void>,
  activeBoard: null as Board | null,
  boards: [] as Board[],
  store: {
    currentUserId: 'current-user' as string | null,
    boards: [] as Board[],
    boardAccess: {} as Record<string, BoardAccess>,
    activeBoardId: 'current-board',
    viewMode: 'board',
    cardEditorSession: null as CardEditorSession | null,
    createBoard: vi.fn(),
    addCard: vi.fn(),
    getBoardAccess: vi.fn(),
    canEditBoard: vi.fn(),
    canManageBoard: vi.fn(),
    canRecoverCardDraft: vi.fn(),
    openCardEditor: vi.fn(),
    closeCardEditor: vi.fn(),
    saveCardEditor: vi.fn(),
    renameBoard: vi.fn(),
    deleteBoard: vi.fn(),
    setActiveBoard: vi.fn(),
    setViewMode: vi.fn(),
    getActiveBoard: vi.fn(),
    getBoardsForUser: vi.fn(),
    setCurrentUserId: vi.fn(),
    boardSyncStates: {} as Record<string, BoardSyncState>,
    remoteStatus: 'ready',
    refreshFromRemote: vi.fn(),
    retryBoardSync: vi.fn(),
    resolveBoardConflict: vi.fn(),
    saveBoardDraftAsCopy: vi.fn(),
    discardBoardDraft: vi.fn(),
  },
}));

vi.mock('@/store/useBoardStore', () => ({
  useBoardStore: Object.assign(
    (selector?: (store: typeof state.store) => unknown) => selector ? selector(state.store) : state.store,
    { getState: () => state.store },
  ),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuthContext: () => ({ signOut: state.signOut }) }));
vi.mock('@/hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/components/KeyboardShortcutsHelp', () => ({ KeyboardShortcutsHelp: () => null }));
vi.mock('@/components/board/KanbanBoard', () => ({
  KanbanBoard: ({ onAIClick }: { onAIClick: () => void }) => {
    const { openTextDialog } = useBoardDialogs();
    return <><p>Kanban board content</p><button onClick={onAIClick}>Open AI</button><button onClick={() => openTextDialog({ kind: 'rename-board', boardId: 'current-board' })}>Open board rename</button></>;
  },
}));
vi.mock('@/components/board/BoardSkeleton', () => ({ BoardSkeleton: () => <p>Loading board content</p> }));
vi.mock('@/components/timeline/TimelineView', () => ({ TimelineView: () => <p>Timeline board content</p> }));
vi.mock('@/components/ai/AIAssistant', () => ({
  AIAssistant: ({ isOpen, onClose, onDraftChange }: { isOpen: boolean; onClose: () => void; onDraftChange?: (hasDraft: boolean) => void }) => {
    const [input, setInput] = useState('');
    useEffect(() => { if (onDraftChange) state.aiCallbacks.push(onDraftChange); }, [onDraftChange]);
    if (!isOpen) return null;
    return <><input aria-label="Controlled AI draft" value={input} onChange={(event) => { setInput(event.target.value); onDraftChange?.(event.target.value.length > 0); }} /><button onClick={onClose}>Hide controlled AI</button></>;
  },
}));
vi.mock('@/components/auth/UserProfile', () => ({ UserProfile: ({ onSignOutClick }: { onSignOutClick: () => void }) => <button onClick={onSignOutClick}>Request sign out</button> }));
vi.mock('@/components/auth/SignInModal', () => ({ SignInModal: () => null }));
vi.mock('@/components/board/CreateBoardDialog', () => ({ CreateBoardDialog: () => null }));
vi.mock('@/components/billing/AIUpgradePrompt', () => ({ AIUpgradePrompt: () => null }));
vi.mock('@/components/billing/UpgradeToProBanner', () => ({ UpgradeToProBanner: () => null }));
vi.mock('../Footer', () => ({ Footer: () => null }));

const RoutedChildren = createContext<ReactNode>(null);
function FixtureRoutes() {
  const children = useContext(RoutedChildren);
  return <Routes><Route path="/app" element={children} /><Route path="/account" element={<h1>Account route</h1>} /><Route path="/terms" element={<h1>Terms route</h1>} /></Routes>;
}
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function renderAppShell() {
  const router = createMemoryRouter([{ path: '*', element: <FixtureRoutes /> }], { initialEntries: ['/terms', '/app', '/account'], initialIndex: 1 });
  routers.push(router);
  function Wrapper({ children }: { children: ReactNode }) { return <RoutedChildren.Provider value={children}><RouterProvider router={router} /></RoutedChildren.Provider>; }
  return { ...render(<AppShell />, { wrapper: Wrapper }), router };
}
afterEach(() => { routers.splice(0).forEach(router => router.dispose()); vi.restoreAllMocks(); });

function attemptToLeave() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.aiCallbacks = [];
  state.auth = { isSignedIn: true, isLoaded: true, userId: 'current-user' };
  state.signOut.mockResolvedValue({ error: null });
  state.store.currentUserId = 'current-user';
  state.store.setCurrentUserId.mockImplementation((userId: string | null) => {
    if (state.store.currentUserId !== userId) { state.store.currentUserId = userId; state.store.boardSyncStates = {}; state.store.cardEditorSession = null; }
  });
  state.activeBoard = {
    id: 'current-board',
    name: 'Current board',
    columns: [],
    createdAt: '2026-09-06T10:00:00Z',
    updatedAt: '2026-09-06T10:00:00Z',
    userId: 'current-user',
  };
  state.boards = [state.activeBoard];
  state.store.boards = state.boards;
  state.store.boardAccess = {};
  state.store.cardEditorSession = null;
  state.store.activeBoardId = state.activeBoard.id;
  state.store.viewMode = 'board';
  state.store.remoteStatus = 'ready';
  state.store.boardSyncStates = {};
  state.store.getActiveBoard.mockImplementation(() => state.activeBoard);
  state.store.setActiveBoard.mockImplementation((id: string) => { state.store.activeBoardId = id; state.activeBoard = state.boards.find(board => board.id === id) ?? null; });
  state.store.getBoardsForUser.mockImplementation(() => state.boards);
  state.store.getBoardAccess.mockImplementation((id: string) => boardAccessFor(state.boards.find((board) => board.id === id), state.auth.userId, state.store.boardAccess));
  state.store.canEditBoard.mockImplementation((id: string) => editableAccess(state.store.getBoardAccess(id)));
  state.store.canManageBoard.mockImplementation((id: string) => state.store.getBoardAccess(id) === 'owner');
  state.store.canRecoverCardDraft.mockReturnValue(false);
  state.store.refreshFromRemote.mockResolvedValue(undefined);
});

describe('AppShell board synchronization', () => {
  it.each(['board', 'timeline'])('shows the active board sync notice above the %s view', (viewMode) => {
    state.store.viewMode = viewMode;
    state.store.boardSyncStates['current-board'] = { status: 'error', message: 'Current board edits are waiting to save.' };
    state.store.boardSyncStates['other-board'] = { status: 'error', message: 'Other board save failed.' };
    renderAppShell();

    const notice = screen.getByRole('alert');
    const main = screen.getByRole('main');
    expect(notice).toHaveTextContent('Current board edits are waiting to save.');
    expect(main).toHaveTextContent(viewMode === 'board' ? 'Kanban board content' : 'Timeline board content');
    expect(notice.nextElementSibling).toBe(main);
    expect(screen.queryByText('Other board save failed.')).not.toBeInTheDocument();
  });

  it('does not show another board notice when no board is active', () => {
    state.activeBoard = null;
    state.store.boardSyncStates['other-board'] = { status: 'error', message: 'Other board save failed.' };
    renderAppShell();
    expect(screen.getByRole('main')).toHaveTextContent('No board selected');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['pending', 'saving', 'error', 'conflict', 'deleted', 'readonly'] as const)(
    'warns before leaving when a background board has %s changes',
    (status) => {
      state.store.boardSyncStates = {
        'current-board': { status: 'saved' },
        'background-board': { status },
      };
      renderAppShell();
      expect(attemptToLeave().defaultPrevented).toBe(true);
    },
  );

  it('shows retained readonly drafts with recovery actions and blocks editable Kanban presentation', () => {
    state.activeBoard!.userId = 'board-owner';
    state.store.boardAccess['current-board'] = 'viewer';
    state.store.boardSyncStates['current-board'] = { status: 'readonly', message: 'Your editing access changed. Your local draft is kept.' };
    renderAppShell();

    expect(screen.getByRole('alert')).toHaveTextContent('Your local draft is kept.');
    expect(screen.getByRole('button', { name: 'Save as a new board' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Discard local draft' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent('Read-only board');
    expect(screen.getByRole('textbox', { name: 'Search cards' })).toBeInTheDocument();
    expect(screen.queryByText('Kanban board content')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry save' })).not.toBeInTheDocument();
    expect(attemptToLeave().defaultPrevented).toBe(true);
  });

  it('only warns while changes remain and removes the warning on unmount', () => {
    state.store.boardSyncStates['background-board'] = { status: 'pending' };
    const { rerender, unmount } = renderAppShell();
    expect(attemptToLeave().defaultPrevented).toBe(true);

    state.store.boardSyncStates['background-board'] = { status: 'saved' };
    rerender(<AppShell />);
    expect(attemptToLeave().defaultPrevented).toBe(false);

    state.store.boardSyncStates['background-board'] = { status: 'deleted' };
    rerender(<AppShell />);
    expect(attemptToLeave().defaultPrevented).toBe(true);

    unmount();
    expect(attemptToLeave().defaultPrevented).toBe(false);
  });

  it('does not warn when there are no unsaved changes', () => {
    const { rerender } = renderAppShell();
    expect(attemptToLeave().defaultPrevented).toBe(false);

    state.store.boardSyncStates['current-board'] = { status: 'saved' };
    rerender(<AppShell />);
    expect(attemptToLeave().defaultPrevented).toBe(false);
  });

  it('refreshes on focus while signed in without repeatedly retrying a load error', () => {
    state.store.remoteStatus = 'error';
    const { rerender } = renderAppShell();
    expect(state.store.refreshFromRemote).not.toHaveBeenCalled();

    state.store.remoteStatus = 'loading';
    rerender(<AppShell />);
    state.store.remoteStatus = 'error';
    rerender(<AppShell />);
    expect(state.store.refreshFromRemote).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('focus'));
    expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1);

    state.auth = { isSignedIn: false, isLoaded: true, userId: null };
    rerender(<AppShell />);
    window.dispatchEvent(new Event('focus'));
    expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1);
  });

  it('removes its focus refresh listener on unmount', () => {
    const { unmount } = renderAppShell();
    unmount();
    window.dispatchEvent(new Event('focus'));
    expect(state.store.refreshFromRemote).not.toHaveBeenCalled();
  });

  it('warns for an open text draft and removes the warning after explicit cancellation', async () => {
    const user = userEvent.setup();
    renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open board rename' }));
    await user.clear(screen.getByRole('textbox', { name: 'Board Name' }));
    await user.type(screen.getByRole('textbox', { name: 'Board Name' }), 'Unsaved name');
    expect(attemptToLeave().defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(attemptToLeave().defaultPrevented).toBe(false);
    expect(state.store.renameBoard).not.toHaveBeenCalled();
  });

  it('clears the retained text draft when the authenticated identity changes', async () => {
    const user = userEvent.setup();
    const { rerender } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open board rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Board Name' }), ' private draft');
    state.auth = { isSignedIn: true, isLoaded: true, userId: 'another-user' };
    rerender(<AppShell />);
    expect(screen.queryByRole('dialog', { name: 'Rename Board' })).not.toBeInTheDocument();
    expect(attemptToLeave().defaultPrevented).toBe(false);
    expect(state.store.renameBoard).not.toHaveBeenCalled();
  });

  it('keeps an entered rename and its focus after a blocked route is cancelled, then leaves once explicitly allowed', async () => {
    const user = userEvent.setup(); const { router } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open board rename' }));
    const input = screen.getByRole('textbox', { name: 'Board Name' });
    await user.clear(input); await user.type(input, 'Keep my original draft');
    await act(async () => { await router.navigate('/account'); });
    expect(screen.getByRole('alertdialog', { name: 'Leave this page?' })).toHaveTextContent('Unsaved form text');
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(input).toHaveFocus()); expect(input).toHaveValue('Keep my original draft');
    expect(state.store.renameBoard).not.toHaveBeenCalled();
    await act(async () => { await router.navigate('/account'); });
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Account route' })).toBeVisible();
    expect(state.store.renameBoard).not.toHaveBeenCalled();
  });

  it('describes pending saves truthfully and allows their same-account route continuation', async () => {
    state.store.boardSyncStates['current-board'] = { status: 'saving' };
    const user = userEvent.setup(); const { router } = renderAppShell();
    await act(async () => { await router.navigate('/account'); });
    const alert = screen.getByRole('alertdialog');
    expect(alert).toHaveTextContent('Saving can continue while you stay signed in');
    expect(alert).not.toHaveTextContent('discarded');
    await user.click(screen.getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Account route' })).toBeVisible();
    expect(state.store.currentUserId).toBe('current-user'); expect(state.store.boardSyncStates['current-board'].status).toBe('saving');
  });

  it('requires a sign-out decision before changing authentication and does not sign out on Stay', async () => {
    state.store.boardSyncStates['current-board'] = { status: 'pending' };
    const user = userEvent.setup(); renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    expect(screen.getByRole('alertdialog', { name: 'Sign out with unfinished work?' })).toHaveTextContent('before signing out');
    expect(state.signOut).not.toHaveBeenCalled(); await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(state.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    await user.click(screen.getByRole('button', { name: /^Sign out$/ }));
    expect(state.signOut).toHaveBeenCalledOnce();
  });

  it('clears private local forms and an old blocked navigation when the account changes', async () => {
    const user = userEvent.setup(); const { router, rerender } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open board rename' }));
    await user.type(screen.getByRole('textbox', { name: 'Board Name' }), ' private text');
    await act(async () => { await router.navigate('/account'); });
    state.auth = { isSignedIn: true, isLoaded: true, userId: 'another-user' }; rerender(<AppShell />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app'); expect(state.store.renameBoard).not.toHaveBeenCalled();
    await act(async () => { await router.navigate('/account'); });
    expect(await screen.findByRole('heading', { name: 'Account route' })).toBeVisible();
  });

  it('ignores a superseded sign-out completion rather than resetting or notifying the new account', async () => {
    let resolve!: (value: { error: string }) => void;
    state.signOut.mockReturnValue(new Promise(done => { resolve = done; }));
    const errorToast = vi.spyOn(toast, 'error'); const user = userEvent.setup(); const { rerender } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    state.auth = { isSignedIn: true, isLoaded: true, userId: 'another-user' }; rerender(<AppShell />);
    await act(async () => { resolve({ error: 'Old sign-out failed' }); });
    expect(errorToast).not.toHaveBeenCalled(); expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(state.store.currentUserId).toBe('another-user');
  });

  it('allows board query cleanup while retaining the entered text and original save target', async () => {
    const other = { ...state.activeBoard!, id: 'other-board', name: 'Other board' }; state.boards.push(other);
    const user = userEvent.setup(); const { router } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open board rename' }));
    const input = screen.getByRole('textbox', { name: 'Board Name' }); await user.clear(input); await user.type(input, 'Original board renamed');
    await act(async () => { await router.navigate('/app?board=other-board'); });
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(state.store.activeBoardId).toBe('other-board'); expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(input).toHaveValue('Original board renamed');
    await user.click(screen.getByRole('button', { name: /^Rename$/ }));
    expect(state.store.renameBoard).toHaveBeenCalledExactlyOnceWith('current-board', 'Original board renamed');
  });
});


describe('AppShell unsent AI drafts', () => {
  it('guards AI-only text before unload and pathname navigation, retaining it on Stay', async () => {
    const user = userEvent.setup(); const { router } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    const input = screen.getByRole('textbox', { name: 'Controlled AI draft' });
    await user.type(input, 'Keep this unsent question'); await user.click(input);
    expect(attemptToLeave().defaultPrevented).toBe(true);
    await act(async () => { await router.navigate('/account'); });
    const alert = screen.getByRole('alertdialog', { name: 'Leave this page?' });
    expect(alert).toHaveTextContent('Your unsent AI text will be discarded');
    expect(alert).not.toHaveTextContent('Open forms will close');
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await waitFor(() => expect(input).toHaveFocus()); expect(input).toHaveValue('Keep this unsent question');
    await user.clear(input); expect(attemptToLeave().defaultPrevented).toBe(false);
    await act(async () => { await router.navigate('/account'); });
    expect(await screen.findByRole('heading', { name: 'Account route' })).toBeVisible();
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it('keeps a hidden AI draft guarded and requires a sign-out decision before calling auth', async () => {
    const user = userEvent.setup(); renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    await user.type(screen.getByRole('textbox', { name: 'Controlled AI draft' }), 'Keep hidden text');
    await user.click(screen.getByRole('button', { name: 'Hide controlled AI' }));
    expect(screen.queryByRole('textbox', { name: 'Controlled AI draft' })).not.toBeInTheDocument();
    expect(attemptToLeave().defaultPrevented).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    expect(screen.getByRole('alertdialog', { name: 'Sign out with unfinished work?' })).toHaveTextContent('Your unsent AI text');
    expect(state.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    expect(screen.getByRole('textbox', { name: 'Controlled AI draft' })).toHaveValue('Keep hidden text');
    expect(state.signOut).not.toHaveBeenCalled();
  });

  it('retains unsent text and its guard after a same-account sign-out failure', async () => {
    state.signOut.mockResolvedValue({ error: 'Disposable logout failure' });
    const errorToast = vi.spyOn(toast, 'error'); const user = userEvent.setup(); renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    await user.type(screen.getByRole('textbox', { name: 'Controlled AI draft' }), 'Retry after failed sign-out');
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    expect(state.signOut).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /^Sign out$/ }));
    await waitFor(() => expect(errorToast).toHaveBeenCalledExactlyOnceWith('Could not sign out. Try again.'));
    expect(screen.getByRole('textbox', { name: 'Controlled AI draft' })).toHaveValue('Retry after failed sign-out');
    expect(attemptToLeave().defaultPrevented).toBe(true);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    expect(screen.getByRole('alertdialog')).toBeVisible(); expect(state.signOut).toHaveBeenCalledOnce();
  });

  it('retains the same-owner signal on rerender and ignores an obsolete owner report after replacement', async () => {
    const user = userEvent.setup(); const { router, rerender } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    await user.type(screen.getByRole('textbox', { name: 'Controlled AI draft' }), 'Account A private text');
    const oldReport = state.aiCallbacks.at(-1); expect(oldReport).toBeTypeOf('function');
    state.auth = { ...state.auth }; rerender(<AppShell />);
    expect(screen.getByRole('textbox', { name: 'Controlled AI draft' })).toHaveValue('Account A private text');
    expect(attemptToLeave().defaultPrevented).toBe(true); expect(state.aiCallbacks.at(-1)).toBe(oldReport);
    await act(async () => { await router.navigate('/account'); });
    expect(screen.getByRole('alertdialog')).toBeVisible();
    state.auth = { isSignedIn: true, isLoaded: true, userId: 'account-b' };
    state.activeBoard!.userId = 'account-b'; rerender(<AppShell />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(router.state.location.pathname).toBe('/app');
    expect(attemptToLeave().defaultPrevented).toBe(false);
    act(() => oldReport!(true)); expect(attemptToLeave().defaultPrevented).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    const successorInput = screen.getByRole('textbox', { name: 'Controlled AI draft' }); expect(successorInput).toHaveValue('');
    await user.type(successorInput, 'Account B private text'); expect(attemptToLeave().defaultPrevented).toBe(true);
    act(() => oldReport!(false)); expect(attemptToLeave().defaultPrevented).toBe(true); expect(successorInput).toHaveValue('Account B private text');
    await user.clear(successorInput); expect(attemptToLeave().defaultPrevented).toBe(false);
    state.auth = { isSignedIn: true, isLoaded: true, userId: 'current-user' };
    state.activeBoard!.userId = 'current-user'; rerender(<AppShell />);
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    const returnedAccountInput = screen.getByRole('textbox', { name: 'Controlled AI draft' }); expect(returnedAccountInput).toHaveValue('');
    await user.type(returnedAccountInput, 'Account A new session text');
    act(() => oldReport!(false)); expect(attemptToLeave().defaultPrevented).toBe(true); expect(returnedAccountInput).toHaveValue('Account A new session text');
  });

  it('clears old AI-only work on auth loss without preserving an old sign-out intent', async () => {
    const user = userEvent.setup(); const { rerender } = renderAppShell();
    await user.click(screen.getByRole('button', { name: 'Open AI' }));
    await user.type(screen.getByRole('textbox', { name: 'Controlled AI draft' }), 'Private signed-in text');
    await user.click(screen.getByRole('button', { name: 'Request sign out' }));
    expect(screen.getByRole('alertdialog')).toBeVisible();
    state.auth = { isSignedIn: false, isLoaded: true, userId: null }; rerender(<AppShell />);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Controlled AI draft' })).not.toBeInTheDocument();
    expect(attemptToLeave().defaultPrevented).toBe(false); expect(state.signOut).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Board } from '@/types';
import type { BoardSyncState } from '@/lib/board-sync';
import { AppShell } from '../AppShell';

const state = vi.hoisted(() => ({
  auth: { isSignedIn: true, isLoaded: true, userId: 'current-user' as string | null },
  activeBoard: null as Board | null,
  boards: [] as Board[],
  store: {
    activeBoardId: 'current-board',
    viewMode: 'board',
    createBoard: vi.fn(),
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
  useBoardStore: (selector?: (store: typeof state.store) => unknown) => selector ? selector(state.store) : state.store,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('@/hooks/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/components/KeyboardShortcutsHelp', () => ({ KeyboardShortcutsHelp: () => null }));
vi.mock('@/components/board/KanbanBoard', () => ({ KanbanBoard: () => <p>Kanban board content</p> }));
vi.mock('@/components/board/BoardSkeleton', () => ({ BoardSkeleton: () => <p>Loading board content</p> }));
vi.mock('@/components/timeline/TimelineView', () => ({ TimelineView: () => <p>Timeline board content</p> }));
vi.mock('@/components/ai/AIAssistant', () => ({ AIAssistant: () => null }));
vi.mock('@/components/auth/UserProfile', () => ({ UserProfile: () => null }));
vi.mock('@/components/auth/SignInModal', () => ({ SignInModal: () => null }));
vi.mock('@/components/board/CreateBoardDialog', () => ({ CreateBoardDialog: () => null }));
vi.mock('@/components/billing/AIUpgradePrompt', () => ({ AIUpgradePrompt: () => null }));
vi.mock('@/components/billing/UpgradeToProBanner', () => ({ UpgradeToProBanner: () => null }));
vi.mock('../Footer', () => ({ Footer: () => null }));

function renderAppShell() {
  return render(<AppShell />, { wrapper: MemoryRouter });
}

function attemptToLeave() {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { isSignedIn: true, isLoaded: true, userId: 'current-user' };
  state.activeBoard = {
    id: 'current-board',
    name: 'Current board',
    columns: [],
    createdAt: '2026-09-06T10:00:00Z',
    updatedAt: '2026-09-06T10:00:00Z',
    userId: 'current-user',
  };
  state.boards = [state.activeBoard];
  state.store.activeBoardId = state.activeBoard.id;
  state.store.viewMode = 'board';
  state.store.remoteStatus = 'ready';
  state.store.boardSyncStates = {};
  state.store.getActiveBoard.mockImplementation(() => state.activeBoard);
  state.store.getBoardsForUser.mockImplementation(() => state.boards);
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

  it.each(['pending', 'saving', 'error', 'conflict', 'deleted'] as const)(
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
});

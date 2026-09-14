import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '@/types';
import { SharedBoardPage } from '../SharedBoardPage';

const state = vi.hoisted(() => ({
  auth: { userId: 'invited-user' as string | null, isLoaded: true },
  params: { boardId: 'invited-board' },
  navigate: vi.fn(),
  rpc: vi.fn(),
  boardSingle: vi.fn(),
  memberSingle: vi.fn(),
  inviteSingle: vi.fn(),
  store: {
    currentUserId: 'invited-user' as string | null,
    remoteStatus: 'ready',
    boards: [] as Board[],
    getBoardsForUser: vi.fn(),
    setCurrentUserId: vi.fn(),
    refreshFromRemote: vi.fn(),
    setActiveBoard: vi.fn(),
  },
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => state.auth }));
vi.mock('@/store/useBoardStore', () => ({
  useBoardStore: Object.assign(() => state.store, { getState: () => state.store }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-router-dom')>(),
  useParams: () => state.params,
  useNavigate: () => state.navigate,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: state.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        limit: () => query,
        single: table === 'boards' ? state.boardSingle : table === 'board_members' ? state.memberSingle : state.inviteSingle,
      };
      return query;
    },
  },
}));
vi.mock('@/components/board/ReadOnlyBoard', () => ({
  ReadOnlyBoard: ({ board }: { board: Board }) => <p>Read-only view of {board.name}</p>,
}));
vi.mock('@/components/auth/SignInModal', () => ({ SignInModal: () => null }));

const board: Board = {
  id: 'invited-board',
  name: 'Invited board',
  userId: 'owner-user',
  columns: [],
  createdAt: '2026-09-06T10:00:00Z',
  updatedAt: '2026-09-06T10:00:00Z',
};

const boardRow = {
  id: board.id,
  name: board.name,
  user_id: board.userId,
  data: { columns: [] },
  created_at: board.createdAt,
  updated_at: board.updatedAt,
  is_public: false,
  embed_enabled: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function renderSharedBoard() {
  return render(<SharedBoardPage />, { wrapper: MemoryRouter });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = { userId: 'invited-user', isLoaded: true };
  state.params = { boardId: 'invited-board' };
  state.store.currentUserId = 'invited-user';
  state.store.remoteStatus = 'ready';
  state.store.boards = [];
  state.store.getBoardsForUser.mockImplementation(() => state.store.boards);
  state.rpc.mockResolvedValue({ error: null });
  state.boardSingle.mockResolvedValue({ data: boardRow, error: null });
  state.memberSingle.mockResolvedValue({ data: { role: 'editor' }, error: null });
  state.inviteSingle.mockResolvedValue({ data: { board_name: board.name }, error: null });
  state.store.refreshFromRemote.mockResolvedValue(undefined);
});

describe('SharedBoardPage editor access', () => {
  it('waits for invitation resolution and a fresh store load before selecting the invited board', async () => {
    const invitation = deferred<{ error: null }>();
    const refresh = deferred<void>();
    state.rpc.mockReturnValue(invitation.promise);
    state.store.refreshFromRemote.mockReturnValue(refresh.promise);
    renderSharedBoard();

    expect(state.store.setCurrentUserId).toHaveBeenCalledExactlyOnceWith('invited-user');
    expect(state.store.refreshFromRemote).not.toHaveBeenCalled();
    expect(state.store.setActiveBoard).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();

    await act(async () => { invitation.resolve({ error: null }); });
    await waitFor(() => expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1));
    expect(state.store.setActiveBoard).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();

    state.store.boards = [board];
    await act(async () => { refresh.resolve(); });
    await waitFor(() => expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/app?board=invited-board', { replace: true }));
    expect(state.store.setActiveBoard).toHaveBeenCalledExactlyOnceWith(board.id);
  });

  it('also refreshes owner access before redirecting', async () => {
    state.boardSingle.mockResolvedValue({ data: { ...boardRow, user_id: 'invited-user' }, error: null });
    state.store.boards = [{ ...board, userId: 'invited-user' }];
    renderSharedBoard();

    await waitFor(() => expect(state.navigate).toHaveBeenCalledTimes(1));
    expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1);
    expect(state.memberSingle).not.toHaveBeenCalled();
    expect(state.store.setActiveBoard).toHaveBeenCalledExactlyOnceWith(board.id);
  });

  it.each(['ready', 'error'])('offers a bounded retry when refresh ends %s without the invited board', async (remoteStatus) => {
    const user = userEvent.setup();
    state.store.remoteStatus = remoteStatus;
    renderSharedBoard();

    expect(await screen.findByRole('alert')).toHaveTextContent('This board could not be opened for editing. Please try again.');
    expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1);
    expect(state.store.setActiveBoard).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();

    state.store.refreshFromRemote.mockImplementation(async () => {
      state.store.remoteStatus = 'ready';
      state.store.boards = [board];
    });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(state.navigate).toHaveBeenCalledTimes(1));
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(2);
    expect(state.store.setActiveBoard).toHaveBeenCalledExactlyOnceWith(board.id);
  });

  it('does not redirect from a failed refresh even when an older board remains in the store', async () => {
    state.store.boards = [board];
    state.store.remoteStatus = 'error';
    renderSharedBoard();

    expect(await screen.findByRole('alert')).toHaveTextContent('This board could not be opened for editing.');
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('shows an invitation error without fetching inaccessible content or retrying automatically', async () => {
    state.rpc.mockResolvedValue({ error: { message: 'Connection lost' } });
    renderSharedBoard();

    expect(await screen.findByRole('alert')).toHaveTextContent('This board could not be loaded. Please try again.');
    expect(state.rpc).toHaveBeenCalledTimes(1);
    expect(state.boardSingle).not.toHaveBeenCalled();
    expect(state.store.refreshFromRemote).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('keeps viewer access read-only without selecting or refreshing an editable board', async () => {
    state.memberSingle.mockResolvedValue({ data: { role: 'viewer' }, error: null });
    renderSharedBoard();

    expect(await screen.findByText('Read-only view of Invited board')).toBeInTheDocument();
    expect(screen.getByText('Viewer')).toBeInTheDocument();
    expect(state.store.refreshFromRemote).not.toHaveBeenCalled();
    expect(state.store.setActiveBoard).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('does not select a board after its page unmounts during refresh', async () => {
    const refresh = deferred<void>();
    state.store.refreshFromRemote.mockReturnValue(refresh.promise);
    const { unmount } = renderSharedBoard();
    await waitFor(() => expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1));
    unmount();

    state.store.boards = [board];
    await act(async () => { refresh.resolve(); });
    expect(state.store.setActiveBoard).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('does not apply an old user invitation after the signed-in user changes', async () => {
    const refresh = deferred<void>();
    state.store.refreshFromRemote.mockReturnValue(refresh.promise);
    renderSharedBoard();
    await waitFor(() => expect(state.store.refreshFromRemote).toHaveBeenCalledTimes(1));

    state.store.currentUserId = 'different-user';
    state.store.boards = [board];
    await act(async () => { refresh.resolve(); });
    expect(state.store.setActiveBoard).not.toHaveBeenCalled();
    expect(state.navigate).not.toHaveBeenCalled();
  });

  it('cancels an old invitation before reading its board after a route change', async () => {
    const invitation = deferred<{ error: null }>();
    state.rpc.mockReturnValueOnce(invitation.promise);
    state.memberSingle.mockResolvedValue({ data: { role: 'viewer' }, error: null });
    const { rerender } = renderSharedBoard();

    state.params = { boardId: 'different-board' };
    state.boardSingle.mockResolvedValue({ data: { ...boardRow, id: 'different-board', name: 'Different board' }, error: null });
    rerender(<SharedBoardPage />);
    expect(await screen.findByText('Read-only view of Different board')).toBeInTheDocument();

    await act(async () => { invitation.resolve({ error: null }); });
    expect(state.boardSingle).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Read-only view of Different board')).toBeInTheDocument();
    expect(state.navigate).not.toHaveBeenCalled();
  });
});

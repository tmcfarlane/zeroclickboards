import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Board } from '@/types';
import type { BoardSyncState } from '@/lib/board-sync';
import { BoardSyncNotice } from '../BoardSyncNotice';

const store = vi.hoisted(() => ({
  boards: [] as Board[],
  boardSyncStates: {} as Record<string, BoardSyncState>,
  retryBoardSync: vi.fn(),
  resolveBoardConflict: vi.fn(),
  saveBoardDraftAsCopy: vi.fn(),
  discardBoardDraft: vi.fn(),
}));

vi.mock('@/store/useBoardStore', () => ({
  useBoardStore: (selector: (state: typeof store) => unknown) => selector(store),
}));

const boardId = 'board-being-edited';

function setConflict() {
  store.boardSyncStates[boardId] = {
    status: 'conflict',
    conflicts: [
      { path: 'name', local: 'My board name', remote: 'Incoming board name' },
      { path: 'data.cards[task-1].card.title', local: 'My task title', remote: 'Incoming task title' },
    ],
  };
}

beforeEach(() => {
  store.boards = [{ id: boardId, name: 'Example', createdAt: '', updatedAt: '', columns: [{ id: 'todo', title: 'To Do', order: 0, cards: [{ id: 'task-1', title: 'My task title', content: { type: 'text', text: '' }, createdAt: '', updatedAt: '' }] }] }];
  store.boardSyncStates = {};
  vi.clearAllMocks();
});

describe('BoardSyncNotice', () => {
  it('describes complete recurrence choices using readable schedules', async () => {
    const user = userEvent.setup();
    store.boardSyncStates[boardId] = {
      status: 'conflict',
      conflicts: [
        { path: 'data.cards[task-1].card.recurrence', local: { frequency: 'daily', interval: 2 }, remote: { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] } },
        { path: 'data.cards[task-2].card.recurrence', local: { frequency: 'monthly', interval: 1 }, remote: { frequency: 'monthly', interval: 1, dayOfMonth: 31 } },
      ],
    };
    render(<BoardSyncNotice boardId={boardId} />);
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Card: My task title · Recurrence' })).toBeInTheDocument();
    for (const label of ['Every 2 days', 'Every 2 weeks (Mon, Wed)', 'Monthly on the target date’s day', 'Monthly on the 31st']) {
      expect(within(dialog).getByText(label, { exact: true })).toBeInTheDocument();
    }
  });

  it('only shows unsaved state for the requested board', () => {
    store.boardSyncStates['another-board'] = { status: 'error' };
    const { container, rerender } = render(<BoardSyncNotice boardId={boardId} />);
    expect(container).toBeEmptyDOMElement();

    store.boardSyncStates[boardId] = { status: 'saved' };
    rerender(<BoardSyncNotice boardId={boardId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('announces pending and saving changes, then disappears after saving', () => {
    store.boardSyncStates[boardId] = { status: 'pending' };
    const { rerender, container } = render(<BoardSyncNotice boardId={boardId} />);
    expect(screen.getByRole('status')).toHaveTextContent('Changes waiting to save…');

    store.boardSyncStates[boardId] = { status: 'saving' };
    rerender(<BoardSyncNotice boardId={boardId} />);
    expect(screen.getByRole('status')).toHaveTextContent('Saving changes…');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    store.boardSyncStates[boardId] = { status: 'saved' };
    rerender(<BoardSyncNotice boardId={boardId} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a failed save visible and retries the affected board', async () => {
    const user = userEvent.setup();
    store.boardSyncStates[boardId] = { status: 'error', message: 'Connection lost. Your edits are still here.' };
    const { rerender } = render(<BoardSyncNotice boardId={boardId} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost. Your edits are still here.');
    await user.click(screen.getByRole('button', { name: 'Retry save' }));
    expect(store.retryBoardSync).toHaveBeenCalledExactlyOnceWith(boardId);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    store.boardSyncStates[boardId] = { status: 'saving' };
    rerender(<BoardSyncNotice boardId={boardId} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Saving changes…');
  });

  it('shows a useful error when no message is supplied', () => {
    store.boardSyncStates[boardId] = { status: 'error' };
    render(<BoardSyncNotice boardId={boardId} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Your changes could not be saved. Your edits are still in this tab.');
  });

  it('reviews each field and both values without resolving changes on dismissal', async () => {
    const user = userEvent.setup();
    setConflict();
    render(<BoardSyncNotice boardId={boardId} />);
    await user.click(screen.getByRole('button', { name: 'Review changes' }));

    const dialog = screen.getByRole('dialog', { name: 'Review board changes' });
    expect(dialog).toHaveAccessibleDescription('Choose which edits to use for the conflicting fields below. Changes to other fields are kept.');
    expect(within(dialog).getByRole('heading', { name: 'Board name' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Card: My task title · Title' })).toBeInTheDocument();
    for (const value of ['My board name', 'Incoming board name', 'My task title', 'Incoming task title']) {
      expect(within(dialog).getByText(value, { exact: true })).toBeInTheDocument();
    }

    await user.click(within(dialog).getByRole('button', { name: 'Review later' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.resolveBoardConflict).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Review changes' })).toHaveFocus();
  });

  it.each([
    { button: 'Keep my edits', choice: 'local' },
    { button: 'Use incoming edits', choice: 'remote' },
  ])('resolves conflicting values with "$button"', async ({ button, choice }) => {
    const user = userEvent.setup();
    setConflict();
    render(<BoardSyncNotice boardId={boardId} />);
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    await user.click(screen.getByRole('button', { name: button }));

    expect(store.resolveBoardConflict).toHaveBeenCalledExactlyOnceWith(boardId, choice);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.discardBoardDraft).not.toHaveBeenCalled();
  });

  it('renders incoming markup as plain text and makes missing or structured values readable', async () => {
    const user = userEvent.setup();
    const markup = '<img src="x" onerror="alert(1)">';
    const longText = 'A long task description. '.repeat(100);
    store.boardSyncStates[boardId] = {
      status: 'conflict',
      conflicts: [
        { path: 'description', local: longText, remote: markup },
        { path: 'columns.todo.cards.task-1', local: undefined, remote: { title: 'Restored task', archived: false } },
        { path: 'background', local: '', remote: null },
      ],
    };
    render(<BoardSyncNotice boardId={boardId} />);
    await user.click(screen.getByRole('button', { name: 'Review changes' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(markup, { exact: true })).toBeInTheDocument();
    expect(dialog.querySelector('img')).toBeNull();
    expect(within(dialog).getByText(longText.trim(), { exact: true })).toBeInTheDocument();
    expect(within(dialog).getByText('Removed', { exact: true })).toBeInTheDocument();
    expect(within(dialog).getByText(/"title": "Restored task"/)).toHaveTextContent('"archived": false');
    expect(within(dialog).getByText('(Empty text)', { exact: true })).toBeInTheDocument();
    expect(within(dialog).getByText('None', { exact: true })).toBeInTheDocument();
  });

  it('closes the review when switching boards, so an old decision cannot affect another board', async () => {
    const user = userEvent.setup();
    setConflict();
    store.boardSyncStates['another-board'] = { status: 'conflict', conflicts: [{ path: 'name', local: 'Other local', remote: 'Other incoming' }] };
    const { rerender } = render(<BoardSyncNotice boardId={boardId} />);
    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(<BoardSyncNotice boardId="another-board" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(store.resolveBoardConflict).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Other incoming');
    await user.click(screen.getByRole('button', { name: 'Use incoming edits' }));
    expect(store.resolveBoardConflict).toHaveBeenCalledExactlyOnceWith('another-board', 'remote');
  });

  it('offers a new board for a draft whose original board was deleted', async () => {
    const user = userEvent.setup();
    store.boardSyncStates[boardId] = { status: 'deleted' };
    render(<BoardSyncNotice boardId={boardId} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This board was deleted elsewhere.');
    expect(screen.getByRole('alert')).toHaveTextContent('Your unsaved draft is kept in this tab.');
    await user.click(screen.getByRole('button', { name: 'Save as a new board' }));
    expect(store.saveBoardDraftAsCopy).toHaveBeenCalledExactlyOnceWith(boardId);
    expect(store.discardBoardDraft).not.toHaveBeenCalled();
  });

  it('discards only the local draft when explicitly selected', async () => {
    const user = userEvent.setup();
    store.boardSyncStates[boardId] = { status: 'deleted', message: 'This board is no longer available.' };
    render(<BoardSyncNotice boardId={boardId} />);

    expect(screen.getByRole('alert')).toHaveTextContent('This board is no longer available.');
    await user.click(screen.getByRole('button', { name: 'Discard local draft' }));
    expect(store.discardBoardDraft).toHaveBeenCalledExactlyOnceWith(boardId);
    expect(store.saveBoardDraftAsCopy).not.toHaveBeenCalled();
    expect(store.resolveBoardConflict).not.toHaveBeenCalled();
    expect(store.retryBoardSync).not.toHaveBeenCalled();
  });
});

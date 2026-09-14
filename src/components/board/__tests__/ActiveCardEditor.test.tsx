import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Card } from '@/types';
import { useBoardStore } from '@/store/useBoardStore';
import { ActiveCardEditor } from '../ActiveCardEditor';
import { KanbanCard } from '../KanbanCard';
import { CardEditor } from '../CardEditor';
import { TimelineView } from '@/components/timeline/TimelineView';

const logActivity = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useActivityLogger', () => ({ useActivityLogger: () => ({ logActivity }) }));
vi.mock('../CardActivityFeed', () => ({ CardActivityFeed: () => <div>Activity feed</div> }));
vi.mock('../CardActionsMenu', () => ({
  CardActionsMenu: ({ onEdit }: { onEdit: () => void }) => <button onClick={onEdit}>Open card menu editor</button>,
}));
vi.mock('../BoardSelector', () => ({ BoardSelector: () => null }));
vi.mock('../ViewToggle', () => ({ ViewToggle: () => null }));
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }),
}));

function initialCard(): Card {
  return {
    id: 'card-1', title: 'Original card', content: { type: 'text', text: 'Body supplied by MCP' },
    createdAt: '2026-09-06T12:00:00Z', updatedAt: '2026-09-06T12:00:00Z',
  };
}

function initialBoard(card = initialCard()): Board {
  return {
    id: 'board-1', name: 'Editor test board', createdAt: card.createdAt, updatedAt: card.updatedAt,
    columns: [
      { id: 'column-1', title: 'To Do', order: 0, cards: [card] },
      { id: 'column-2', title: 'In Progress', order: 1, cards: [] },
    ],
  };
}

function BoardCards() {
  const boards = useBoardStore((state) => state.boards);
  return <>{boards.map((board) => <section key={board.id}>
    {board.columns.map((column) => <div key={column.id}>
      {column.cards.map((card) => <KanbanCard key={card.id} boardId={board.id} columnId={column.id} card={card} />)}
    </div>)}
  </section>)}</>;
}

function TestApp({ showCards = true }: { showCards?: boolean }) {
  return <>{showCards && <BoardCards />}<ActiveCardEditor /></>;
}

function TimelineTestApp({ board, showTimeline = true }: { board: Board; showTimeline?: boolean }) {
  return <>{showTimeline && <TimelineView board={board} onNewBoardClick={() => {}} />}<ActiveCardEditor /></>;
}

function setBoard(board: Board) {
  act(() => { useBoardStore.setState({ boards: [board], activeBoardId: board.id }); });
}

beforeEach(() => {
  useBoardStore.getState().setCurrentUserId(null);
  useBoardStore.setState({ boards: [initialBoard()], activeBoardId: 'board-1', cardEditorSession: null, boardSyncStates: {} });
  logActivity.mockClear();
});
afterEach(() => {
  cleanup();
  useBoardStore.getState().closeCardEditor();
});

describe('ActiveCardEditor', () => {
  it('keeps a typed draft open across a remote move and saves only changed fields onto the moved card', async () => {
    const user = userEvent.setup();
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    const title = screen.getByPlaceholderText('Card title...');
    expect(screen.getByLabelText('Body text')).toHaveValue('Body supplied by MCP');
    await user.clear(title);
    await user.type(title, 'My typed title');

    const moved = initialBoard();
    moved.columns[0].cards = [];
    moved.columns[1].cards = [{
      ...initialCard(), content: { type: 'text', text: 'Newer MCP body' }, labels: ['blue'],
      recurrence: { frequency: 'weekly', interval: 2 }, targetDate: '2026-09-20',
    }];
    setBoard(moved);

    expect(screen.getByRole('dialog', { name: 'Edit Card' })).toBeInTheDocument();
    expect(title).toHaveValue('My typed title');
    expect(screen.getByLabelText('Body text')).toHaveValue('Body supplied by MCP');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const board = useBoardStore.getState().boards[0];
    expect(board.columns[0].cards).toEqual([]);
    expect(board.columns[1].cards[0]).toMatchObject({
      title: 'My typed title', content: { type: 'text', text: 'Newer MCP body' }, labels: ['blue'],
      recurrence: { frequency: 'weekly', interval: 2 }, targetDate: '2026-09-20',
    });
    expect(board.columns[1].cards[0].description).toBeUndefined();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(logActivity).toHaveBeenCalledExactlyOnceWith('card-1', 'renamed', { from: 'Original card', to: 'My typed title' });
  });

  it('survives filtering out the source card and cancels without applying its draft', async () => {
    const user = userEvent.setup();
    const view = render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Open card menu editor' }));
    await user.type(screen.getByPlaceholderText('Card title...'), ' unsaved');
    view.rerender(<TestApp showCards={false} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Card title...')).toHaveValue('Original card unsaved');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(useBoardStore.getState().boards[0].columns[0].cards[0].title).toBe('Original card');
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('opens a fresh session with the newest values after a draft is cancelled', async () => {
    const user = userEvent.setup();
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    await user.type(screen.getByPlaceholderText('Card title...'), ' discarded');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const updated = initialBoard({ ...initialCard(), title: 'Incoming title' });
    setBoard(updated);
    await user.click(screen.getByRole('button', { name: 'Incoming title' }));
    expect(screen.getByPlaceholderText('Card title...')).toHaveValue('Incoming title');
  });

  it('deletes the current card location after it moves while the editor is open', async () => {
    const user = userEvent.setup();
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    const moved = initialBoard();
    moved.columns[1].cards = moved.columns[0].cards;
    moved.columns[0].cards = [];
    setBoard(moved);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(useBoardStore.getState().boards[0].columns.flatMap((column) => column.cards)).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not persist legacy image migration or absent optional fields when the user saves without editing', async () => {
    const user = userEvent.setup();
    const legacy = {
      ...initialCard(), content: { type: 'image' as const, imageUrl: 'https://example.com/body.png' },
      coverImage: 'https://example.com/cover.png',
    };
    setBoard(initialBoard(legacy));
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useBoardStore.getState().boards[0].columns[0].cards[0]).toEqual(legacy);
    expect(logActivity).not.toHaveBeenCalled();
  });

  it('retains the legacy image as an attachment when the user starts a text body', async () => {
    const user = userEvent.setup();
    const imageUrl = 'https://example.com/legacy-body.png';
    setBoard(initialBoard({ ...initialCard(), content: { type: 'image', imageUrl } }));
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    await user.type(screen.getByLabelText('Body text'), 'New written body');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useBoardStore.getState().boards[0].columns[0].cards[0];
    expect(saved.content).toEqual({ type: 'text', text: 'New written body' });
    expect(saved.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ url: imageUrl, isCover: false })]));
    expect(saved.coverImage).toBeUndefined();
  });

  it('can deliberately clear MCP body text without creating a description', async () => {
    const user = userEvent.setup();
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    await user.clear(screen.getByLabelText('Body text'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(useBoardStore.getState().boards[0].columns[0].cards[0].content).toEqual({ type: 'text', text: '' });
  });

  it.each(['2026-02-28T23:30:00-08:00', '2026-02-30'])('keeps the raw saved date %s during a title-only edit', async (targetDate) => {
    const user = userEvent.setup();
    setBoard(initialBoard({ ...initialCard(), targetDate }));
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    await user.type(screen.getByPlaceholderText('Card title...'), ' renamed');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useBoardStore.getState().boards[0].columns[0].cards[0];
    expect(saved.targetDate).toBe(targetDate);
    expect(saved.content).toEqual(initialCard().content);
    expect(saved.title).toBe('Original card renamed');
  });

  it.each(['change', 'remove'] as const)('persists an explicit date %s and preserves incoming body text', async (action) => {
    const user = userEvent.setup();
    const original = { ...initialCard(), targetDate: '2026-02-28T23:30:00-08:00' };
    setBoard(initialBoard(original));
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    if (action === 'change') fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-03-01' } });
    else await user.click(screen.getByRole('button', { name: 'Remove due date' }));
    setBoard(initialBoard({ ...original, content: { type: 'text', text: 'Incoming body' } }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useBoardStore.getState().boards[0].columns[0].cards[0];
    expect(saved.targetDate).toBe(action === 'change' ? '2026-03-01' : undefined);
    expect(saved.content.text).toBe('Incoming body');
  });

  it.each([false, true])('keeps an implicit monthly day untouched during a title edit (remote clears recurrence: %s)', async (remoteClears) => {
    const user = userEvent.setup();
    const original = { ...initialCard(), targetDate: '2026-01-31', recurrence: { frequency: 'monthly' as const, interval: 1 } };
    setBoard(initialBoard(original));
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    expect(screen.getByRole('spinbutton', { name: 'Day of month' })).toHaveValue(null);
    await user.type(screen.getByPlaceholderText('Card title...'), ' renamed');
    if (remoteClears) setBoard(initialBoard({ ...original, recurrence: undefined }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useBoardStore.getState().boards[0].columns[0].cards[0];
    expect(saved.title).toBe('Original card renamed');
    expect(saved.targetDate).toBe('2026-01-31');
    expect(saved.recurrence).toEqual(remoteClears ? undefined : { frequency: 'monthly', interval: 1 });
  });

  it.each(['Description', 'Body text'] as const)('saves an edited %s independently from an incoming change to the other field', async (field) => {
    const user = userEvent.setup();
    const card = { ...initialCard(), description: 'Original summary' };
    setBoard(initialBoard(card));
    render(<TestApp />);
    await user.click(screen.getByRole('button', { name: 'Original card' }));
    expect(screen.getByLabelText('Description')).toHaveValue('Original summary');
    expect(screen.getByLabelText('Body text')).toHaveValue('Body supplied by MCP');
    await user.clear(screen.getByLabelText(field));
    await user.type(screen.getByLabelText(field), 'My independent edit');
    const remote = field === 'Description'
      ? { ...card, content: { type: 'text' as const, text: 'Incoming body' } }
      : { ...card, description: 'Incoming summary' };
    setBoard(initialBoard(remote));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const saved = useBoardStore.getState().boards[0].columns[0].cards[0];
    expect(saved.description).toBe(field === 'Description' ? 'My independent edit' : 'Incoming summary');
    expect(saved.content.text).toBe(field === 'Body text' ? 'My independent edit' : 'Incoming body');
  });

  it('opens the persistent editor from the timeline and keeps it open if the timeline unmounts', async () => {
    const user = userEvent.setup();
    const date = new Date();
    const targetDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const board = initialBoard({ ...initialCard(), targetDate });
    setBoard(board);
    const view = render(<TimelineTestApp board={board} />);
    await user.click(screen.getByRole('button', { name: 'Edit Original card' }));
    await user.click(screen.getByRole('button', { name: 'Open Full Editor' }));
    expect(useBoardStore.getState().cardEditorSession?.cardId).toBe('card-1');
    await user.type(screen.getByPlaceholderText('Card title...'), ' from timeline');
    view.rerender(<TimelineTestApp board={board} showTimeline={false} />);
    expect(screen.getByPlaceholderText('Card title...')).toHaveValue('Original card from timeline');
    expect(screen.getByRole('dialog', { name: 'Edit Card' })).toBeInTheDocument();
  });
});

describe('CardEditor normalized form baseline', () => {
  it('passes the separate body text and legacy attachment migration as the unchanged initial form', async () => {
    const user = userEvent.setup();
    const save = vi.fn();
    const card = { ...initialCard(), coverImage: 'https://example.com/cover.png' };
    render(<CardEditor isOpen mode="edit" cardId={card.id} initialData={card} onClose={() => {}} onSave={save} />);
    expect(screen.getByLabelText('Body text')).toHaveValue('Body supplied by MCP');
    fireEvent.change(screen.getByPlaceholderText('Card title...'), { target: { value: 'Changed title' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const [submitted, baseline] = save.mock.calls[0];
    expect(submitted.title).toBe('Changed title');
    expect(baseline.title).toBe('Original card');
    expect(submitted.content).toEqual(baseline.content);
    expect(submitted.description).toBe(baseline.description);
    expect(submitted.attachments).toEqual(baseline.attachments);
    expect(baseline.coverImage).toBe(card.coverImage);
    expect(baseline.attachments).toHaveLength(1);
    expect(baseline.attachments[0]).toMatchObject({ url: card.coverImage, isCover: true });
  });
});

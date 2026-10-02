import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '@/types';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import { AIAssistant } from '../AIAssistant';

vi.mock('@/components/auth/AuthProvider', () => ({ useAuthContext: () => ({ session: null }) }));
vi.mock('@/hooks/useAIUsage', () => ({ useAIUsage: () => ({ isPaid: true, isLimitReached: false, updateUsage: vi.fn() }) }));

const task = { id: 'task-1', text: 'Existing task', completed: true, source: 'imported' };
const originalContent = {
  type: 'checklist' as const, text: 'Original body', checklist: [task],
  imageUrl: 'https://example.com/legacy.png', metadata: { owner: 'original' },
};
const savedCard = () => useBoardStore.getState().boards[0].columns[0].cards[0];
const originalActions = { addCard: useBoardStore.getState().addCard, createBoard: useBoardStore.getState().createBoard };

beforeEach(() => {
  useBoardStore.getState().setCurrentUserId(null);
  const card: Card = { id: 'card-1', title: 'Review card', description: 'Independent summary', content: structuredClone(originalContent), createdAt: '2026-09-06', updatedAt: '2026-09-06' };
  useBoardStore.setState({
    activeBoardId: 'board-1', boards: [{ id: 'board-1', name: 'Test board', columns: [{ id: 'column-1', title: 'To Do', cards: [card], order: 0 }], createdAt: '2026-09-06', updatedAt: '2026-09-06' }],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useBoardStore.setState(originalActions);
  useUndoStore.getState().clearHistory();
});

const readOnlyMessage = 'This board is read-only. Ask the owner for editor access to make changes.';
function setSharedAccess(role: 'editor' | 'viewer' | 'commenter') {
  useBoardStore.setState(state => ({
    currentUserId: 'member-account',
    boardAccess: { 'board-1': role },
    boards: state.boards.map(board => ({ ...board, userId: 'other-owner' })),
  }));
}

describe('AI shared-board permissions', () => {
  it.each(['viewer', 'commenter'] as const)('keeps %s board commands read-only and does not claim an edit succeeded', async role => {
    setSharedAccess(role);
    const before = structuredClone(useBoardStore.getState().boards);
    await submit('edit_card', { cardId: 'card-1', text: 'Denied body' });
    await screen.findByText(readOnlyMessage);
    expect(useBoardStore.getState().boards).toEqual(before);
    expect(screen.queryByText('Label all cards green')).not.toBeInTheDocument();
  });

  it('checks current access after waiting for an AI response', async () => {
    setSharedAccess('editor');
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(resolve => { respond = resolve; })));
    render(<AIAssistant isOpen onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What should we do next?'), 'Update this card{Enter}');
    act(() => useBoardStore.setState({ boardAccess: { 'board-1': 'viewer' } }));
    await act(async () => respond(new Response(JSON.stringify({ commands: [{
      type: 'edit_card', params: { cardId: 'card-1', text: 'Denied late body' }, originalText: 'Update this card',
    }] }), { status: 200 })));
    await screen.findByText(readOnlyMessage);
    expect(savedCard().content).toEqual(originalContent);
  });

  it('checks access between commands in an AI batch', async () => {
    setSharedAccess('editor');
    const addCard = vi.fn<(boardId: string, columnId: string, title: string) => string>(boardId => {
      useBoardStore.setState({ boardAccess: { [boardId]: 'viewer' } });
      return 'disposable-new-card';
    });
    useBoardStore.setState({ addCard });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ commands: [
      { type: 'add_card', params: { title: 'First approved action' }, originalText: 'Add two tasks' },
      { type: 'add_card', params: { title: 'Denied after downgrade' }, originalText: 'Add two tasks' },
    ] }), { status: 200 })));
    render(<AIAssistant isOpen onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What should we do next?'), 'Add two tasks{Enter}');
    await screen.findByText(content => content.includes(readOnlyMessage) && content.includes('First approved action'));
    expect(addCard).toHaveBeenCalledTimes(1);
    expect(addCard.mock.calls[0][2]).toBe('First approved action');
  });

  it('still permits a board summary for a viewer', async () => {
    setSharedAccess('viewer');
    await submit('count_cards', {});
    await screen.findByText('1 total card (To Do: 1)');
    expect(screen.queryByText(readOnlyMessage)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Board summary' })).toBeInTheDocument();
  });

  it('permits creating a separate owned board while viewing a shared read-only board', async () => {
    setSharedAccess('viewer');
    const createBoard = vi.fn(() => 'disposable-owned-board');
    useBoardStore.setState({ createBoard });
    await submit('create_board', { name: 'My separate board' });
    await screen.findByText('Created board "My separate board"');
    expect(createBoard).toHaveBeenCalledWith('My separate board', 'Created via AI');
  });
});

async function submit(type: string, params: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ commands: [{ type, params, originalText: 'Update this card' }] }), { status: 200 })));
  render(<AIAssistant isOpen onClose={() => {}} />);
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('What should we do next?'), 'Update this card{Enter}');
}

describe('AI card content commands', () => {
  it.each(['edit_card', 'add_checklist'])('uses the latest moved card after waiting for the AI response: %s', async (type) => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { respond = resolve; })));
    render(<AIAssistant isOpen onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What should we do next?'), 'Update this card{Enter}');
    const incoming = structuredClone(useBoardStore.getState().boards[0]);
    const moved = incoming.columns[0].cards.pop()!;
    const remoteTask = { id: 'remote-task', text: 'MCP task', completed: false };
    Object.assign(moved.content, { text: 'New MCP body', metadata: { owner: 'MCP' }, checklist: [task, remoteTask] });
    incoming.columns.push({ id: 'moved-column', title: 'Moved', order: 1, cards: [moved] });
    act(() => useBoardStore.setState({ boards: [incoming] }));
    await act(async () => respond(new Response(JSON.stringify({ commands: [{
      type, params: { cardId: 'card-1', text: 'Requested body', checklistItems: ['Requested task'] }, originalText: 'Update this card',
    }] }), { status: 200 })));
    const current = () => useBoardStore.getState().boards[0].columns[1].cards[0];
    await waitFor(() => expect(type === 'edit_card' ? current().content.text : current().content.checklist?.length).toBe(type === 'edit_card' ? 'Requested body' : 3));
    expect(current().content).toMatchObject({ metadata: { owner: 'MCP' }, imageUrl: originalContent.imageUrl });
    expect(current().content.checklist?.slice(0, 2)).toEqual([task, remoteTask]);
    if (type === 'add_checklist') expect(current().content.text).toBe('New MCP body');
    expect(useBoardStore.getState().boards[0].columns[0].cards).toEqual([]);
  });

  it('does not execute a delayed response after the signed-in account changes', async () => {
    let respond!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((resolve) => { respond = resolve; })));
    render(<AIAssistant isOpen onClose={() => {}} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('What should we do next?'), 'Update this card{Enter}');
    act(() => useBoardStore.setState({ currentUserId: 'different-account' }));
    await act(async () => respond(new Response(JSON.stringify({ commands: [{ type: 'edit_card', params: { cardId: 'card-1', text: 'Stale request' }, originalText: 'Update this card' }] }), { status: 200 })));
    await screen.findByText('This request was canceled because the signed-in account changed.');
    expect(savedCard().content).toEqual(originalContent);
  });

  it.each([{ cardId: 'card-1' }, { cardTitle: 'Review card' }])('edits only body text and preserves checklist, image, metadata and summary (%j)', async (target) => {
    await submit('edit_card', { ...target, text: 'New body' });
    await waitFor(() => expect(savedCard().content.text).toBe('New body'));
    expect(savedCard().content).toEqual({ ...originalContent, text: 'New body' });
    expect(savedCard().description).toBe('Independent summary');
  });

  it('restores stored checklist items while keeping body and image when adding tasks to all cards', async () => {
    savedCard().content.type = 'text';
    await submit('add_checklist', { allCards: true, checklistItems: ['New task'] });
    await waitFor(() => expect(savedCard().content.checklist).toHaveLength(2));
    expect(savedCard().content).toMatchObject({ ...originalContent, checklist: [task, { text: 'New task', completed: false }] });
    expect(savedCard().content.checklist?.[1].id).not.toBe(task.id);
  });
});

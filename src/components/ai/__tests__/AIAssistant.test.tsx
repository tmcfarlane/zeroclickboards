import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps, ComponentType } from 'react';
import type { Card } from '@/types';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import { AIAssistant } from '../AIAssistant';

vi.mock('@/components/auth/AuthProvider', () => ({ useAuthContext: () => ({ session: null }) }));
const usage = vi.hoisted(() => ({
  isPaid: true, isLimitReached: false,
  limit: null as number | null, remaining: null as number | null,
  updateUsage: vi.fn(),
}));
vi.mock('@/hooks/useAIUsage', () => ({ useAIUsage: () => usage }));

const task = { id: 'task-1', text: 'Existing task', completed: true, source: 'imported' };
const originalContent = {
  type: 'checklist' as const, text: 'Original body', checklist: [task],
  imageUrl: 'https://example.com/legacy.png', metadata: { owner: 'original' },
};
const savedCard = () => useBoardStore.getState().boards[0].columns[0].cards[0];
const originalActions = { addCard: useBoardStore.getState().addCard, createBoard: useBoardStore.getState().createBoard };

beforeEach(() => {
  Object.assign(usage, { isPaid: true, isLimitReached: false, limit: null, remaining: null });
  usage.updateUsage.mockClear();
  useBoardStore.getState().setCurrentUserId(null);
  const card: Card = { id: 'card-1', title: 'Review card', description: 'Independent summary', content: structuredClone(originalContent), createdAt: '2026-09-06', updatedAt: '2026-09-06' };
  useBoardStore.setState({
    activeBoardId: 'board-1', boards: [{ id: 'board-1', name: 'Test board', columns: [{ id: 'column-1', title: 'To Do', cards: [card], order: 0 }], createdAt: '2026-09-06', updatedAt: '2026-09-06' }],
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
  it.each([{ isComposing: true }, { keyCode: 229 }])('keeps composition confirmation out of AI commands (%j)', async composition => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ commands: [{ type: 'count_cards', params: {}, originalText: 'Count cards' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    render(<AIAssistant isOpen onClose={() => {}} />);
    const input = screen.getByPlaceholderText('What should we do next?');
    fireEvent.change(input, { target: { value: '未完成の入力' } });
    fireEvent.keyDown(input, { key: 'Enter', ...composition });
    expect(fetch).not.toHaveBeenCalled();
    expect(input).toHaveValue('未完成の入力');
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByText('1 total card (To Do: 1)');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

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

// The cast lets these runtime regressions execute against the pre-contract baseline.
const DraftAssistant = AIAssistant as ComponentType<ComponentProps<typeof AIAssistant> & {
  onDraftChange?: (hasDraft: boolean) => void;
}>;
const composerPlaceholder = 'What should we do next?';
function summaryResponse() {
  return new Response(JSON.stringify({ commands: [{
    type: 'count_cards', params: {}, originalText: 'How many cards total?',
  }] }), { status: 200 });
}
function heldResponse() {
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Response>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

describe('AI unsent draft reporting', () => {
  it('reports retained input through Clear chat, hidden panels, quota changes and a newly bound hidden callback', async () => {
    const onDraftChange = vi.fn<(hasDraft: boolean) => void>();
    const onClose = vi.fn();
    const view = render(<DraftAssistant isOpen onClose={onClose} onDraftChange={onDraftChange} />);
    const signals = [onDraftChange.mock.lastCall?.[0]];
    const text = 'Keep this private prompt — 計画 🗓️';
    fireEvent.change(screen.getByPlaceholderText(composerPlaceholder), { target: { value: text } });
    signals.push(onDraftChange.mock.lastCall?.[0]);
    await userEvent.click(screen.getByTitle('Clear chat'));
    expect(screen.getByPlaceholderText(composerPlaceholder)).toHaveValue(text);
    signals.push(onDraftChange.mock.lastCall?.[0]);

    view.rerender(<DraftAssistant isOpen={false} onClose={onClose} onDraftChange={onDraftChange} />);
    expect(screen.queryByPlaceholderText(composerPlaceholder)).not.toBeInTheDocument();
    signals.push(onDraftChange.mock.lastCall?.[0]);
    Object.assign(usage, { isPaid: false, isLimitReached: true, limit: 5, remaining: 0 });
    view.rerender(<DraftAssistant isOpen onClose={onClose} onDraftChange={onDraftChange} />);
    expect(screen.getByText('Daily limit reached — resets at midnight PT')).toBeVisible();
    expect(screen.queryByPlaceholderText(composerPlaceholder)).not.toBeInTheDocument();
    signals.push(onDraftChange.mock.lastCall?.[0]);

    const rebound = vi.fn<(hasDraft: boolean) => void>();
    view.rerender(<DraftAssistant isOpen={false} onClose={onClose} onDraftChange={rebound} />);
    const reboundWhileHidden = rebound.mock.lastCall?.[0];
    Object.assign(usage, { isPaid: true, isLimitReached: false });
    view.rerender(<DraftAssistant isOpen onClose={onClose} onDraftChange={rebound} />);
    expect(screen.getByPlaceholderText(composerPlaceholder)).toHaveValue(text);
    expect(signals).toEqual([false, true, true, true, true]);
    expect(reboundWhileHidden).toBe(true);
    expect(rebound).toHaveBeenLastCalledWith(true);
  });

  it('keeps whitespace and composing text dirty without submitting, and reports an actual input clear', () => {
    const fetch = vi.fn().mockResolvedValue(summaryResponse());
    vi.stubGlobal('fetch', fetch);
    const onDraftChange = vi.fn<(hasDraft: boolean) => void>();
    render(<DraftAssistant isOpen onClose={() => {}} onDraftChange={onDraftChange} />);
    const input = screen.getByPlaceholderText(composerPlaceholder);
    const send = within(input.parentElement!).getByRole('button');
    const signals: Array<boolean | undefined> = [];
    fireEvent.change(input, { target: { value: '   ' } });
    expect(send).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue('   ');
    signals.push(onDraftChange.mock.lastCall?.[0]);

    fireEvent.change(input, { target: { value: '未完成の入力 🗓️' } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    signals.push(onDraftChange.mock.lastCall?.[0]);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 229 });
    signals.push(onDraftChange.mock.lastCall?.[0]);
    expect(input).toHaveValue('未完成の入力 🗓️');
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue('');
    signals.push(onDraftChange.mock.lastCall?.[0]);
    expect(signals).toEqual([true, true, true, false]);
  });

  it.each(['success', 'network failure'] as const)('clears an accepted draft before HTTP settles and does not restore it after %s', async outcome => {
    const request = heldResponse();
    const onDraftChange = vi.fn<(hasDraft: boolean) => void>();
    const atRequestStart: Array<boolean | undefined> = [];
    const fetch = vi.fn<typeof globalThis.fetch>(() => {
      atRequestStart.push(onDraftChange.mock.lastCall?.[0]);
      return request.promise;
    });
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<DraftAssistant isOpen onClose={() => {}} onDraftChange={onDraftChange} />);
    const input = screen.getByPlaceholderText(composerPlaceholder);
    fireEvent.change(input, { target: { value: 'How many cards total?' } });
    try {
      await userEvent.click(within(input.parentElement!).getByRole('button'));
      expect(fetch).toHaveBeenCalledOnce();
      expect(input).toHaveValue('');
      expect(input).toBeDisabled();
      const whileHeld = onDraftChange.mock.lastCall?.[0];
      await act(async () => {
        if (outcome === 'network failure') request.reject(new Error('Disposable AI transport failure'));
        else request.resolve(summaryResponse());
      });
      await screen.findByText('1 total card (To Do: 1)');
      expect(input).toHaveValue('');
      expect(input).toBeEnabled();
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).text).toBe('How many cards total?');
      expect(atRequestStart).toEqual([false]);
      expect(whileHeld).toBe(false);
      expect(onDraftChange).toHaveBeenLastCalledWith(false);
    } finally {
      await act(async () => { request.resolve(summaryResponse()); });
    }
  });

  it('reports the actual composer after idle and processing quick actions, including completion while hidden', async () => {
    setSharedAccess('viewer');
    const request = heldResponse();
    const fetch = vi.fn<typeof globalThis.fetch>(() => request.promise);
    vi.stubGlobal('fetch', fetch);
    const onDraftChange = vi.fn<(hasDraft: boolean) => void>();
    const onClose = vi.fn();
    const view = render(<DraftAssistant isOpen onClose={onClose} onDraftChange={onDraftChange} />);
    fireEvent.change(screen.getByPlaceholderText(composerPlaceholder), { target: { value: 'My unsent prompt' } });
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Board summary' }));
      const input = screen.getByPlaceholderText(composerPlaceholder);
      expect(input).toHaveValue('');
      expect(input).toBeDisabled();
      const idleAccepted = onDraftChange.mock.lastCall?.[0];
      await userEvent.click(screen.getByRole('button', { name: 'Timeline view' }));
      expect(input).toHaveValue('Timeline view');
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).text).toBe('How many cards total?');
      const processingAssigned = onDraftChange.mock.lastCall?.[0];
      view.rerender(<DraftAssistant isOpen={false} onClose={onClose} onDraftChange={onDraftChange} />);
      await act(async () => { request.resolve(summaryResponse()); });
      view.rerender(<DraftAssistant isOpen onClose={onClose} onDraftChange={onDraftChange} />);
      expect(screen.getByPlaceholderText(composerPlaceholder)).toHaveValue('Timeline view');
      expect(screen.getByPlaceholderText(composerPlaceholder)).toBeEnabled();
      expect([idleAccepted, processingAssigned, onDraftChange.mock.lastCall?.[0]]).toEqual([false, true, true]);
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      await act(async () => { request.resolve(summaryResponse()); });
    }
  });

  it('preserves standalone submission when the optional reporting callback is omitted', async () => {
    const fetch = vi.fn().mockResolvedValue(summaryResponse());
    vi.stubGlobal('fetch', fetch);
    const view = render(<AIAssistant isOpen onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(composerPlaceholder), { target: { value: 'How many cards total?' } });
    fireEvent.keyDown(screen.getByPlaceholderText(composerPlaceholder), { key: 'Enter' });
    await screen.findByText('1 total card (To Do: 1)');
    view.rerender(<AIAssistant isOpen={false} onClose={() => {}} />);
    view.rerender(<AIAssistant isOpen onClose={() => {}} />);
    expect(screen.getByPlaceholderText(composerPlaceholder)).toHaveValue('');
    expect(fetch).toHaveBeenCalledOnce();
  });
});

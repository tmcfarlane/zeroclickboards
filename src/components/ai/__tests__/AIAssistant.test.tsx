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
  useUndoStore.getState().clearHistory();
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

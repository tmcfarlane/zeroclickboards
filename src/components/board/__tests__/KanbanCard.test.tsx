import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '@/types';
import { KanbanCard } from '../KanbanCard';

const { openCardEditor } = vi.hoisted(() => ({ openCardEditor: vi.fn() }));
vi.mock('@/store/useBoardStore', () => ({
  useBoardStore: (selector: (state: unknown) => unknown) => selector({ boards: [], openCardEditor }),
}));
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, transform: null, transition: undefined, isDragging: false }),
}));
vi.mock('../CardActionsMenu', () => ({ CardActionsMenu: () => null }));

function renderCard(targetDate: string, overrides: Partial<Card> = {}) {
  const card: Card = {
    id: 'card-1', title: 'Dated card', content: { type: 'text', text: '' }, targetDate,
    createdAt: '2026-06-03T00:00:00Z', updatedAt: '2026-06-03T00:00:00Z',
    ...overrides,
  };
  render(<KanbanCard boardId="board-1" columnId="column-1" card={card} />);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('KanbanCard due dates', () => {
  it.each(['2026-06-03', '2026-06-03T23:30:00-08:00'])('shows the assigned calendar day for %s', (targetDate) => {
    renderCard(targetDate);
    expect(screen.getByText('Jun 3')).toBeInTheDocument();
  });

  it('offers a direct way to correct an invalid saved date', async () => {
    renderCard('2026-02-31');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Invalid due date' }));
    expect(openCardEditor).toHaveBeenCalledWith('board-1', 'card-1');
    expect(screen.queryByText('Mar 3')).not.toBeInTheDocument();
  });
});

describe('KanbanCard body and checklist previews', () => {
  it.each(['text', 'checklist'] as const)('shows the shared body with a %s card and only active checklist progress', (type) => {
    renderCard('', { content: { type, text: 'Shared body notes', checklist: [{ id: 'item', text: 'Task', completed: true }] } });
    expect(screen.getByText('Shared body notes')).toBeInTheDocument();
    expect(screen.queryByText('1/1') !== null).toBe(type === 'checklist');
  });

  it('keeps a separate description as the preview when both text fields are present', () => {
    renderCard('', { description: 'Short summary', content: { type: 'checklist', text: 'Long body notes', checklist: [] } });
    expect(screen.getByText('Short summary')).toBeInTheDocument();
    expect(screen.queryByText('Long body notes')).not.toBeInTheDocument();
  });
});

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

function renderCard(targetDate: string) {
  const card: Card = {
    id: 'card-1', title: 'Dated card', content: { type: 'text', text: '' }, targetDate,
    createdAt: '2026-06-03T00:00:00Z', updatedAt: '2026-06-03T00:00:00Z',
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

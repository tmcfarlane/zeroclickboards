import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReadOnlyBoard } from '../ReadOnlyBoard';
import type { Board } from '@/types';

function makeBoard(overrides?: Partial<Board>): Board {
  return {
    id: 'board-1',
    name: 'Test Board',
    columns: [
      {
        id: 'col-1',
        title: 'To Do',
        order: 0,
        cards: [
          {
            id: 'card-1',
            title: 'First Task',
            content: { type: 'text', text: 'Some description text' },
            targetDate: '2026-05-01',
            labels: ['red', 'blue'],
            isArchived: false,
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
          {
            id: 'card-2',
            title: 'Checklist Card',
            content: {
              type: 'checklist',
              checklist: [
                { id: '1', text: 'Item A', completed: true },
                { id: '2', text: 'Item B', completed: false },
                { id: '3', text: 'Item C', completed: true },
              ],
            },
            isArchived: false,
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
          {
            id: 'card-archived',
            title: 'Archived Card',
            content: { type: 'text', text: '' },
            isArchived: true,
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
        ],
      },
      {
        id: 'col-2',
        title: 'Done',
        order: 1,
        cards: [],
      },
    ],
    createdAt: '2026-04-14T00:00:00Z',
    updatedAt: '2026-04-14T00:00:00Z',
    ...overrides,
  };
}

describe('ReadOnlyBoard', () => {
  it('renders column titles', () => {
    render(<ReadOnlyBoard board={makeBoard()} />);
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('renders card titles', () => {
    render(<ReadOnlyBoard board={makeBoard()} />);
    expect(screen.getByText('First Task')).toBeInTheDocument();
    expect(screen.getByText('Checklist Card')).toBeInTheDocument();
  });

  it('shows card description text', () => {
    render(<ReadOnlyBoard board={makeBoard()} />);
    expect(screen.getByText('Some description text')).toBeInTheDocument();
  });

  it('shows checklist progress', () => {
    render(<ReadOnlyBoard board={makeBoard()} />);
    expect(screen.getByText('2/3 completed')).toBeInTheDocument();
  });

  it('does not render archived cards', () => {
    render(<ReadOnlyBoard board={makeBoard()} />);
    expect(screen.queryByText('Archived Card')).not.toBeInTheDocument();
  });

  it('hides columns in hiddenColumnIds', () => {
    render(<ReadOnlyBoard board={makeBoard({ hiddenColumnIds: ['col-2'] })} />);
    expect(screen.getByText('To Do')).toBeInTheDocument();
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
  });

  it('renders empty columns', () => {
    const board = makeBoard();
    board.columns = [{ id: 'col-empty', title: 'Empty Col', order: 0, cards: [] }];
    render(<ReadOnlyBoard board={board} />);
    expect(screen.getByText('Empty Col')).toBeInTheDocument();
  });
});

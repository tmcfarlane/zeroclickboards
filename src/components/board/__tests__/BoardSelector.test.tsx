import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardSelector } from '../BoardSelector';
import { useBoardStore } from '@/store/useBoardStore';

vi.mock('uuid', () => {
  let counter = 0;
  return { v4: vi.fn(() => `bs-uuid-${++counter}`) };
});

beforeEach(() => {
  useBoardStore.setState({
    boards: [],
    activeBoardId: null,
    viewMode: 'board',
    currentUserId: null,
    remoteStatus: 'idle',
    remoteError: null,
  });
});

describe('BoardSelector', () => {
  it('shows "Select Board" when no active board', () => {
    render(<BoardSelector onCreateBoardClick={vi.fn()} />);
    expect(screen.getByText('Select Board')).toBeInTheDocument();
  });

  it('shows active board name', () => {
    useBoardStore.getState().createBoard('My Project');
    render(<BoardSelector onCreateBoardClick={vi.fn()} />);
    expect(screen.getByText('My Project')).toBeInTheDocument();
  });

  it('lists all boards in dropdown', async () => {
    const user = userEvent.setup();
    useBoardStore.getState().createBoard('Board A');
    useBoardStore.getState().createBoard('Board B');

    render(<BoardSelector onCreateBoardClick={vi.fn()} />);

    const trigger = screen.getByRole('button');
    await user.click(trigger);

    const menu = screen.getByRole('menu');
    expect(menu).toHaveTextContent('Board A');
    expect(menu).toHaveTextContent('Board B');
  });
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBoardStore } from '@/store/useBoardStore';
import { CardActivityFeed } from '../CardActivityFeed';

const { addActivity, mutation } = vi.hoisted(() => ({ addActivity: vi.fn(), mutation: { pending: false } }));
vi.mock('@/hooks/useCards', () => ({ useCardActivities: () => ({ activities: [], isLoading: false, isAddingActivity: mutation.pending, addActivity }) }));
let previousUser: string | null;
beforeEach(() => {
  previousUser = useBoardStore.getState().currentUserId;
  useBoardStore.setState({ currentUserId: 'commenter-fixture' });
  addActivity.mockReset().mockResolvedValue(undefined);
  mutation.pending = false;
});
afterEach(() => { cleanup(); useBoardStore.setState({ currentUserId: previousUser }); });

function pendingComment() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe('pending comment submission', () => {
  it('blocks repeated shortcuts before and after the send button becomes disabled', async () => {
    const pending = pendingComment();
    addActivity.mockImplementationOnce(() => pending.promise);
    const view = render(<CardActivityFeed cardId="comment-card-fixture" />);
    const input = screen.getByPlaceholderText('Write a comment...');
    const button = screen.getByRole('button', { name: 'Comment' });
    fireEvent.change(input, { target: { value: 'Send once' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    mutation.pending = true;
    view.rerender(<CardActivityFeed cardId="comment-card-fixture" />);
    expect(button).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(addActivity).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    mutation.pending = false;
    view.rerender(<CardActivityFeed cardId="comment-card-fixture" />);
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'Next comment' } });
    fireEvent.click(button);
    await waitFor(() => expect(input).toHaveValue(''));
    expect(addActivity).toHaveBeenCalledTimes(2);
  });

  it('keeps a second draft typed while the first comment is being saved', async () => {
    const pending = pendingComment();
    addActivity.mockImplementationOnce(() => pending.promise);
    render(<CardActivityFeed cardId="comment-card-fixture" />);
    const input = screen.getByPlaceholderText('Write a comment...');
    fireEvent.change(input, { target: { value: 'First comment' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.change(input, { target: { value: 'Second unsent draft' } });
    await act(async () => pending.resolve());
    expect(input).toHaveValue('Second unsent draft');
    expect(addActivity).toHaveBeenCalledExactlyOnceWith({ user_id: 'commenter-fixture', type: 'comment', data: { text: 'First comment' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(addActivity).toHaveBeenLastCalledWith({ user_id: 'commenter-fixture', type: 'comment', data: { text: 'Second unsent draft' } });
  });

  it('keeps a rewritten draft even when it ends with the originally submitted text', async () => {
    const pending = pendingComment();
    addActivity.mockImplementationOnce(() => pending.promise);
    render(<CardActivityFeed cardId="comment-card-fixture" />);
    const input = screen.getByPlaceholderText('Write a comment...');
    fireEvent.change(input, { target: { value: 'Comment text' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.change(input, { target: { value: 'Replacement draft' } });
    fireEvent.change(input, { target: { value: 'Comment text' } });
    await act(async () => pending.resolve());
    expect(input).toHaveValue('Comment text');
    expect(addActivity).toHaveBeenCalledTimes(1);
  });

  it('retains the original draft on failure and releases the submission guard for retry', async () => {
    const pending = pendingComment();
    addActivity.mockImplementationOnce(() => pending.promise);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<CardActivityFeed cardId="comment-card-fixture" />);
      const input = screen.getByPlaceholderText('Write a comment...');
      fireEvent.change(input, { target: { value: 'Retry this comment' } });
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
      await act(async () => pending.reject(new Error('Fixture save failed')));
      expect(input).toHaveValue('Retry this comment');
      expect(errorLog).toHaveBeenCalled();
      fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
      await waitFor(() => expect(input).toHaveValue(''));
      expect(addActivity).toHaveBeenCalledTimes(2);
      expect(addActivity).toHaveBeenLastCalledWith({ user_id: 'commenter-fixture', type: 'comment', data: { text: 'Retry this comment' } });
    } finally { errorLog.mockRestore(); }
  });
});
describe('comment composition', () => {
  it.each([
    { isComposing: true, ctrlKey: true }, { isComposing: true, metaKey: true },
    { keyCode: 229, ctrlKey: true }, { keyCode: 229, metaKey: true },
  ])('preserves composition until a separate send shortcut (%j)', async composition => {
    render(<CardActivityFeed cardId="comment-card-fixture" />);
    const input = screen.getByPlaceholderText('Write a comment...');
    fireEvent.change(input, { target: { value: '入力途中のコメント' } });
    fireEvent.keyDown(input, { key: 'Enter', ...composition });
    expect(addActivity).not.toHaveBeenCalled();
    expect(input).toHaveValue('入力途中のコメント');
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(input).toHaveValue(''));
    expect(addActivity).toHaveBeenCalledExactlyOnceWith({ user_id: 'commenter-fixture', type: 'comment', data: { text: '入力途中のコメント' } });
  });
});

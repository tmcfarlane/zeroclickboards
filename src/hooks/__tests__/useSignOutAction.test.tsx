import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { StrictMode, useLayoutEffect, useRef } from 'react';
import { Toaster, toast } from 'sonner';
import { useSignOutAction } from '../useSignOutAction';

vi.unmock('sonner');

const state = vi.hoisted(() => ({
  auth: {
    user: { id: 'first-account', email: 'first@example.invalid' },
    session: { access_token: 'first-token' },
    signOut: vi.fn<() => Promise<{ error: string | null }>>(),
  },
}));

vi.mock('@/components/auth/AuthProvider', () => ({
  useAuthContext: () => state.auth,
}));

type SignOutResult = { error: string | null };
const failureMessage = 'Could not sign out. Try again.';

function deferred() {
  let resolve!: (value: SignOutResult) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<SignOutResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function renderAction() {
  // This root remains mounted even when the initiating hook unmounts.
  render(<StrictMode><Toaster theme="dark" duration={Infinity} /></StrictMode>);
  return renderHook(() => useSignOutAction(), { wrapper: StrictMode });
}

async function flushFeedback() {
  // Sonner publishes its visible state in a zero-delay task.
  await new Promise<void>(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  state.auth = {
    user: { id: 'first-account', email: 'first@example.invalid' },
    session: { access_token: 'first-token' },
    signOut: vi.fn<() => Promise<SignOutResult>>().mockResolvedValue({ error: null }),
  };
});

afterEach(() => {
  cleanup();
  // Dismiss fixed IDs; a delayed dismiss-all could affect the next test's toast.
  toast.getHistory().forEach(({ id }) => toast.dismiss(id));
});

describe('useSignOutAction', () => {
  it('deduplicates immediate calls from the same control before React rerenders', async () => {
    const request = deferred();
    state.auth.signOut.mockReturnValue(request.promise);
    const { result } = renderAction();
    const initialAction = result.current.runSignOut;
    let first!: Promise<void>;
    let duplicate!: Promise<void>;

    act(() => {
      first = initialAction();
      duplicate = initialAction();
      expect(state.auth.signOut).toHaveBeenCalledOnce();
    });
    await expect(duplicate).resolves.toBeUndefined();
    expect(result.current.isSigningOut).toBe(true);

    await act(async () => {
      request.resolve({ error: null });
      await first;
      await flushFeedback();
    });
    expect(result.current.isSigningOut).toBe(false);
    expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
  });

  it.each(['returned', 'rejected'] as const)('shows a visible toast for a %s error and allows an explicit retry', async (kind) => {
    if (kind === 'returned') state.auth.signOut.mockResolvedValueOnce({ error: 'Disposable wrapper failure' });
    else state.auth.signOut.mockRejectedValueOnce(new Error('Disposable wrapper rejection'));
    const { result } = renderAction();

    await act(async () => {
      await expect(result.current.runSignOut()).resolves.toBeUndefined();
    });
    expect(await screen.findByText(failureMessage)).toBeVisible();
    expect(result.current.isSigningOut).toBe(false);
    expect(state.auth.signOut).toHaveBeenCalledOnce();

    const retry = deferred();
    state.auth.signOut.mockReturnValueOnce(retry.promise);
    let retryAction!: Promise<void>;
    act(() => { retryAction = result.current.runSignOut(); });
    expect(result.current.isSigningOut).toBe(true);
    expect(state.auth.signOut).toHaveBeenCalledTimes(2);
    await act(async () => {
      retry.resolve({ error: null });
      await retryAction;
      await flushFeedback();
    });
    expect(result.current.isSigningOut).toBe(false);
    expect(screen.getAllByText(failureMessage)).toHaveLength(1);
  });

  it('retains pending state across a same-account token, session, and callback rerender', async () => {
    const request = deferred();
    const originalSignOut = state.auth.signOut.mockReturnValue(request.promise);
    const { result, rerender } = renderAction();
    let first!: Promise<void>;
    act(() => { first = result.current.runSignOut(); });

    const refreshedSignOut = vi.fn<() => Promise<SignOutResult>>().mockResolvedValue({ error: null });
    state.auth = {
      user: { id: 'first-account', email: 'refreshed@example.invalid' },
      session: { access_token: 'refreshed-token' },
      signOut: refreshedSignOut,
    };
    rerender();
    expect(result.current.isSigningOut).toBe(true);
    await act(async () => { await result.current.runSignOut(); });
    expect(originalSignOut).toHaveBeenCalledOnce();
    expect(refreshedSignOut).not.toHaveBeenCalled();

    await act(async () => {
      request.resolve({ error: 'Same-account attempt failed' });
      await first;
    });
    expect(await screen.findByText(failureMessage)).toBeVisible();
    expect(result.current.isSigningOut).toBe(false);
    await act(async () => { await result.current.runSignOut(); });
    expect(refreshedSignOut).toHaveBeenCalledOnce();
  });

  it('allows the new owner to act while suppressing the old result and preserving the new pending action', async () => {
    const oldRequest = deferred();
    const oldSignOut = state.auth.signOut.mockReturnValue(oldRequest.promise);
    const { result, rerender } = renderAction();
    let oldAction!: Promise<void>;
    act(() => { oldAction = result.current.runSignOut(); });

    const newRequest = deferred();
    const newSignOut = vi.fn<() => Promise<SignOutResult>>().mockReturnValue(newRequest.promise);
    state.auth = {
      user: { id: 'second-account', email: 'second@example.invalid' },
      session: { access_token: 'second-token' },
      signOut: newSignOut,
    };
    rerender();
    expect(result.current.isSigningOut).toBe(false);
    let newAction!: Promise<void>;
    act(() => { newAction = result.current.runSignOut(); });
    expect(oldSignOut).toHaveBeenCalledOnce();
    expect(newSignOut).toHaveBeenCalledOnce();
    expect(result.current.isSigningOut).toBe(true);

    await act(async () => {
      oldRequest.resolve({ error: 'Old account failed' });
      await expect(oldAction).resolves.toBeUndefined();
      await flushFeedback();
    });
    expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
    expect(result.current.isSigningOut).toBe(true);
    await act(async () => {
      newRequest.resolve({ error: 'New account failed' });
      await newAction;
    });
    expect(await screen.findByText(failureMessage)).toBeVisible();
    expect(screen.getAllByText(failureMessage)).toHaveLength(1);
    expect(result.current.isSigningOut).toBe(false);
  });

  it.each(['returned', 'rejected'] as const)('suppresses a %s failure after unmount and resolves the action without an unhandled rejection', async (kind) => {
    const request = deferred();
    state.auth.signOut.mockReturnValue(request.promise);
    const { result, unmount } = renderAction();
    let action!: Promise<void>;
    act(() => { action = result.current.runSignOut(); });
    unmount();

    await act(async () => {
      if (kind === 'returned') request.resolve({ error: 'Unmounted account failed' });
      else request.reject(new Error('Unmounted account rejected'));
      await expect(action).resolves.toBeUndefined();
      await flushFeedback();
    });
    // The real notification host is still present, so missing output is meaningful.
    expect(screen.getByRole('region', { name: /^Notifications/ })).toBeInTheDocument();
    expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
    expect(state.auth.signOut).toHaveBeenCalledOnce();
  });
});

// This ordinary consumer uses the hook's public action through a committed DOM
// button. The later layout effect deterministically selects the commit-before-
// passive boundary; it does not intercept React or reimplement hook state.
function CommitAction({ startAtCommit, invokeActionAtCommit = false }: { startAtCommit: boolean; invokeActionAtCommit?: boolean }) {
  const { isSigningOut, runSignOut } = useSignOutAction();
  const owner = state.auth.user.id;
  const committedAction = useRef(runSignOut);
  useLayoutEffect(() => { committedAction.current = runSignOut; }, [runSignOut]);
  const button = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (startAtCommit) {
      // An old owner's pending DOM can still be disabled during the new owner
      // commit. Exercise the new public action directly in that one case.
      if (invokeActionAtCommit) void committedAction.current();
      else button.current!.click();
    }
  }, [owner, startAtCommit, invokeActionAtCommit]);
  return <button ref={button} disabled={isSigningOut} onClick={() => { void runSignOut(); }}>{isSigningOut ? 'Signing out...' : 'Sign out'}</button>;
}

function renderAtBoundary(kind: 'initial' | 'replacement') {
  render(<Toaster duration={Infinity} />);
  if (kind === 'initial') return render(<CommitAction startAtCommit />);
  const view = render(<CommitAction startAtCommit={false} />);
  state.auth = { ...state.auth, user: { id: 'replacement-owner', email: 'replacement@example.invalid' } };
  view.rerender(<CommitAction startAtCommit />);
  return view;
}

describe.each(['initial', 'replacement'] as const)('%s owner action at the DOM commit boundary', kind => {
  it('stays visibly pending after passive effects flush', () => {
    const request = deferred(); state.auth.signOut.mockReturnValue(request.promise);
    renderAtBoundary(kind);
    expect(state.auth.signOut).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
  });
  it('does not permit a second request while the committed action is held', () => {
    const request = deferred(); state.auth.signOut.mockReturnValue(request.promise);
    renderAtBoundary(kind);
    // Click the actual committed control after both layout and passive effects.
    act(() => { screen.getByRole('button').click(); });
    expect(state.auth.signOut).toHaveBeenCalledOnce();
  });
  it('shows the current owner failure and enables an explicit retry', async () => {
    const request = deferred(); state.auth.signOut.mockReturnValue(request.promise);
    renderAtBoundary(kind);
    await act(async () => { request.resolve({ error: 'Disposable current-owner failure' }); await request.promise; });
    expect(await screen.findByText(failureMessage)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    const retry = deferred(); state.auth.signOut.mockReturnValueOnce(retry.promise);
    act(() => { screen.getByRole('button').click(); });
    expect(state.auth.signOut).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
  });
});

it('allows a replacement owner commit action while an old owner request is held, suppressing the old failure', async () => {
  const oldRequest = deferred(); const oldSignOut = state.auth.signOut.mockReturnValue(oldRequest.promise);
  render(<Toaster duration={Infinity} />);
  const view = render(<CommitAction startAtCommit={false} />);
  act(() => { screen.getByRole('button', { name: 'Sign out' }).click(); });
  expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
  const currentRequest = deferred(); const currentSignOut = vi.fn<() => Promise<SignOutResult>>().mockReturnValue(currentRequest.promise);
  state.auth = { ...state.auth, user: { id: 'replacement-owner', email: 'replacement@example.invalid' }, session: { access_token: 'replacement-token' }, signOut: currentSignOut };
  view.rerender(<CommitAction startAtCommit invokeActionAtCommit />);
  expect(oldSignOut).toHaveBeenCalledOnce();
  expect(currentSignOut).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
  await act(async () => { oldRequest.resolve({ error: 'Disposable old-owner failure' }); await oldRequest.promise; await new Promise<void>(done => setTimeout(done, 0)); });
  expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
  await act(async () => { currentRequest.resolve({ error: 'Disposable current-owner failure' }); await currentRequest.promise; });
  expect(await screen.findByText(failureMessage)).toBeVisible();
  expect(screen.getAllByText(failureMessage)).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
});

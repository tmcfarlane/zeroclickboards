import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { StrictMode } from 'react';
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

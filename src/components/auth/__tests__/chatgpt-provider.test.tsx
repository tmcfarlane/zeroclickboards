import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, useAuthContext, type AuthContextValue } from '../AuthProvider';

const fixture = vi.hoisted(() => ({
  owner: null as string | null,
  session: null as Session | null,
  initialize: vi.fn(),
  getSession: vi.fn(),
  signIn: vi.fn(),
  link: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  authSignInWithOAuth: fixture.signIn,
  authLinkIdentity: fixture.link,
  authSignInWithPassword: vi.fn(), authSignUp: vi.fn(),
  supabase: { auth: {
    initialize: fixture.initialize,
    getSession: fixture.getSession,
    getUser: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn(),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  } },
}));
vi.mock('@/store/useBoardStore', () => ({
  useBoardStore: { getState: () => ({
    currentUserId: fixture.owner,
    setCurrentUserId: (id: string | null) => { fixture.owner = id; },
  }) },
}));
vi.mock('sonner', () => ({ toast: { error: fixture.toast } }));

let context: AuthContextValue;
function Consumer() {
  const value = useAuthContext();
  useEffect(() => { context = value; }, [value]);
  return null;
}
async function mount() {
  const view = render(<AuthProvider><Consumer /></AuthProvider>);
  await waitFor(() => expect(context.isLoaded).toBe(true));
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VITE_CHATGPT_SIGN_IN_ENABLED', 'true');
  fixture.owner = null;
  fixture.session = null;
  fixture.initialize.mockResolvedValue({ error: null });
  fixture.getSession.mockImplementation(async () => ({ data: { session: fixture.session }, error: null }));
  fixture.signIn.mockResolvedValue({ error: null });
  fixture.link.mockResolvedValue({ error: null });
  window.history.replaceState(null, '', '/');
});

afterEach(() => { vi.unstubAllEnvs(); });

function signedIn() {
  fixture.session = {
    access_token: 'fixture-supabase-session', refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600,
    user: { id: 'existing-board-owner', aud: 'authenticated', created_at: '2026-10-02T00:00:00Z', app_metadata: {}, user_metadata: {} },
  };
}

describe('ChatGPT identity auth actions', () => {
  it('fails closed before the configured provider is enabled', async () => {
    vi.stubEnv('VITE_CHATGPT_SIGN_IN_ENABLED', 'false');
    await mount();
    expect(context.isChatGPTSignInEnabled).toBe(false);
    expect((await context.signInWithChatGPT()).error).toContain('not available');
    expect((await context.linkChatGPTIdentity()).error).toContain('not available');
    expect(fixture.signIn).not.toHaveBeenCalled();
    expect(fixture.link).not.toHaveBeenCalled();
  });

  it('starts native sign-in with the original connector consent context', async () => {
    window.history.replaceState(null, '', '/auth/connector?client_id=fixture-client&state=fixture-state&code_challenge=fixture-challenge');
    await mount();
    expect((await context.signInWithChatGPT()).error).toBeNull();
    expect(fixture.signIn).toHaveBeenCalledWith({
      provider: 'custom:chatgpt', options: { redirectTo: window.location.href, scopes: 'openid profile' },
    });
    expect(fixture.link).not.toHaveBeenCalled();
  });

  it('uses explicit linking for the existing board owner', async () => {
    signedIn();
    window.history.replaceState(null, '', '/account#connectors');
    await mount();
    expect((await context.signInWithChatGPT()).error).toContain('account settings');
    expect((await context.linkChatGPTIdentity()).error).toBeNull();
    expect(fixture.link).toHaveBeenCalledWith({ provider: 'custom:chatgpt', options: { redirectTo: window.location.href, scopes: 'openid profile' } });
    expect(context.user?.id).toBe('existing-board-owner');
    expect(fixture.owner).toBe('existing-board-owner');
    expect(fixture.signIn).not.toHaveBeenCalled();
  });

  it('rejects an old account action after the board owner changes', async () => {
    signedIn();
    await mount();
    fixture.owner = 'successor-account';
    expect((await context.linkChatGPTIdentity()).error).toContain('account changed');
    expect(fixture.link).not.toHaveBeenCalled();
  });

  it('keeps identity collisions explicit instead of creating or merging users', async () => {
    signedIn();
    fixture.link.mockResolvedValue({ error: { code: 'identity_already_exists', message: 'untrusted upstream detail' } });
    await mount();
    expect((await context.linkChatGPTIdentity()).error).toContain('already linked to another ZeroBoard account');
    expect(context.user?.id).toBe('existing-board-owner');
  });

  it('surfaces a native callback failure without echoing upstream data', async () => {
    window.history.replaceState(null, '', '/?state=fixture-state#error=access_denied&error_description=private-upstream-detail');
    fixture.initialize.mockResolvedValue({ error: { details: { error: 'access_denied' }, message: 'private-upstream-detail' } });
    await mount();
    expect(fixture.toast).toHaveBeenCalledWith('Sign-in was cancelled. You can try again.', { id: 'auth-callback-error' });
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?state=fixture-state');
  });

  it('does not report a callback result after the provider unmounts', async () => {
    let finish!: (value: { error: { code: string } }) => void;
    fixture.initialize.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const view = await mount();
    view.unmount();
    await act(async () => { finish({ error: { code: 'access_denied' } }); });
    expect(fixture.toast).not.toHaveBeenCalled();
  });

  it('catches an initialization rejection without exposing its private details', async () => {
    fixture.initialize.mockRejectedValue(new Error('private-lock-or-provider-detail'));
    await mount();
    expect(fixture.toast).toHaveBeenCalledWith('Could not restore your session. Reload and try again.', { id: 'auth-callback-error' });
  });
});

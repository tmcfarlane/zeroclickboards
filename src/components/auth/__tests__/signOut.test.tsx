import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { Session, SupabaseClientOptions } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { AuthProvider, useAuthContext } from '../AuthProvider';
import { AuthRedirect } from '../AuthRedirect';
import { UserProfile } from '../UserProfile';
import { AccountPage } from '@/pages/AccountPage';
import { PublicLayout } from '@/components/layout/PublicLayout';
import { AppToaster } from '@/components/layout/AppToaster';
import { supabase } from '@/lib/supabase';

const fixture = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  fetch: vi.fn<typeof fetch>(),
  responses: [] as Array<Response | Promise<Response>>,
  logoutCalls: 0,
  currentUserId: null as string | null,
  user: undefined as Session['user'] | undefined,
  signOut: undefined as (() => Promise<{ error: string | null }>) | undefined,
}));

// Restore the actual renderer; the shared setup's toast spies cannot prove that
// Account/public users see an error. SDK storage and all HTTP stay disposable.
vi.unmock('sonner');
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...sdk,
    createClient: (_url: string, _key: string, options?: SupabaseClientOptions<'public'>) => sdk.createClient('https://signout-ui-fixture.invalid', 'sb_publishable_disposable', {
      ...options,
      auth: {
        ...options?.auth,
        autoRefreshToken: false, detectSessionInUrl: false, persistSession: true,
        storage: {
          getItem: (key) => fixture.storage.get(key) ?? null,
          setItem: (key, value) => { fixture.storage.set(key, value); },
          removeItem: (key) => { fixture.storage.delete(key); },
        },
      },
      global: { fetch: fixture.fetch },
    }),
  };
});
vi.mock('@/store/useBoardStore', () => ({ useBoardStore: { getState: () => ({ setCurrentUserId: (id: string | null) => { fixture.currentUserId = id; } }) } }));
vi.mock('@/hooks/useSubscription', () => ({ useSubscription: () => ({ hasSubscription: false, subscription: null, isLoading: false }) }));
vi.mock('@/hooks/useAdmin', () => ({ useAdmin: () => ({ isAdmin: false }) }));
vi.mock('@/components/connectors/ConnectorSettings', () => ({ ConnectorSettings: () => <section>Connector fixture</section> }));

const accountId = '10000000-0000-4000-8000-000000000001';
const failureMessage = 'Could not sign out. Try again.';
const routers: ReturnType<typeof createMemoryRouter>[] = [];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function AuthStatus() {
  const { user, signOut } = useAuthContext();
  useEffect(() => { fixture.signOut = signOut; }, [signOut]);
  return <p data-testid="auth-user">{user?.id ?? 'signed-out'}</p>;
}
function renderRoot(path: string, intent?: () => void) {
  const router = createMemoryRouter([
    { path: '/account', element: <AuthRedirect requireAuth><AccountPage /></AuthRedirect> },
    { element: <PublicLayout />, children: [{ path: '/terms', element: <h1>Terms fixture</h1> }] },
    { path: '/intent', element: <UserProfile onSignInClick={() => {}} onSignOutClick={intent} /> },
    { path: '/', element: <AuthRedirect><h1>Signed-out landing</h1></AuthRedirect> },
    { path: '/app', element: <h1>Board fixture</h1> },
  ], { initialEntries: [path] });
  routers.push(router);
  render(<><AuthProvider><RouterProvider router={router} /><AuthStatus /></AuthProvider><AppToaster /></>);
  return router;
}

beforeEach(async () => {
  fixture.storage.clear(); fixture.responses.length = 0; fixture.logoutCalls = 0; fixture.currentUserId = null;
  fixture.user = { id: accountId, aud: 'authenticated', role: 'authenticated', email: 'account@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-10-02T00:00:00Z' };
  fixture.fetch.mockReset();
  fixture.fetch.mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'https://signout-ui-fixture.invalid');
    expect(url.origin).toBe('https://signout-ui-fixture.invalid');
    if (url.pathname === '/auth/v1/user') return json(fixture.user);
    if (url.pathname === '/auth/v1/logout') {
      expect(url.searchParams.get('scope')).toBe('local');
      fixture.logoutCalls++;
      const response = fixture.responses.shift();
      if (!response) throw new Error('Unexpected fixture logout');
      return response;
    }
    if (url.pathname === '/api/stripe/create-checkout') return json({ error: 'Fixture checkout unavailable' }, 500);
    throw new Error(`Unexpected disposable fixture path ${url.pathname}`);
  });
  vi.stubGlobal('fetch', fixture.fetch);
  const segment = (value: unknown) => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const token = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment({ sub: accountId, exp: Math.floor(Date.now() / 1000) + 3600, aud: 'authenticated' })}.disposable-fixture`;
  expect((await supabase.auth.setSession({ access_token: token, refresh_token: 'disposable-refresh' })).error).toBeNull();
});

afterEach(() => {
  cleanup(); toast.getHistory().forEach(({ id }) => toast.dismiss(id)); routers.splice(0).forEach(router => router.dispose());
  supabase.auth.stopAutoRefresh(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('sign-out feedback through actual SDK and the persistent toast host', () => {
  it('keeps Account signed in on failure, prevents duplicate requests, and redirects only after a successful retry', async () => {
    const held = deferred<Response>(); fixture.responses.push(held.promise);
    const router = renderRoot('/account');
    const button = await screen.findByRole('button', { name: 'Sign out' });
    await act(async () => { button.click(); button.click(); });
    await waitFor(() => expect(fixture.logoutCalls).toBe(1));
    expect(screen.getByRole('button', { name: 'Signing out...' })).toBeDisabled();
    await act(async () => { held.resolve(json({ code: 'unexpected_failure', msg: 'Disposable auth server failure' }, 500)); });
    expect(await screen.findByText(failureMessage)).toBeVisible();
    expect(router.state.location.pathname).toBe('/account'); expect(screen.getByTestId('auth-user')).toHaveTextContent(accountId);
    expect(fixture.currentUserId).toBe(accountId); expect((await supabase.auth.getSession()).data.session?.user.id).toBe(accountId);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    fixture.responses.push(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Signed-out landing' })).toBeVisible();
    expect(router.state.location.pathname).toBe('/'); expect(fixture.currentUserId).toBeNull(); expect(fixture.logoutCalls).toBe(2);
    expect((await supabase.auth.getSession()).data.session).toBeNull();
  });

  it('supports public-menu keyboard selection, visible failure, disabled pending selection and explicit retry', async () => {
    const held = deferred<Response>(); fixture.responses.push(held.promise);
    const router = renderRoot('/terms'); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await act(async () => { screen.getByRole('menuitem', { name: 'Sign out' }).focus(); }); await user.keyboard(' ');
    await waitFor(() => expect(fixture.logoutCalls).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    const pending = screen.getByRole('menuitem', { name: 'Signing out...' }); expect(pending).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { pending.focus(); }); await user.keyboard('{Enter}'); expect(fixture.logoutCalls).toBe(1);
    await act(async () => { held.resolve(json({ code: 'unexpected_failure', msg: 'Disposable auth server failure' }, 500)); });
    expect(await screen.findByText(failureMessage)).toBeVisible(); expect(router.state.location.pathname).toBe('/terms');
    expect(screen.getByTestId('auth-user')).toHaveTextContent(accountId); expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fixture.responses.push(new Response(null, { status: 204 }));
    await act(async () => { screen.getByRole('menuitem', { name: 'Sign out' }).focus(); }); await user.keyboard('{Enter}');
    expect(await screen.findByRole('button', { name: 'Sign In' })).toBeVisible(); expect(router.state.location.pathname).toBe('/terms');
    expect(fixture.logoutCalls).toBe(2); expect(screen.getByTestId('auth-user')).toHaveTextContent('signed-out');
  });

  it('normalizes an unexpected rejected SDK call into the intentional sign-out contract', async () => {
    renderRoot('/account'); await screen.findByRole('button', { name: 'Sign out' });
    const reject = vi.spyOn(supabase.auth, 'signOut').mockRejectedValueOnce(new Error('Disposable SDK rejection'));
    await act(async () => { expect(await fixture.signOut!()).toEqual({ error: failureMessage }); });
    expect(reject).toHaveBeenCalledWith({ scope: 'local' }); reject.mockRestore();
    expect(screen.getByTestId('auth-user')).toHaveTextContent(accountId); expect((await supabase.auth.getSession()).data.session?.user.id).toBe(accountId);
    fixture.responses.push(new Response(null, { status: 204 }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Signed-out landing' })).toBeVisible();
  });

  it('does not let a failed departed Account action redirect or notify the newly visited route', async () => {
    const held = deferred<Response>(); fixture.responses.push(held.promise);
    const router = renderRoot('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(fixture.logoutCalls).toBe(1));
    await act(async () => { await router.navigate('/terms'); }); expect(screen.getByRole('heading', { name: 'Terms fixture' })).toBeVisible();
    await act(async () => { held.resolve(json({ code: 'unexpected_failure', msg: 'Disposable auth server failure' }, 500)); });
    await waitFor(() => expect((supabase.auth.getSession())).resolves.toMatchObject({ data: { session: { user: { id: accountId } } } }));
    expect(router.state.location.pathname).toBe('/terms'); expect(screen.queryByText(failureMessage)).not.toBeInTheDocument();
  });

  it('renders an existing billing error through one host that survives Account-to-public navigation', async () => {
    const router = renderRoot('/account');
    await userEvent.click(await screen.findByRole('button', { name: 'Upgrade to Pro — $3/mo' }));
    expect(await screen.findByText('Fixture checkout unavailable')).toBeVisible(); expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
    await act(async () => { await router.navigate('/terms'); });
    expect(screen.getByText('Fixture checkout unavailable')).toBeVisible(); expect(document.querySelectorAll('[data-sonner-toaster]')).toHaveLength(1);
  });

  it('delegates the optional draft intent without calling or starting the default sign-out action', async () => {
    const intent = vi.fn(); renderRoot('/intent', intent); const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Account menu' }));
    await act(async () => { screen.getByRole('menuitem', { name: 'Sign out' }).focus(); }); await user.keyboard('{Enter}');
    expect(intent).toHaveBeenCalledOnce(); expect(fixture.logoutCalls).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Account menu' }));
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).not.toHaveAttribute('aria-disabled', 'true');
    expect(screen.queryByRole('menuitem', { name: 'Signing out...' })).not.toBeInTheDocument();
  });
});

import { createContext, StrictMode, useContext } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { ConnectorSettings } from '../ConnectorSettings';
import { ConnectorConsentPage } from '@/pages/ConnectorConsentPage';

const state = vi.hoisted(() => ({ fetch: vi.fn(), auth: { isSignedIn: true, isLoaded: true, session: null as Session | null, user: null as Session['user'] | null } }));
const authChanges = createContext(0);
vi.mock('@/lib/apiFetch', () => ({ apiFetch: state.fetch }));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuthContext: () => { useContext(authChanges); return state.auth; } }));
vi.mock('@/components/auth/SignInModal', () => ({ SignInModal: () => null }));

const callback = 'https://client.example.invalid/callback?code=fixture&state=original';
const consent = { clientName: 'First client', scopes: ['boards:read'], expiresAt: '2026-10-03T00:00:00Z', boards: [{ id: 'personal', name: 'Personal board', canAddCards: true }] };
const nextConsent = { ...consent, clientName: 'Next client', boards: [{ id: 'next-board', name: 'Next board', canAddCards: true }] };
const grant = { id: 'grant-a', clientName: 'First client', boardIds: ['personal'], scopes: ['boards:read'], expiresAt: '2026-10-03T00:00:00Z' };
const nextGrant = { ...grant, id: 'grant-b', clientName: 'Next client' };
const status = { available: true, endpoint: 'https://board.example.invalid/mcp', connections: [grant] };

function session(id = 'account-a', token = 'token-a'): Session {
  return { access_token: token, refresh_token: 'fixture-refresh', token_type: 'bearer', expires_in: 3600,
    user: { id, email: `${id}@example.invalid`, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-02T00:00:00Z' } };
}
function response(body: unknown, code = 200) { return new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function navigationSpy() {
  const assign = vi.fn();
  vi.stubGlobal('window', new Proxy(window, { get(target, property) { return property === 'location' ? { assign } : Reflect.get(target, property, target); } }));
  return assign;
}
function fixture(path = '/auth/connector?request=first', strict = false) {
  const router = createMemoryRouter([
    { path: '/auth/connector', element: <ConnectorConsentPage /> },
    { path: '/account', element: <ConnectorSettings /> },
    { path: '/app', element: <p>Board destination</p> },
  ], { initialEntries: [path] });
  let revision = 0;
  const tree = () => <authChanges.Provider value={revision}>{strict ? <StrictMode><RouterProvider router={router} /></StrictMode> : <RouterProvider router={router} />}</authChanges.Provider>;
  const view = render(tree());
  return { router, view, replace(next: Session) { state.auth.session = next; state.auth.user = next.user; revision++; view.rerender(tree()); } };
}
const posts = () => state.fetch.mock.calls.filter(([, options]) => options.method === 'POST');

beforeEach(() => {
  vi.clearAllMocks(); state.auth.session = session(); state.auth.user = state.auth.session.user; state.auth.isSignedIn = true; state.auth.isLoaded = true;
});
afterEach(() => vi.unstubAllGlobals());

describe('consent owner lifetime', () => {
  for (const owner of ['exit', 'request', 'account'] as const) {
    for (const outcome of ['success', 'error'] as const) {
      it(`ignores ${outcome} approval after ${owner} replacement`, async () => {
        const held = deferred<Response>(); const assign = navigationSpy();
        state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? held.promise : Promise.resolve(response(options.session.user.id === 'account-b' || _url.includes('request=next') ? nextConsent : consent)));
        const ui = fixture(); const user = userEvent.setup();
        await user.click(await screen.findByRole('checkbox', { name: 'Personal board' })); await user.click(screen.getByRole('button', { name: 'Allow connection' }));
        expect(posts()).toHaveLength(1);
        if (owner === 'account') ui.replace(session('account-b', 'token-b'));
        else await act(() => ui.router.navigate(owner === 'exit' ? '/app' : '/auth/connector?request=next'));
        if (owner === 'exit') expect(screen.getByText('Board destination')).toBeInTheDocument();
        else { await screen.findByRole('heading', { name: 'Connect Next client to ZeroBoard' }); expect(screen.getByRole('checkbox', { name: 'Next board' })).not.toBeChecked(); }
        await act(() => held.resolve(response(outcome === 'success' ? { redirectUrl: callback } : { error: 'Obsolete approval failure' }, outcome === 'success' ? 200 : 503)));
        expect(assign).not.toHaveBeenCalled(); expect(screen.queryByText('Obsolete approval failure')).not.toBeInTheDocument();
        if (owner !== 'exit') { await user.click(screen.getByRole('checkbox', { name: 'Next board' })); expect(screen.getByRole('button', { name: 'Allow connection' })).toBeEnabled(); }
      });
    }
  }

  it('drops completed cancellation and its callback when the request changes on the same router', async () => {
    state.fetch.mockImplementation((_url, options) => Promise.resolve(response(options.method === 'POST' ? { cancelled: true, redirectUrl: callback } : _url.includes('request=next') ? nextConsent : consent)));
    const ui = fixture(); await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: 'Return to First client' })).toBeInTheDocument();
    await act(() => ui.router.navigate('/auth/connector?request=next'));
    await screen.findByRole('heading', { name: 'Connect Next client to ZeroBoard' });
    expect(screen.queryByRole('heading', { name: 'Connection cancelled' })).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Return to/ })).not.toBeInTheDocument();
  });

  it.each([
    ['request', 'success'], ['request', 'error'], ['account', 'success'], ['account', 'error'],
  ] as const)('ignores obsolete cancellation after %s replacement (%s) without locking a successor mutation', async (owner, outcome) => {
    const old = deferred<Response>(); const current = deferred<Response>();
    state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? (JSON.parse(options.body).request === 'first' && options.session.user.id === 'account-a' ? old.promise : current.promise) : Promise.resolve(response(_url.includes('request=next') || options.session.user.id === 'account-b' ? nextConsent : consent)));
    const ui = fixture(); const user = userEvent.setup(); await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    if (owner === 'account') ui.replace(session('account-b', 'token-b'));
    else await act(() => ui.router.navigate('/auth/connector?request=next'));
    await user.click(await screen.findByRole('checkbox', { name: 'Next board' })); await user.click(screen.getByRole('button', { name: 'Allow connection' }));
    await act(() => old.resolve(response(outcome === 'success' ? { cancelled: true, redirectUrl: callback } : { error: 'Obsolete cancellation failure' }, outcome === 'success' ? 200 : 503)));
    expect(screen.getByRole('button', { name: 'Connecting…' })).toBeDisabled(); expect(screen.queryByText('Obsolete cancellation failure')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: /Return to/ })).not.toBeInTheDocument();
    await act(() => current.resolve(response({ error: 'Current approval failure' }, 503))); expect(await screen.findByRole('alert')).toHaveTextContent('Current approval failure');
  });

  it('ignores consent JSON decoding that finishes after its owner was replaced', async () => {
    const decoded = deferred<unknown>(); const old = response(consent); vi.spyOn(old, 'json').mockImplementation(() => decoded.promise);
    state.fetch.mockResolvedValueOnce(old).mockResolvedValueOnce(response(nextConsent));
    const ui = fixture(); await waitFor(() => expect(old.json).toHaveBeenCalled());
    await act(() => ui.router.navigate('/auth/connector?request=next')); await screen.findByRole('heading', { name: 'Connect Next client to ZeroBoard' });
    await act(() => decoded.resolve(consent)); expect(screen.queryByText('Personal board')).not.toBeInTheDocument();
  });

  it('preserves selected boards across same-account renewal and uses the new token for the next click', async () => {
    state.fetch.mockImplementation((_url, options) => Promise.resolve(response(options.method === 'POST' ? { error: 'Retryable failure' } : consent, options.method === 'POST' ? 503 : 200)));
    const ui = fixture(); await userEvent.click(await screen.findByRole('checkbox', { name: 'Personal board' }));
    ui.replace(session('account-a', 'renewed-token')); await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Personal board' })).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: 'Allow connection' })); expect(posts()).toHaveLength(1); expect(posts()[0][1].session.access_token).toBe('renewed-token');
    await screen.findByText('Retryable failure');
  });

  it.each(['approve', 'cancel'] as const)('preserves held %s through token renewal and unrelated query/hash changes', async action => {
    const held = deferred<Response>(); const assign = navigationSpy(); state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? held.promise : Promise.resolve(response(consent)));
    const ui = fixture(); const user = userEvent.setup(); await user.click(await screen.findByRole('checkbox', { name: 'Personal board' })); await user.click(screen.getByRole('button', { name: action === 'approve' ? 'Allow connection' : 'Cancel' }));
    ui.replace(session('account-a', 'renewed-token')); await act(() => ui.router.navigate('/auth/connector?request=first&tracking=irrelevant#details'));
    expect(screen.getByRole('checkbox', { name: 'Personal board' })).toBeChecked(); expect(screen.getByRole('button', { name: action === 'approve' ? 'Connecting…' : 'Cancelling…' })).toBeDisabled(); expect(posts()).toHaveLength(1);
    await act(() => held.resolve(response(action === 'approve' ? { redirectUrl: callback } : { cancelled: true, redirectUrl: callback })));
    if (action === 'approve') expect(assign).toHaveBeenCalledExactlyOnceWith(callback); else expect(await screen.findByRole('link', { name: 'Return to First client' })).toBeInTheDocument();
  });

  it('retains the selection after old-token failure and dispatches only a deliberate renewed-token retry', async () => {
    const held = deferred<Response>(); state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? posts().length === 1 ? held.promise : Promise.resolve(response({ error: 'Second failure' }, 503)) : Promise.resolve(response(consent)));
    const ui = fixture(); await userEvent.click(await screen.findByRole('checkbox', { name: 'Personal board' })); await userEvent.click(screen.getByRole('button', { name: 'Allow connection' })); ui.replace(session('account-a', 'renewed-token'));
    await act(() => held.resolve(response({ error: 'Sign in to manage connections' }, 401))); expect(await screen.findByRole('alert')).toHaveTextContent('Sign in'); expect(screen.getByRole('checkbox', { name: 'Personal board' })).toBeChecked(); expect(posts()).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Allow connection' })); expect(posts()).toHaveLength(2); expect(posts()[1][1].session.access_token).toBe('renewed-token'); await screen.findByText('Second failure');
  });

  it.each(['approve', 'cancel'] as const)('dispatches one synchronous %s despite duplicate native click events', async action => {
    const held = deferred<Response>(); state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? held.promise : Promise.resolve(response(consent)));
    fixture(); await userEvent.click(await screen.findByRole('checkbox', { name: 'Personal board' })); const button = screen.getByRole('button', { name: action === 'approve' ? 'Allow connection' : 'Cancel' });
    act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(posts()).toHaveLength(1);
    await act(() => held.resolve(response({ error: 'Retry allowed' }, 503))); expect(await screen.findByRole('alert')).toHaveTextContent('Retry allowed');
  });

  it('prevents cancellation from racing a synchronous approval click', async () => {
    const held = deferred<Response>(); state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? held.promise : Promise.resolve(response(consent)));
    fixture(); await userEvent.click(await screen.findByRole('checkbox', { name: 'Personal board' }));
    const allow = screen.getByRole('button', { name: 'Allow connection' }); const cancel = screen.getByRole('button', { name: 'Cancel' });
    act(() => { fireEvent.click(allow); fireEvent.click(cancel); }); expect(posts()).toHaveLength(1); expect(JSON.parse(posts()[0][1].body).action).toBe('approve');
    await act(() => held.resolve(response({ error: 'Retry allowed' }, 503))); await screen.findByText('Retry allowed');
  });

  it('cleans a StrictMode owner without reviving its departed approval', async () => {
    const held = deferred<Response>(); const assign = navigationSpy(); state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? held.promise : Promise.resolve(response(consent)));
    const ui = fixture(undefined, true); await userEvent.click(await screen.findByRole('checkbox', { name: 'Personal board' })); await userEvent.click(screen.getByRole('button', { name: 'Allow connection' }));
    await act(() => ui.router.navigate('/app')); await act(() => ui.router.navigate('/auth/connector?request=first')); await screen.findByRole('heading', { name: 'Connect First client to ZeroBoard' });
    await act(() => held.resolve(response({ redirectUrl: callback }))); expect(assign).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Allow connection' })).toBeDisabled();
  });
});

describe('settings owner and authoritative reconciliation', () => {
  it('removes a previous account confirmation before the new settings read completes', async () => {
    const next = deferred<Response>(); state.fetch.mockResolvedValueOnce(response(status)).mockImplementationOnce(() => next.promise);
    const ui = fixture('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' })); ui.replace(session('account-b', 'token-b'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(screen.queryByText('First client')).not.toBeInTheDocument();
    await act(() => next.resolve(response({ ...status, connections: [nextGrant] }))); await screen.findByText('Next client');
  });

  it.each(['success', 'error'] as const)('ignores an old revoke %s while a successor confirmation is pending', async outcome => {
    const old = deferred<Response>(); const current = deferred<Response>();
    state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? options.session.user.id === 'account-a' ? old.promise : current.promise : Promise.resolve(response({ ...status, connections: [options.session.user.id === 'account-a' ? grant : nextGrant] })));
    const ui = fixture('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' })); await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    ui.replace(session('account-b', 'token-b')); await screen.findByText('Next client'); await userEvent.click(screen.getByRole('button', { name: 'Disconnect' })); await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await act(() => old.resolve(response(outcome === 'success' ? { success: true } : { error: 'Old disconnect failure' }, outcome === 'success' ? 200 : 503)));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Next client'); expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnecting…' })).toBeDisabled(); expect(screen.queryByText('Old disconnect failure')).not.toBeInTheDocument();
    await act(() => current.resolve(response({ error: 'Current disconnect failure' }, 503))); expect(await screen.findByRole('alert')).toHaveTextContent('Current disconnect failure');
  });

  it.each(['resolve', 'reject'] as const)('ignores old-account clipboard %s after identity replacement', async outcome => {
    const held = deferred<void>(); let reject!: (reason: Error) => void; const promise = outcome === 'resolve' ? held.promise : new Promise<void>((_done, fail) => { reject = fail; });
    const user = userEvent.setup(); vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(() => promise); state.fetch.mockImplementation(() => Promise.resolve(response(status))); const ui = fixture('/account');
    await user.click(await screen.findByRole('button', { name: 'Copy URL' })); ui.replace(session('account-b', 'token-b')); await screen.findByRole('button', { name: 'Copy URL' });
    await act(() => outcome === 'resolve' ? held.resolve() : reject(new Error('Old clipboard failure'))); expect(screen.queryByRole('button', { name: 'URL copied' })).not.toBeInTheDocument(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('invalidates a held read and defers renewal reads until a revoke settles', async () => {
    const decoded = deferred<unknown>(); const read = response(status); vi.spyOn(read, 'json').mockImplementation(() => decoded.promise); const revoke = deferred<Response>(); let reads = 0;
    state.fetch.mockImplementation((_url, options) => options.method === 'POST' ? revoke.promise : Promise.resolve(++reads === 1 ? response(status) : reads === 2 ? read : response({ ...status, connections: [] })));
    const ui = fixture('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' })); ui.replace(session('account-a', 'renewed-1')); await waitFor(() => expect(read.json).toHaveBeenCalled());
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' })); ui.replace(session('account-a', 'renewed-2')); expect(reads).toBe(2);
    await act(() => decoded.resolve(status)); expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnecting…' })).toBeDisabled();
    await act(() => revoke.resolve(response({ success: true }))); await screen.findByText(/No approved access yet/); expect(reads).toBe(3); expect(state.fetch.mock.calls.at(-1)?.[1].session.access_token).toBe('renewed-2'); expect(posts()).toHaveLength(1); expect(screen.queryByText('First client')).not.toBeInTheDocument();
  });

  it('reconciles authoritative absence after a revoke POST fails without replaying it', async () => {
    state.fetch.mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({ error: 'Could not finish disconnecting. Check approved access.' }, 503)).mockResolvedValueOnce(response({ ...status, connections: [] }));
    fixture('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' })); await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await screen.findByText(/No approved access yet/); expect(screen.getByRole('alert')).toHaveTextContent('Could not finish disconnecting'); expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(posts()).toHaveLength(1);
  });

  it.each(['failed', 'malformed'] as const)('keeps an acknowledged revoke after %s reconciliation and unlocks read-only retry', async outcome => {
    state.fetch.mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({ success: true })).mockResolvedValueOnce(response(outcome === 'failed' ? { error: 'Unable to refresh access' } : { ...status, connections: null }, outcome === 'failed' ? 503 : 200)).mockResolvedValueOnce(response({ ...status, connections: [] }));
    fixture('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' })); await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(outcome === 'failed' ? 'Unable to refresh access' : 'invalid response'); expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); await userEvent.click(screen.getByRole('button', { name: 'Try again' })); await screen.findByText(/No approved access yet/); expect(posts()).toHaveLength(1);
  });

  it('guards duplicate revoke clicks synchronously and permits one intentional retry', async () => {
    const held = deferred<Response>(); let revoked = false;
    state.fetch.mockImplementation((_url, options) => {
      if (options.method !== 'POST') return Promise.resolve(response({ ...status, connections: revoked ? [] : [grant] }));
      if (posts().length === 1) return held.promise;
      revoked = true;
      return Promise.resolve(response({ success: true }));
    });
    const ui = fixture('/account'); await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' })); const button = within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' });
    act(() => { fireEvent.click(button); fireEvent.click(button); }); expect(posts()).toHaveLength(1); await act(() => held.resolve(response({ error: 'Current failure' }, 503))); await screen.findByText('Current failure'); expect(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    ui.replace(session('account-a', 'renewed-token'));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    await screen.findByText(/No approved access yet/);
    expect(posts()).toHaveLength(2);
    expect(posts()[1][1].session.access_token).toBe('renewed-token');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

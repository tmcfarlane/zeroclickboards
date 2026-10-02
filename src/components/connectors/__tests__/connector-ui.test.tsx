import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { ConnectorSettings } from '../ConnectorSettings';
import { ConnectorConsentPage } from '@/pages/ConnectorConsentPage';

const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  auth: { isSignedIn: true, isLoaded: true, session: { access_token: 'account-token' } as Session | null, user: { email: 'owner@example.com' } },
}));

vi.mock('@/lib/apiFetch', () => ({ apiFetch: state.fetch }));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuthContext: () => state.auth }));
vi.mock('@/components/auth/SignInModal', () => ({ SignInModal: ({ isOpen }: { isOpen: boolean }) => isOpen ? <p>Sign-in dialog</p> : null }));

const consent = {
  clientName: 'ChatGPT',
  scopes: ['boards:read', 'cards:add'],
  expiresAt: '2026-10-02T04:15:00Z',
  boards: [
    { id: 'personal', name: 'Personal website', canAddCards: true },
    { id: 'planning', name: 'Team planning', canAddCards: true },
    { id: 'viewer', name: 'Read-only board', canAddCards: false },
  ],
};
const connection = { id: 'connection-1', clientName: 'ChatGPT', boardIds: ['personal'], scopes: ['boards:read', 'cards:add'], expiresAt: '2026-10-02T04:15:00Z' };
const status = { available: true, endpoint: 'https://board.example.com/mcp', connections: [] };

function response(body: unknown, statusCode = 200) {
  return new Response(JSON.stringify(body), { status: statusCode, headers: { 'Content-Type': 'application/json' } });
}

function renderConsent(path = '/auth/connector?request=pending-1') {
  return render(<MemoryRouter initialEntries={[path]}><ConnectorConsentPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  state.auth.isSignedIn = true;
  state.auth.isLoaded = true;
  state.auth.session = { access_token: 'account-token' } as Session;
});
afterEach(() => vi.unstubAllGlobals());

function captureNavigation() {
  const assign = vi.fn();
  // JSDOM's Location is non-configurable. Observe only the component's explicit
  // navigation call while leaving the document and event APIs on the real window.
  vi.stubGlobal('window', new Proxy(window, { get(target, property) {
    return property === 'location' ? { assign } : Reflect.get(target, property, target);
  } }));
  return assign;
}

describe('connector consent', () => {
  it('requires explicit board selection and submits only selected eligible boards', async () => {
    state.fetch.mockResolvedValueOnce(response(consent)).mockResolvedValueOnce(response({ redirectUrl: 'javascript:alert(1)' }));
    const user = userEvent.setup();
    renderConsent();
    expect(await screen.findByRole('heading', { name: 'Connect ChatGPT to ZeroBoard' })).toBeInTheDocument();
    const allow = screen.getByRole('button', { name: 'Allow connection' });
    expect(allow).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Personal website' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Read-only board/ })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Personal website' }));
    await user.click(allow);
    await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(2));
    const init = state.fetch.mock.calls[1][1];
    expect(init.session).toBe(state.auth.session);
    expect(JSON.parse(init.body)).toEqual({ action: 'approve', request: 'pending-1', boardIds: ['personal'] });
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid return address');
  });

  it('permits a viewer board for read-only access', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...consent, scopes: ['boards:read'] }));
    const user = userEvent.setup();
    renderConsent();
    const viewer = await screen.findByRole('checkbox', { name: 'Read-only board' });
    expect(viewer).toBeEnabled();
    await user.click(viewer);
    expect(screen.getByRole('button', { name: 'Allow connection' })).toBeEnabled();
  });

  it('cancels the pending request without granting board access', async () => {
    state.fetch.mockResolvedValueOnce(response(consent)).mockResolvedValueOnce(response({ cancelled: true }));
    const user = userEvent.setup();
    renderConsent();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Connection cancelled' })).toBeInTheDocument();
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ action: 'cancel', request: 'pending-1' });
  });

  it('offers the registered client callback after cancellation', async () => {
    state.fetch.mockResolvedValueOnce(response(consent)).mockResolvedValueOnce(response({ cancelled: true, redirectUrl: 'https://chatgpt.example.com/callback?error=access_denied&state=original' }));
    const user = userEvent.setup();
    renderConsent();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('link', { name: 'Return to ChatGPT' })).toHaveAttribute('href', 'https://chatgpt.example.com/callback?error=access_denied&state=original');
  });

  it('returns native approval to the active loopback listener after explicit selection', async () => {
    const callback = 'http://127.0.0.1:54321/callback?code=fixture&state=original&iss=https%3A%2F%2Fboard.example.com%2F';
    state.fetch.mockResolvedValueOnce(response({ ...consent, clientName: 'Codex native' })).mockResolvedValueOnce(response({ redirectUrl: callback }));
    const user = userEvent.setup();
    renderConsent();
    await user.click(await screen.findByRole('checkbox', { name: 'Personal website' }));
    const assign = captureNavigation();
    await user.click(screen.getByRole('button', { name: 'Allow connection' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith(callback));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers the native denial callback without following it automatically', async () => {
    const callback = 'http://127.0.0.1:54322/callback?error=access_denied&state=original&iss=https%3A%2F%2Fboard.example.com%2F';
    state.fetch.mockResolvedValueOnce(response({ ...consent, clientName: 'Codex native' })).mockResolvedValueOnce(response({ cancelled: true, redirectUrl: callback }));
    const user = userEvent.setup();
    renderConsent();
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    const assign = captureNavigation();
    await user.click(cancel);
    expect(await screen.findByRole('link', { name: 'Return to Codex native' })).toHaveAttribute('href', callback);
    expect(assign).not.toHaveBeenCalled();
  });

  it.each([
    'http://localhost:54321/callback?code=fixture', 'http://2130706433:54321/callback?code=fixture',
    'http://user:pass@127.0.0.1:54321/callback?code=fixture', 'http://127.0.0.1:54321/callback?code=fixture#fragment',
    'https://user:pass@client.example.com/callback?code=fixture',
  ])('rejects an unsafe approval address without navigating: %s', async callback => {
    state.fetch.mockResolvedValueOnce(response(consent)).mockResolvedValueOnce(response({ redirectUrl: callback }));
    const user = userEvent.setup();
    renderConsent();
    await user.click(await screen.findByRole('checkbox', { name: 'Personal website' }));
    const assign = captureNavigation();
    await user.click(screen.getByRole('button', { name: 'Allow connection' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid return address');
    expect(assign).not.toHaveBeenCalled();
  });

  it('completes cancellation without offering an unsafe native return link', async () => {
    state.fetch.mockResolvedValueOnce(response(consent)).mockResolvedValueOnce(response({ cancelled: true, redirectUrl: 'http://2130706433:54321/callback?error=access_denied' }));
    const user = userEvent.setup();
    renderConsent();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('heading', { name: 'Connection cancelled' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Return to ChatGPT' })).not.toBeInTheDocument();
  });

  it.each(['cards:delete', 'constructor', 'toString', '__proto__'])('fails closed for unsupported permission %s', async scope => {
    state.fetch.mockResolvedValueOnce(response({ ...consent, scopes: ['boards:read', scope] }));
    renderConsent();
    expect(await screen.findByRole('alert')).toHaveTextContent('unsupported permission');
    expect(screen.getByRole('button', { name: 'Allow connection' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Personal website' })).toBeDisabled();
  });

  it('shows expired request failures and never offers approval', async () => {
    state.fetch.mockResolvedValueOnce(response({ error: 'This connection request has expired.' }, 410));
    renderConsent();
    expect(await screen.findByRole('alert')).toHaveTextContent('has expired');
    expect(screen.queryByRole('button', { name: 'Allow connection' })).not.toBeInTheDocument();
    expect(screen.getByText(/restart the connection in ChatGPT or Codex/)).toBeInTheDocument();
  });

  it('keeps the request on the sign-in page and loads it after authentication', async () => {
    state.auth.isSignedIn = false;
    state.auth.session = null;
    state.fetch.mockResolvedValueOnce(response(consent));
    const user = userEvent.setup();
    const view = renderConsent();
    await user.click(screen.getByRole('button', { name: 'Sign in to continue' }));
    expect(screen.getByText('Sign-in dialog')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    state.auth.isSignedIn = true;
    state.auth.session = { access_token: 'account-token' } as Session;
    view.rerender(<MemoryRouter initialEntries={['/auth/connector?request=pending-1']}><ConnectorConsentPage /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Connect ChatGPT to ZeroBoard' })).toBeInTheDocument();
    expect(state.fetch.mock.calls[0][0]).toBe('/api/connector?action=consent&request=pending-1');
  });
});

describe('connection settings', () => {
  it('copies the setup URL without claiming the account is connected', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    state.fetch.mockResolvedValueOnce(response(status));
    render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Copy URL' }));
    expect(copy).toHaveBeenCalledWith('https://board.example.com/mcp');
    expect(screen.getByRole('status')).toHaveTextContent('Complete setup in your client to connect');
    expect(screen.getByText(/No approved access yet/)).toBeInTheDocument();
  });

  it('shows service availability honestly without an enabled setup URL', async () => {
    state.fetch.mockResolvedValueOnce(response({ available: false, endpoint: null, connections: [], reason: 'Connection configuration is incomplete.' }));
    render(<ConnectorSettings />);
    expect(await screen.findByText('Connection service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Connection configuration is incomplete.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy URL' })).not.toBeInTheDocument();
    expect(screen.getByText(/Approved access cannot currently be checked/)).toBeInTheDocument();
    expect(screen.queryByText(/No approved access yet|Your boards stay private/)).not.toBeInTheDocument();
  });

  it('retains provided approval rows when the service cannot check access', async () => {
    state.fetch.mockResolvedValueOnce(response({ available: false, endpoint: null, connections: [connection] }));
    render(<ConnectorSettings />);
    expect(await screen.findByText('ChatGPT')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    expect(screen.queryByText(/No approved access yet|Your boards stay private/)).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'])('ignores a pending ID copy that completes after changing client (%s)', async outcome => {
    const user = userEvent.setup();
    let finish!: () => void;
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
      finish = () => outcome === 'resolve' ? resolve() : reject(new Error('Clipboard denied'));
    }));
    state.fetch.mockResolvedValueOnce(response({ ...status, clients: [
      { name: 'Web', clientId: 'web-id', callbackKinds: ['chatgpt'] },
      { name: 'Native', clientId: 'native-id', callbackKinds: ['native'] },
    ] }));
    render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Copy client ID' }));
    expect(copy).toHaveBeenCalledWith('web-id');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Client' }), 'native-id');
    await act(async () => finish());
    expect(screen.getByLabelText('Native OAuth client ID')).toHaveValue('native-id');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('ignores a pending copy after the account session changes', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    state.fetch.mockResolvedValueOnce(response(status)).mockResolvedValueOnce(response({ ...status, endpoint: 'https://new.example.com/mcp' }));
    const view = render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Copy URL' }));
    state.auth.session = { access_token: 'new-account-token' } as Session;
    view.rerender(<ConnectorSettings />);
    await waitFor(() => expect(screen.getByLabelText('Connection URL')).toHaveValue('https://new.example.com/mcp'));
    await act(async () => finish());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
  });

  it('clears a prior copy success when clipboard access fails', async () => {
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    state.fetch.mockResolvedValueOnce(response(status));
    render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Copy URL' }));
    copy.mockRejectedValueOnce(new Error('Clipboard blocked'));
    await user.click(screen.getByRole('button', { name: 'URL copied' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Copy was blocked');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy URL' })).toBeInTheDocument();
  });

  it('shows required IDs and the right setup by callback capabilities, even with misleading names', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, clients: [
      { name: 'Codex', clientId: 'chatgpt-public-client', callbackKinds: ['chatgpt'] },
      { name: 'ChatGPT', clientId: 'codex-public-client', callbackKinds: ['native'] },
    ] }));
    const user = userEvent.setup();
    const copy = vi.spyOn(navigator.clipboard, 'writeText');
    render(<ConnectorSettings />);
    expect(await screen.findByLabelText('Codex OAuth client ID')).toHaveValue('chatgpt-public-client');
    expect(screen.getByRole('heading', { name: 'ChatGPT web setup' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Codex app & CLI setup' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy client ID' }));
    expect(copy).toHaveBeenLastCalledWith('chatgpt-public-client');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Client' }), 'codex-public-client');
    expect(screen.getByLabelText('ChatGPT OAuth client ID')).toHaveValue('codex-public-client');
    expect(screen.queryByRole('heading', { name: 'ChatGPT web setup' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Codex app & CLI setup' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy Codex command' }));
    expect(copy).toHaveBeenLastCalledWith("codex mcp add zeroboard --url 'https://board.example.com/mcp' --oauth-client-id 'codex-public-client' --oauth-resource 'https://board.example.com/mcp'");
    expect(screen.getByRole('status')).toHaveTextContent('Command copied. Complete setup in your client');
    expect(screen.getByText(/required OAuth client ID/)).toBeInTheDocument();
    expect(screen.getByText(/no client secret is needed/)).toBeInTheDocument();
  });

  it('does not offer compatible setup for an unrelated registered callback', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, clients: [{ name: 'ChatGPT', clientId: 'custom-client', callbackKinds: [] }] }));
    render(<ConnectorSettings />);
    expect(await screen.findByText(/no configured ChatGPT web or default native Codex client/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Codex command' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'ChatGPT web setup' })).not.toBeInTheDocument();
  });

  it('fails closed for an unknown server-provided setup capability', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, clients: [{ name: 'Unknown', clientId: 'client', callbackKinds: ['automatic'] }] }));
    render(<ConnectorSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid response');
    expect(screen.queryByRole('button', { name: 'Copy client ID' })).not.toBeInTheDocument();
  });

  it('presents a live grant as approved access without claiming completed client sign-in', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, connections: [connection] }));
    render(<ConnectorSettings />);
    expect(await screen.findByRole('heading', { name: 'Approved access' })).toBeInTheDocument();
    expect(screen.getByText(/Approval alone does not confirm the client is connected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });

  it('asks before revoking and removes the connection only after server confirmation', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, connections: [connection] })).mockResolvedValueOnce(response({ success: true }));
    const user = userEvent.setup();
    render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('alertdialog');
    expect(state.fetch).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/No approved access yet/)).toBeInTheDocument();
    expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual({ action: 'revoke', connectionId: 'connection-1' });
  });

  it('keeps the connection and confirmation dialog when revocation fails', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, connections: [connection] })).mockResolvedValueOnce(response({ error: 'Unable to disconnect right now.' }, 503));
    const user = userEvent.setup();
    render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to disconnect');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText(/No approved access yet/)).not.toBeInTheDocument();
  });
});

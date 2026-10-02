import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('fails closed for unsupported permissions', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...consent, scopes: ['boards:read', 'cards:delete'] }));
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
    expect(screen.getByText(/No connections yet/)).toBeInTheDocument();
  });

  it('shows service availability honestly without an enabled setup URL', async () => {
    state.fetch.mockResolvedValueOnce(response({ available: false, endpoint: null, connections: [], reason: 'Connection configuration is incomplete.' }));
    render(<ConnectorSettings />);
    expect(await screen.findByText('Connection service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Connection configuration is incomplete.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy URL' })).not.toBeInTheDocument();
  });

  it('shows registered public client IDs only when configuration is available', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, clients: [{ name: 'ChatGPT', clientId: 'chatgpt-public-client' }, { name: 'Codex', clientId: 'codex-public-client' }] }));
    const user = userEvent.setup();
    render(<ConnectorSettings />);
    await user.click(await screen.findByText('OAuth setup details'));
    expect(screen.getByLabelText('ChatGPT OAuth client ID')).toHaveValue('chatgpt-public-client');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Client' }), 'codex-public-client');
    expect(screen.getByLabelText('Codex OAuth client ID')).toHaveValue('codex-public-client');
    expect(screen.getByText(/no client secret is needed/)).toBeInTheDocument();
  });

  it('asks before revoking and removes the connection only after server confirmation', async () => {
    state.fetch.mockResolvedValueOnce(response({ ...status, connections: [connection] })).mockResolvedValueOnce(response({ revoked: true }));
    const user = userEvent.setup();
    render(<ConnectorSettings />);
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }));
    const dialog = screen.getByRole('alertdialog');
    expect(state.fetch).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/No connections yet/)).toBeInTheDocument();
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
    expect(screen.queryByText(/No connections yet/)).not.toBeInTheDocument();
  });
});

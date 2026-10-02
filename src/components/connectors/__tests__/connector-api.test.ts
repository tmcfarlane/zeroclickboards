import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import { connectorRequest } from '../connector-api';

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/apiFetch', () => ({ apiFetch: state.fetch }));
const session = { access_token: 'disposable-account-token' } as Session;
const status = { available: true, endpoint: 'https://board.example.invalid/mcp', connections: [] };
const consent = { clientName: 'ChatGPT', scopes: ['boards:read', 'cards:add'], expiresAt: '2026-10-02T16:00:00Z',
  boards: [{ id: 'fixture-board', name: 'Roadmap', canAddCards: false }] };
const connection = { id: 'fixture-connection', clientName: 'ChatGPT', boardIds: ['fixture-board'], scopes: ['boards:read'], expiresAt: '2026-10-02T16:00:00Z' };
const consentQuery = new URLSearchParams({ action: 'consent', request: 'fixture-request' });
const response = (data: unknown, code = 200) => new Response(JSON.stringify(data), { status: code, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => vi.clearAllMocks());

describe('connector response boundaries', () => {
  it.each([
    { available: true, endpoint: status.endpoint },
    { ...status, connections: {} },
    { ...status, connections: [{ ...connection, boardIds: null }] },
    { ...status, connections: [{ ...connection, expiresAt: 'not-a-date' }] },
    { ...status, endpoint: 'javascript:alert(1)' },
    { ...status, clients: [{ name: 'ChatGPT' }] },
  ])('rejects malformed status instead of passing it to the settings renderer: %j', async data => {
    state.fetch.mockResolvedValueOnce(response(data));
    await expect(connectorRequest(session)).rejects.toThrow('invalid response');
  });

  it.each([
    { ...consent, scopes: null },
    { ...consent, boards: null },
    { ...consent, boards: [{ ...consent.boards[0], canAddCards: 'false' }] },
    { ...consent, expiresAt: 'not-a-date' },
    { ...consent, scopes: [] },
  ])('rejects malformed consent without interpreting truthy write permissions: %j', async data => {
    state.fetch.mockResolvedValueOnce(response(data));
    await expect(connectorRequest(session, { query: consentQuery })).rejects.toThrow('invalid response');
  });

  it.each([
    ['approve', {}],
    ['cancel', { cancelled: false }],
    ['cancel', { cancelled: true, redirectUrl: 42 }],
    ['revoke', { success: false }],
    ['revoke', { revoked: true }],
  ])('requires the server acknowledgement for %s', async (action, data) => {
    state.fetch.mockResolvedValueOnce(response(data));
    await expect(connectorRequest(session, { body: { action } })).rejects.toThrow('invalid response');
  });

  it.each([
    [status, {}],
    [{ available: false, endpoint: null, connections: [], reason: 'Not configured' }, {}],
    [{ ...status, connections: [connection], clients: [{ name: 'ChatGPT', clientId: 'public-client' }] }, {}],
    [consent, { query: consentQuery }],
    [{ ...consent, scopes: ['boards:read', 'unknown:permission'] }, { query: consentQuery }],
    [{ redirectUrl: 'https://client.example.invalid/callback' }, { body: { action: 'approve' } }],
    [{ cancelled: true }, { body: { action: 'cancel' } }],
    [{ success: true }, { body: { action: 'revoke' } }],
  ])('accepts a valid response for the requested operation: %j', async (data, options) => {
    state.fetch.mockResolvedValueOnce(response(data));
    await expect(connectorRequest(session, options)).resolves.toEqual(data);
  });

  it('preserves a safe server error instead of disguising it as invalid data', async () => {
    state.fetch.mockResolvedValueOnce(response({ error: 'This connection request has expired.' }, 410));
    await expect(connectorRequest(session, { query: consentQuery })).rejects.toThrow('has expired');
  });
});

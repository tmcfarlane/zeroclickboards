import { describe, it, expect, vi, beforeEach } from 'vitest';
import { apiFetch } from '../apiFetch';
import type { Session } from '@supabase/supabase-js';

const mockSignOut = vi.fn();

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}));

function makeSession(token: string): Session {
  return {
    access_token: token,
    refresh_token: 'refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Date.now() / 1000 + 3600,
    user: {
      id: 'user-1',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'test@test.com',
      app_metadata: {},
      user_metadata: {},
      created_at: '',
    },
  };
}

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockSignOut.mockClear();
    mockSignOut.mockResolvedValue({ error: null });
  });

  it('makes a fetch call and returns the response', async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const res = await apiFetch('/api/test');
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith('/api/test', expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it('sets Authorization header when session has access_token', async () => {
    const mockResponse = new Response('', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/test', { session: makeSession('my-token') });

    const calledHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(calledHeaders.get('Authorization')).toBe('Bearer my-token');
  });

  it('does not set Authorization header when no session', async () => {
    const mockResponse = new Response('', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/test');

    const calledHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(calledHeaders.get('Authorization')).toBeNull();
  });

  it('merges custom headers with auth header', async () => {
    const mockResponse = new Response('', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/test', {
      session: makeSession('tok'),
      headers: { 'Content-Type': 'application/json' },
    });

    const calledHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(calledHeaders.get('Authorization')).toBe('Bearer tok');
    expect(calledHeaders.get('Content-Type')).toBe('application/json');
  });

  it('signs out on 401 when session is present', async () => {
    const mockResponse = new Response('', { status: 401 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await apiFetch('/api/test', { session: makeSession('expired-token') });

    expect(mockSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('does not sign out on 401 when no session', async () => {
    const mockResponse = new Response('', { status: 401 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await apiFetch('/api/test');

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('does not sign out on non-401 errors', async () => {
    const mockResponse = new Response('', { status: 500 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    await apiFetch('/api/test', { session: makeSession('valid-token') });

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('passes through extra fetch options like method and body', async () => {
    const mockResponse = new Response('', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal('fetch', fetchMock);

    await apiFetch('/api/test', { method: 'POST', body: '{"data":1}' });

    expect(fetchMock).toHaveBeenCalledWith('/api/test', expect.objectContaining({
      method: 'POST',
      body: '{"data":1}',
    }));
  });
});

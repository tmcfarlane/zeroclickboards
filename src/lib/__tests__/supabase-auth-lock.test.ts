// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthChangeEvent, LockFunc, Session, SupabaseClientOptions } from '@supabase/supabase-js';

const fixture = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  fetch: vi.fn<typeof fetch>(),
  flowType: 'implicit' as 'implicit' | 'pkce',
  options: undefined as SupabaseClientOptions<'public'> | undefined,
}));

// Use the installed SDK, replacing only storage and HTTP with disposable fixtures.
vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const sdk = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...sdk,
    createClient: (url: string, key: string, options?: SupabaseClientOptions<'public'>) => {
      fixture.options = options;
      return sdk.createClient(url, key, {
        ...options,
        auth: {
          ...options?.auth,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: true,
          flowType: fixture.flowType,
          storage: {
            getItem: (name) => fixture.storage.get(name) ?? null,
            setItem: (name, value) => { fixture.storage.set(name, value); },
            removeItem: (name) => { fixture.storage.delete(name); },
          },
        },
        global: { fetch: fixture.fetch },
      });
    },
  };
});

type Subject = typeof import('../supabase');
let subject: Subject | undefined;
let storageKey: string;
let serial = 0;
const unsubscribe: Array<() => void> = [];
const credentials = { email: 'successor@example.invalid', password: 'disposable-fixture-password' };
const nativeLocks = globalThis.navigator?.locks;
const lockModes = nativeLocks ? ['process', 'native'] as const : ['process'] as const;

function session(id: string): Session {
  return {
    access_token: `disposable-${id}`,
    refresh_token: `disposable-refresh-${id}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id, aud: 'authenticated', role: 'authenticated', email: `${id}@example.invalid`,
      app_metadata: {}, user_metadata: {}, created_at: '2026-10-02T00:00:00Z',
    },
  };
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

async function initialize() {
  subject = await import('../supabase');
  await subject.supabase.auth.initialize();
  return subject;
}

function observeEvents(client: Subject['supabase']) {
  const events: Array<{ event: AuthChangeEvent; user: string | null }> = [];
  const subscription = client.auth.onAuthStateChange((event, value) => {
    events.push({ event, user: value?.user.id ?? null });
  });
  unsubscribe.push(() => subscription.data.subscription.unsubscribe());
  return events;
}

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('navigator', {});
  const host = `auth-lock-fixture-${++serial}.invalid`;
  vi.stubEnv('VITE_SUPABASE_URL', `https://${host}`);
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'disposable-fixture-public-key');
  storageKey = `sb-${host.split('.')[0]}-auth-token`;
  fixture.storage.clear();
  fixture.storage.set(storageKey, JSON.stringify(session('old-account')));
  fixture.flowType = 'implicit';
  fixture.options = undefined;
  fixture.fetch.mockReset();
  fixture.fetch.mockImplementation(async (url) => { throw new Error(`Unexpected fixture request: ${String(url)}`); });
  vi.stubGlobal('fetch', fixture.fetch);
});

afterEach(() => {
  unsubscribe.splice(0).forEach((stop) => stop());
  subject?.supabase.auth.stopAutoRefresh();
  subject = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe.each(lockModes)('SDK auth mutation serialization with %s locks', (mode) => {
  beforeEach(() => {
    if (mode === 'native') vi.stubGlobal('navigator', { locks: nativeLocks });
  });
  it.each(['password', 'signup'] as const)('queues %s behind revoked-session validation and preserves the successor', async (method) => {
    const validationStarted = deferred<void>();
    const oldResponse = deferred<Response>();
    const trace: string[] = [];
    fixture.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/user')) {
        trace.push('old validation');
        validationStarted.resolve();
        return oldResponse.promise;
      }
      trace.push('successor request');
      return json(session('successor-account'));
    });
    const api = await initialize();
    const events = observeEvents(api.supabase);
    const validation = api.supabase.auth.getUser();
    await validationStarted.promise;
    const revisions = await import('../auth-session');
    const beforeIntent = revisions.getAuthSessionRevision();
    const login = method === 'password' ? api.authSignInWithPassword(credentials) : api.authSignUp(credentials);
    expect(revisions.getAuthSessionRevision()).toBeGreaterThan(beforeIntent);
    expect(trace).toEqual(['old validation']);
    trace.push('release revoked response');
    oldResponse.resolve(json({ error_code: 'session_not_found', message: 'Fixture old session revoked' }, 403));
    expect((await validation).error?.name).toBe('AuthSessionMissingError');
    expect((await login).error).toBeNull();
    expect(trace).toEqual(['old validation', 'release revoked response', 'successor request']);
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('successor-account');
    expect(events.filter(({ event }) => event !== 'INITIAL_SESSION')).toEqual([
      { event: 'SIGNED_OUT', user: null }, { event: 'SIGNED_IN', user: 'successor-account' },
    ]);
  });

  it('queues password login behind acknowledged logout cleanup', async () => {
    const logoutStarted = deferred<void>();
    const oldResponse = deferred<Response>();
    fixture.fetch.mockImplementation(async (url) => {
      if (String(url).includes('/logout')) { logoutStarted.resolve(); return oldResponse.promise; }
      return json(session('successor-account'));
    });
    const api = await initialize();
    const events = observeEvents(api.supabase);
    const logout = api.supabase.auth.signOut({ scope: 'local' });
    await logoutStarted.promise;
    const login = api.authSignInWithPassword(credentials);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    oldResponse.resolve(new Response(null, { status: 204 }));
    expect((await logout).error).toBeNull();
    expect((await login).data.user?.id).toBe('successor-account');
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('successor-account');
    expect(events.filter(({ event }) => event !== 'INITIAL_SESSION')).toEqual([
      { event: 'SIGNED_OUT', user: null }, { event: 'SIGNED_IN', user: 'successor-account' },
    ]);
  });

  it('shares the lock with a second SDK client using the same session storage', async () => {
    const validationStarted = deferred<void>();
    const oldResponse = deferred<Response>();
    fixture.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith('/user')) { validationStarted.resolve(); return oldResponse.promise; }
      return json(session('successor-account'));
    });
    const api = await initialize();
    const sdk = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    const second = sdk.createClient(import.meta.env.VITE_SUPABASE_URL, 'disposable-fixture-public-key', {
      auth: {
        ...fixture.options!.auth,
        autoRefreshToken: false, detectSessionInUrl: false,
        storage: {
          getItem: (name) => fixture.storage.get(name) ?? null,
          setItem: (name, value) => { fixture.storage.set(name, value); },
          removeItem: (name) => { fixture.storage.delete(name); },
        },
      },
      global: { fetch: fixture.fetch },
    });
    unsubscribe.push(() => { second.auth.stopAutoRefresh(); });
    await second.auth.initialize();
    const validation = second.auth.getUser();
    await validationStarted.promise;
    const login = api.authSignInWithPassword(credentials);
    expect(fixture.fetch).toHaveBeenCalledTimes(1);
    oldResponse.resolve(json({ error_code: 'session_not_found' }, 403));
    await validation;
    expect((await login).error).toBeNull();
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('successor-account');
  });

  it('preserves call order when login follows logout before its HTTP request starts', async () => {
    const trace: string[] = [];
    fixture.fetch.mockImplementation(async (url) => {
      if (String(url).includes('/logout')) {
        trace.push('old logout');
        return new Response(null, { status: 204 });
      }
      trace.push('successor login');
      return json(session('successor-account'));
    });
    const api = await initialize();
    // Drain initialization's subscription notification lock before this race.
    await fixture.options!.auth!.lock!(`lock:${storageKey}`, -1, async () => {});
    const logout = api.supabase.auth.signOut({ scope: 'local' });
    const login = api.authSignInWithPassword(credentials);
    await Promise.all([logout, login]);
    expect(trace).toEqual(['old logout', 'successor login']);
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('successor-account');
  });

  it('preserves signup confirmation responses and releases the lock after a rejected login', async () => {
    fixture.fetch.mockResolvedValueOnce(json({ error_code: 'invalid_credentials', message: 'Fixture invalid credentials' }, 400))
      .mockResolvedValueOnce(json({ user: session('new-account').user }));
    const api = await initialize();
    expect((await api.authSignInWithPassword(credentials)).error?.message).toBe('Fixture invalid credentials');
    const confirmation = await api.authSignUp(credentials);
    expect(confirmation.error).toBeNull();
    expect(confirmation.data.session).toBeNull();
    expect(confirmation.data.user?.id).toBe('new-account');
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('old-account');
  });

  it('releases the lock after an unexpected SDK failure', async () => {
    fixture.fetch.mockResolvedValueOnce(json(session('successor-account')));
    const api = await initialize();
    const failure = vi.spyOn(api.supabase.auth, 'signUp').mockRejectedValueOnce(new Error('Fixture SDK exception'));
    await expect(api.authSignUp(credentials)).rejects.toThrow('Fixture SDK exception');
    failure.mockRestore();
    expect((await api.authSignInWithPassword(credentials)).data.user?.id).toBe('successor-account');
  });

  it('allows deferred auth-callback validation without nesting the same lock', async () => {
    fixture.fetch.mockImplementation(async (url) => String(url).endsWith('/user')
      ? json(session('successor-account').user) : json(session('successor-account')));
    const api = await initialize();
    const validated = deferred<string | undefined>();
    const subscription = api.supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        queueMicrotask(() => { void api.supabase.auth.getUser().then(({ data }) => validated.resolve(data.user?.id)); });
      }
    });
    unsubscribe.push(() => subscription.data.subscription.unsubscribe());
    expect((await api.authSignInWithPassword(credentials)).error).toBeNull();
    expect(await validated.promise).toBe('successor-account');
  });

  it('queues PKCE initiation behind logout so cleanup preserves the new verifier', async () => {
    fixture.flowType = 'pkce';
    const logoutStarted = deferred<void>();
    const oldResponse = deferred<Response>();
    fixture.fetch.mockImplementation(async () => { logoutStarted.resolve(); return oldResponse.promise; });
    const api = await initialize();
    const logout = api.supabase.auth.signOut({ scope: 'local' });
    await logoutStarted.promise;
    const initiation = api.authSignInWithOAuth({ provider: 'google', options: { skipBrowserRedirect: true } });
    expect(fixture.storage.has(`${storageKey}-code-verifier`)).toBe(false);
    oldResponse.resolve(new Response(null, { status: 204 }));
    await logout;
    const result = await initiation;
    expect(result.error).toBeNull();
    expect(result.data.url).toContain('code_challenge=');
    expect(fixture.storage.get(`${storageKey}-code-verifier`)).toBeTruthy();
  });

  it('uses the same SDK browser lock and default session key for queued mutations', async () => {
    const { processLock } = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    const requests: string[] = [];
    const request = <R>(name: string, options: { ifAvailable?: boolean }, callback: (lock: { name: string }) => Promise<R>) => {
      requests.push(name);
      return processLock(name, options.ifAvailable ? 0 : -1, () => callback({ name }));
    };
    vi.stubGlobal('navigator', { locks: { request } });
    fixture.fetch.mockResolvedValue(json(session('successor-account')));
    const api = await initialize();
    expect(fixture.options?.auth?.storageKey).toBe(storageKey);
    const lock: LockFunc | undefined = fixture.options?.auth?.lock;
    expect(lock).toBeDefined();
    await api.authSignInWithPassword(credentials);
    expect(requests.every((name) => name === `lock:${storageKey}`)).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(2);
  });

  it.each(['account change', 'token refresh', 'same-token reconnect'] as const)('preserves the current SDK session after an old API401 (%s)', async (change) => {
    const apiStarted = deferred<void>();
    const apiResponse = deferred<Response>();
    const renewed = { ...session('old-account'), access_token: 'disposable-renewed-old-account' };
    let logoutRequests = 0;
    fixture.fetch.mockImplementation(async (url) => {
      if (String(url) === '/api/disposable-review') { apiStarted.resolve(); return apiResponse.promise; }
      if (String(url).includes('/logout')) { logoutRequests++; return new Response(null, { status: 204 }); }
      return json(change === 'token refresh' ? renewed : session(change === 'same-token reconnect' ? 'old-account' : 'successor-account'));
    });
    const api = await initialize();
    const { apiFetch } = await import('../apiFetch');
    const pending = apiFetch('/api/disposable-review', { session: session('old-account') });
    await apiStarted.promise;
    if (change === 'token refresh') {
      expect((await api.supabase.auth.refreshSession()).data.session?.access_token).toBe(renewed.access_token);
    } else {
      if (change === 'same-token reconnect') {
        const { advanceAuthSessionRevision } = await import('../auth-session');
        advanceAuthSessionRevision();
        await api.supabase.auth.signOut({ scope: 'local' });
      }
      expect((await api.authSignInWithPassword(credentials)).error).toBeNull();
    }
    apiResponse.resolve(json({ error: 'Fixture stale response' }, 401));
    expect((await pending).status).toBe(401);
    expect(logoutRequests).toBe(change === 'same-token reconnect' ? 1 : 0);
    const stored = JSON.parse(fixture.storage.get(storageKey)!);
    expect(stored.access_token).toBe(change === 'token refresh' ? renewed.access_token :
      session(change === 'same-token reconnect' ? 'old-account' : 'successor-account').access_token);
  });

  it('invalidates a held API current-session check before a new login publishes its session', async () => {
    fixture.fetch.mockImplementation(async (url) => String(url) === '/api/disposable-review'
      ? json({ error: 'Fixture current response' }, 401) : json(session('successor-account')));
    const api = await initialize();
    const snapshot = await api.supabase.auth.getSession();
    const lookupStarted = deferred<void>();
    const lookupReply = deferred<typeof snapshot>();
    const lookup = vi.spyOn(api.supabase.auth, 'getSession').mockImplementationOnce(() => {
      lookupStarted.resolve();
      return lookupReply.promise;
    });
    const { apiFetch } = await import('../apiFetch');
    const pending = apiFetch('/api/disposable-review', { session: session('old-account') });
    await lookupStarted.promise;
    const login = api.authSignInWithPassword(credentials);
    lookupReply.resolve(snapshot);
    expect((await pending).status).toBe(401);
    expect((await login).error).toBeNull();
    lookup.mockRestore();
    expect(fixture.fetch.mock.calls.some(([url]) => String(url).includes('/logout'))).toBe(false);
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('successor-account');
  });

  it('logs out a genuine current API401 and queues a following login behind cleanup', async () => {
    const logoutStarted = deferred<void>();
    const logoutReply = deferred<Response>();
    fixture.fetch.mockImplementation(async (url) => {
      if (String(url) === '/api/disposable-review') return json({ error: 'Fixture current response' }, 401);
      if (String(url).includes('/logout')) { logoutStarted.resolve(); return logoutReply.promise; }
      return json(session('successor-account'));
    });
    const api = await initialize();
    const { apiFetch } = await import('../apiFetch');
    const revisions = await import('../auth-session');
    const initialRevision = revisions.getAuthSessionRevision();
    const pending = apiFetch('/api/disposable-review', { session: session('old-account') });
    await logoutStarted.promise;
    expect(revisions.getAuthSessionRevision()).toBeGreaterThan(initialRevision);
    const login = api.authSignInWithPassword(credentials);
    expect(fixture.fetch).toHaveBeenCalledTimes(2);
    logoutReply.resolve(new Response(null, { status: 204 }));
    expect((await pending).status).toBe(401);
    expect((await login).error).toBeNull();
    expect(JSON.parse(fixture.storage.get(storageKey)!).user.id).toBe('successor-account');
  });
});

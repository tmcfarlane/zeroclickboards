// @vitest-environment node
import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session, SignInWithOAuthCredentials, SupabaseClient } from '@supabase/supabase-js';

const clients: SupabaseClient[] = [];
let serial = 0;

function existingSession(): Session {
  return {
    access_token: 'disposable-existing-session',
    refresh_token: 'disposable-existing-refresh',
    token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: 'existing-fixture-user', aud: 'authenticated', role: 'authenticated',
      email: 'existing@example.invalid', app_metadata: {}, user_metadata: {},
      created_at: '2026-10-02T00:00:00Z',
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_CHATGPT_SIGN_IN_ENABLED', undefined);
  vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  clients.splice(0).forEach(client => client.auth.stopAutoRefresh());
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('ChatGPT provider configuration', () => {
  it.each([undefined, '', 'false', 'TRUE', '1', 'true ', ' true'])('stays disabled for %s', async (value) => {
    vi.stubEnv('VITE_CHATGPT_SIGN_IN_ENABLED', value);
    const auth = await import('../chatgpt-auth');
    expect(auth.isChatGPTSignInEnabled()).toBe(false);
  });

  it('requires the exact explicit opt-in', async () => {
    vi.stubEnv('VITE_CHATGPT_SIGN_IN_ENABLED', 'true');
    const auth = await import('../chatgpt-auth');
    expect(auth.isChatGPTSignInEnabled()).toBe(true);
  });

  it('returns fixed compatible OAuth credentials even when the redirect contains another provider', async () => {
    const auth = await import('../chatgpt-auth');
    const redirectTo = 'https://board.example.invalid/auth/connector?request=opaque&provider=google';
    const credentials: SignInWithOAuthCredentials = auth.chatGPTProviderCredentials(redirectTo);
    expect(auth.CHATGPT_AUTH_PROVIDER).toBe('custom:chatgpt');
    expect(credentials.provider).toBe('custom:chatgpt');
    expect(credentials.options?.redirectTo).toBe(redirectTo);
    expect(credentials.options?.scopes).toBe('openid profile');
    expect(credentials.options?.scopes?.split(/\s+/)).not.toContain('email');
  });
});

describe('ChatGPT callback target', () => {
  it.each([
    'https://board.example.invalid/auth/connector?request=opaque-request&mode=consent',
    'https://board.example.invalid/auth/cli?request=opaque-cli&redirect_uri=http%3A%2F%2F127.0.0.1%3A4187%2Fcallback&state=opaque-state',
  ])('preserves the complete flow context in %s', async (href) => {
    const auth = await import('../chatgpt-auth');
    expect(auth.getChatGPTAuthRedirectUrl(href)).toBe(href);
  });

  it('removes OAuth credentials without changing connector path or query', async () => {
    const auth = await import('../chatgpt-auth');
    const target = 'https://board.example.invalid/auth/connector?request=opaque-request&state=flow-state';
    const fragment = new URLSearchParams({
      access_token: 'disposable-access', refresh_token: 'disposable-refresh',
      provider_token: 'disposable-provider', provider_refresh_token: 'disposable-provider-refresh',
      token_type: 'bearer', expires_in: '3600', expires_at: '1790960000', type: 'recovery',
    });
    expect(auth.getChatGPTAuthRedirectUrl(`${target}#${fragment}`)).toBe(target);
  });

  it('removes the OAuth error fragment carrier without changing the CLI query', async () => {
    const auth = await import('../chatgpt-auth');
    const target = 'https://board.example.invalid/auth/cli?request=opaque-cli';
    const cleaned = new URL(auth.getChatGPTAuthRedirectUrl(`${target}#error=access_denied&error_code=provider_error&error_description=Cancelled&view=connectors`));
    expect(cleaned.origin + cleaned.pathname + cleaned.search).toBe(target);
    expect(cleaned.hash).toBe('');
  });

  it('removes known token/error query fields while preserving code and application flow fields', async () => {
    const auth = await import('../chatgpt-auth');
    const cleaned = new URL(auth.getChatGPTAuthRedirectUrl('https://board.example.invalid/auth/cli?request=opaque-cli&code=flow-code&state=flow-state&access_token=disposable-access&refresh_token=disposable-refresh&error=access_denied&error_description=Cancelled'));
    expect(cleaned.pathname).toBe('/auth/cli');
    expect(Object.fromEntries(cleaned.searchParams)).toEqual({ request: 'opaque-cli', code: 'flow-code', state: 'flow-state' });
  });

  it('retains an ordinary Account anchor', async () => {
    const auth = await import('../chatgpt-auth');
    const href = 'https://board.example.invalid/account#connectors';
    expect(auth.getChatGPTAuthRedirectUrl(href)).toBe(href);
  });
});

describe('safe OAuth callback error copy', () => {
  it.each([
    { code: 'identity_already_exists' },
    { details: { code: 'identity_already_exists' } },
    { details: { error: 'identity_already_exists' } },
  ])('explains existing identity ownership from a supported error shape', async (error) => {
    const auth = await import('../chatgpt-auth');
    expect(auth.getOAuthCallbackErrorMessage(error)).toContain('already linked to another ZeroBoard account');
  });

  it('handles cancellation without exposing provider details', async () => {
    const auth = await import('../chatgpt-auth');
    const message = auth.getOAuthCallbackErrorMessage({ code: 'access_denied', details: { error: 'disposable-private-provider-message' } });
    expect(message).toContain('cancelled');
    expect(message).not.toContain('disposable-private');
  });

  it('recognizes the installed SDK cancellation error when no specific error_code was returned', async () => {
    const auth = await import('../chatgpt-auth');
    const sdk = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    // This is the shape GoTrueClient produces for error=access_denied without error_code.
    const error = new sdk.AuthImplicitGrantRedirectError('disposable-private-provider-description', {
      error: 'access_denied', code: 'unspecified_code',
    });
    const message = auth.getOAuthCallbackErrorMessage({ code: error.code, details: error.details ?? undefined });
    expect(message).toContain('cancelled');
    expect(message).not.toContain('disposable-private');
  });

  it('uses generic copy for unknown provider text and absent codes', async () => {
    const auth = await import('../chatgpt-auth');
    expect(auth.getOAuthCallbackErrorMessage({ details: { error: 'disposable-private-provider-message' } })).toBe(auth.getOAuthCallbackErrorMessage({}));
    expect(auth.getOAuthCallbackErrorMessage({})).toContain('Could not complete sign-in');
  });
});

describe.each(['implicit', 'pkce'] as const)('installed SDK ChatGPT initiation (%s)', (flowType) => {
  it('uses the fixed provider and original callback without replacing the local account', async () => {
    const auth = await import('../chatgpt-auth');
    const sdk = await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    const storageKey = `chatgpt-sdk-fixture-${++serial}`;
    const stored = JSON.stringify(existingSession());
    const storage = new Map([[storageKey, stored]]);
    const writes: string[] = [];
    const http = vi.fn<typeof fetch>(async () => { throw new Error('Unexpected ChatGPT fixture HTTP'); });
    const client = sdk.createClient('https://chatgpt-auth-fixture.invalid', 'disposable-fixture-public-key', {
      auth: {
        storageKey, flowType, autoRefreshToken: false, detectSessionInUrl: false,
        storage: {
          getItem: key => storage.get(key) ?? null,
          setItem: (key, value) => { writes.push(key); storage.set(key, value); },
          removeItem: key => { writes.push(key); storage.delete(key); },
        },
      },
      global: { fetch: http },
    });
    clients.push(client);
    await client.auth.initialize();
    const callback = auth.getChatGPTAuthRedirectUrl('https://board.example.invalid/auth/connector?request=opaque&state=flow-state#access_token=old-token');
    const credentials = auth.chatGPTProviderCredentials(callback);
    const events: string[] = [];
    const { data: subscription } = client.auth.onAuthStateChange(event => { events.push(event); });
    try {
      const result = await client.auth.signInWithOAuth({ ...credentials, options: { ...credentials.options, skipBrowserRedirect: true } });
      expect(result.error).toBeNull();
      expect(result.data.provider).toBe('custom:chatgpt');
      const url = new URL(result.data.url!);
      expect(url.origin + url.pathname).toBe('https://chatgpt-auth-fixture.invalid/auth/v1/authorize');
      expect(url.searchParams.get('provider')).toBe('custom:chatgpt');
      expect(url.searchParams.get('scopes')).toBe('openid profile');
      expect(url.searchParams.get('scopes')!.split(/\s+/)).not.toContain('email');
      expect(url.searchParams.get('redirect_to')).toBe('https://board.example.invalid/auth/connector?request=opaque&state=flow-state');
      expect(url.searchParams.getAll('provider')).toHaveLength(1);
      expect(storage.get(storageKey)).toBe(stored);
      expect(writes).not.toContain(storageKey);
      expect(events.filter(event => event !== 'INITIAL_SESSION')).toEqual([]);
      expect(http).not.toHaveBeenCalled();
      if (flowType === 'pkce') {
        const verifier: string = JSON.parse(storage.get(`${storageKey}-code-verifier`)!);
        expect(verifier).toBeTruthy();
        expect(url.searchParams.get('code_challenge_method')).toBe('s256');
        expect(url.searchParams.get('code_challenge')).toBe(createHash('sha256').update(verifier).digest('base64url'));
      } else {
        expect(url.searchParams.has('code_challenge')).toBe(false);
        expect(storage.has(`${storageKey}-code-verifier`)).toBe(false);
      }
    } finally {
      subscription.subscription.unsubscribe();
    }
  });
});

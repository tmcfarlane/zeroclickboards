import { test as base, expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export const enabled = (process.env.CHATGPT_SIGN_IN_ENABLED ?? 'true') === 'true';
export const origin = 'http://127.0.0.1:4316';
export const authOrigin = 'https://chatgpt-auth-fixture.invalid';
export const storageKey = 'sb-chatgpt-auth-fixture-auth-token';
export const userId = '10000000-0000-4000-8000-000000000011';
const now = '2026-10-02T08:00:00.000Z';
const token = (suffix: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${suffix}`;
export const existingToken = token('disposable-existing-session');
export const callbackToken = token('disposable-callback-session');

function user(linked: boolean) {
  return {
    id: userId, aud: 'authenticated', role: 'authenticated', email: 'existing-owner@example.invalid',
    app_metadata: { provider: 'email', providers: linked ? ['email', 'custom:chatgpt'] : ['email'] },
    user_metadata: { full_name: 'Disposable board owner' }, created_at: now,
    identities: [
      { id: userId, identity_id: '30000000-0000-4000-8000-000000000010', user_id: userId, provider: 'email', identity_data: { sub: userId, email: 'existing-owner@example.invalid' }, created_at: now, updated_at: now, last_sign_in_at: now },
      ...(linked ? [{ id: 'disposable-chatgpt-subject', identity_id: '30000000-0000-4000-8000-000000000011', user_id: userId, provider: 'custom:chatgpt', identity_data: { sub: 'disposable-chatgpt-subject' }, created_at: now, updated_at: now, last_sign_in_at: now }] : []),
    ],
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

type Request = { url: string; method: string; authorization: string | undefined; navigation: boolean };
type AuthFixture = {
  calls: Request[];
  authorizations: Request[];
  linkRequests: Request[];
  holdLink: () => void;
  releaseLink: () => Promise<void>;
  completeLink: () => void;
};
type Options = { authenticated: boolean; linked: boolean };

export const test = base.extend<Options & { authFixture: AuthFixture }>({
  authenticated: [false, { option: true }],
  linked: [false, { option: true }],
  authFixture: [async ({ page, authenticated, linked }, provide) => {
    let currentUser = user(linked);
    let held = false;
    let release: (() => Promise<void>) | undefined;
    const calls: Request[] = [], authorizations: Request[] = [], linkRequests: Request[] = [];
    const unexpected: string[] = [], runtimeErrors: string[] = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));
    if (authenticated) {
      await page.addInitScript(({ key, value, appOrigin }) => {
        // Do not overwrite a session created by a later native SDK callback.
        if (window.location.origin === appOrigin && !localStorage.getItem(key)) localStorage.setItem(key, value);
      }, { key: storageKey, appOrigin: origin, value: JSON.stringify({ access_token: existingToken, refresh_token: 'disposable-existing-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: currentUser }) });
    }

    await page.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      if (url.origin === authOrigin) {
        const call = { url: url.toString(), method: request.method(), authorization: request.headers().authorization, navigation: request.isNavigationRequest() };
        calls.push(call);
        if (url.pathname === '/auth/v1/user' && request.method() === 'GET') return json(route, currentUser);
        if (url.pathname === '/auth/v1/user/identities/authorize' && request.method() === 'GET') {
          linkRequests.push(call);
          const authorization = new URL(`${authOrigin}/auth/v1/authorize`);
          authorization.searchParams.set('provider', 'custom:chatgpt');
          authorization.searchParams.set('redirect_to', url.searchParams.get('redirect_to') ?? '');
          authorization.searchParams.set('scopes', 'openid profile');
          const respond = () => json(route, { url: authorization.toString() });
          if (!held) return respond();
          return new Promise<void>(resolve => { release = async () => { held = false; release = undefined; try { await respond(); } finally { resolve(); } }; });
        }
        if (url.pathname === '/auth/v1/authorize' && request.isNavigationRequest()) {
          authorizations.push(call);
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body><h1>Disposable authorization destination</h1></body></html>' });
        }
        if (url.pathname === '/rest/v1/boards' || url.pathname === '/rest/v1/board_members') return json(route, []);
        unexpected.push(`${request.method()} ${url.pathname}`);
        return json(route, { message: 'Unexpected disposable auth fixture request' }, 500);
      }
      if (url.hostname === 'zeroboard-media.trent-a60.workers.dev') return route.fulfill({ status: 204 });
      if (url.origin === 'https://board.zeroclickdev.ai' && url.pathname.startsWith('/embed/')) return route.fulfill({ contentType: 'text/html', body: '<html><body>Disposable embedded preview</body></html>' });
      if (url.hostname === 'va.vercel-scripts.com') return route.fulfill({ contentType: 'application/javascript', body: '' });
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.origin !== origin) {
        unexpected.push(`External request blocked: ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/connector') return json(route, { available: false, endpoint: null, connections: [], reason: 'Disposable identity fixture' });
        if (url.pathname === '/api/stripe/check-subscription') return json(route, { hasActiveSubscription: false, subscription: null });
        if (url.pathname === '/api/admin/check') return json(route, { isAdmin: false });
        if (url.pathname === '/api/ai/usage') return json(route, { used: 0, limit: 0, remaining: 0 });
        unexpected.push(`${request.method()} ${url.pathname}`);
        return json(route, { error: 'Unexpected local fixture API request' }, 500);
      }
      return route.continue();
    });
    await page.routeWebSocket('**/*', socket => {
      if (new URL(socket.url()).hostname !== 'chatgpt-auth-fixture.invalid') unexpected.push(`External websocket blocked: ${socket.url()}`);
      // No connectToServer: every realtime transport stays isolated.
    });

    await provide({ calls, authorizations, linkRequests, holdLink: () => { held = true; }, releaseLink: async () => { await release?.(); }, completeLink: () => { currentUser = user(true); } });
    await release?.().catch(() => {});
    expect(runtimeErrors, 'the compiled identity flow must not throw browser errors').toEqual([]);
    expect(unexpected, 'every external transport must have an explicit disposable response').toEqual([]);
  }, { auto: true }],
});

export async function openSignIn(page: Page) {
  await page.getByRole('button', { name: "Get Started — It's Free", exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Welcome to ZeroBoard' });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function assertFitsViewport(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull(); expect(viewport).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height + 1);
}

export async function captureEvidence(page: Page, info: TestInfo, name: string, target?: Locator) {
  const directory = process.env.CHATGPT_AUTH_SCREENSHOT_DIR;
  if (directory) await mkdir(directory, { recursive: true });
  const filename = `${enabled ? 'enabled' : 'disabled'}-${info.project.name}-${name}.png`;
  const path = directory ? join(directory, filename) : info.outputPath(filename);
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path });
  await info.attach(name, { path, contentType: 'image/png' });
}

export { expect };

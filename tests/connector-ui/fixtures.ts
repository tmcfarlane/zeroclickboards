import { test as base, expect, type Route } from '@playwright/test';
/* eslint-disable no-empty-pattern -- Playwright requires destructuring even for fixtures without dependencies. */

export const USER_ID = '10000000-0000-4000-8000-000000000001';
export const BOARD_ID = '20000000-0000-4000-8000-000000000001';
export const OTHER_BOARD_ID = '20000000-0000-4000-8000-000000000002';
export const READ_ONLY_BOARD_ID = '20000000-0000-4000-8000-000000000003';
const now = '2026-10-01T19:00:00.000Z';

export const user = {
  id: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  email: 'connector-fixture@example.invalid',
  app_metadata: { provider: 'email', providers: ['email'] },
  user_metadata: { full_name: 'Connector review fixture' },
  created_at: now,
};

const tokenPayload = Buffer.from(JSON.stringify({
  sub: USER_ID,
  aud: 'authenticated',
  role: 'authenticated',
  exp: Math.floor(Date.now() / 1000) + 3600,
})).toString('base64url');
// Deliberately unsigned, local transport fixture; no external service accepts it.
const token = `eyJhbGciOiJIUzI1NiJ9.${tokenPayload}.disposable-fixture`;
const session = {
  access_token: token,
  refresh_token: 'disposable-refresh-token',
  token_type: 'bearer',
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user,
};

export const boardRows = [BOARD_ID, OTHER_BOARD_ID].map((id, index) => ({
  id,
  user_id: USER_ID,
  name: index === 0 ? 'Product roadmap' : 'Private research',
  description: 'Disposable local browser fixture',
  created_at: now,
  updated_at: now,
  is_public: false,
  data: {
    columns: [
      { id: `column-${index}`, title: 'To Do', order: 0, cards: [] },
    ],
  },
}));

type ApiHandler = (route: Route) => Promise<void>;
type Fixtures = {
  apiCalls: { method: string; path: string; body: unknown }[];
  apiHandler: ApiHandler;
  transportFailures: string[];
};

export async function json(route: Route, data: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
}

export const test = base.extend<Fixtures>({
  apiCalls: async ({}, provide) => { await provide([]); },
  transportFailures: async ({}, provide) => { await provide([]); },
  apiHandler: async ({}, provide) => {
    await provide(async (route) => { await json(route, { error: 'Unexpected fixture API request' }, 500); });
  },
  page: async ({ page, apiCalls, apiHandler, transportFailures }, provide) => {
    const runtimeErrors: string[] = [];
    page.on('pageerror', (error) => runtimeErrors.push(error.message));
    await page.addInitScript(({ key, value }) => {
      if (window.top === window && location.hostname === '127.0.0.1') localStorage.setItem(key, value);
    }, { key: 'sb-connector-fixture-auth-token', value: JSON.stringify(session) });

    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.hostname === 'connector-fixture.invalid') {
        if (url.pathname === '/auth/v1/user') return json(route, user);
        if (url.pathname === '/rest/v1/boards' && request.method() === 'GET') return json(route, boardRows);
        if (url.pathname === '/rest/v1/board_members' && request.method() === 'GET') return json(route, []);
        transportFailures.push(`${request.method()} ${url.pathname}`);
        return json(route, { message: 'No live Supabase requests allowed in connector browser tests' }, 500);
      }
      // Developer tooling and analytics are deliberately inert. Typography is
      // bundled by @fontsource, so no external fonts are needed for the UI.
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
      if (url.hostname === 'va.vercel-scripts.com') return route.fulfill({ contentType: 'application/javascript', body: '' });
      if (url.hostname !== '127.0.0.1') {
        transportFailures.push(`External request blocked: ${url.origin}${url.pathname}`);
        return route.abort('blockedbyclient');
      }
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/stripe/check-subscription') return json(route, { hasActiveSubscription: false, subscription: null });
        if (url.pathname === '/api/admin/check') return json(route, { isAdmin: false });
        if (url.pathname === '/api/ai/usage') return json(route, { used: 0, limit: 0, remaining: 0 });
        apiCalls.push({ method: request.method(), path: url.pathname + url.search, body: request.postDataJSON() });
        return apiHandler(route);
      }
      return route.continue();
    });

    // Suppress attempts to connect to an external realtime websocket. The app
    // still reads the same HTTP board data it uses in production.
    await page.routeWebSocket('wss://connector-fixture.invalid/**', () => {});
    await provide(page);
    expect(runtimeErrors, 'the connector flow must not raise browser runtime errors').toEqual([]);
    expect(transportFailures, 'all external traffic must use the declared disposable fixture').toEqual([]);
  },
});

export { expect };

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, json, user, USER_ID, BOARD_ID, OTHER_BOARD_ID } from './fixtures';

const callback = 'https://client.example.invalid/oauth/callback?code=disposable-code&state=original';
const consent = { clientName: 'Fixture ChatGPT', scopes: ['boards:read'], boards: [{ id: BOARD_ID, name: 'Product roadmap', canAddCards: true }], expiresAt: new Date(Date.now() + 600_000).toISOString() };
const nextConsent = { ...consent, clientName: 'Fixture Codex', boards: [{ id: OTHER_BOARD_ID, name: 'Private research', canAddCards: true }] };
const grant = { id: 'fixture-grant-a', clientName: 'Fixture ChatGPT', boardIds: [BOARD_ID], scopes: ['boards:read'], expiresAt: new Date(Date.now() + 900_000).toISOString() };
const ready = { available: true, endpoint: 'https://board.example.invalid/mcp', connections: [grant] };

function gate() { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; }
async function evidence(page: Page, info: TestInfo, name: string) {
  const directory = resolve('docs/qa/v0.8/consent/screenshots'); await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${name}-${info.project.name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled', scale: 'css' }); await info.attach(`Disposable fixture: ${name}`, { path, contentType: 'image/png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}
async function changeRequest(page: Page, request: string) {
  await page.evaluate(value => {
    history.pushState({ ...history.state, idx: (history.state?.idx ?? 0) + 1 }, '', `/auth/connector?request=${value}`);
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }, request);
}

test.describe('connector ownership lifecycle', () => {
  test('late approval cannot redirect after actual Back to boards navigation', async ({ page }, info) => {
    const held = gate(); let posts = 0; let callbacks = 0;
    await page.route('https://client.example.invalid/oauth/callback?**', async route => { callbacks++; await route.fulfill({ contentType: 'text/html', body: '<h1>Disposable callback</h1>' }); });
    await page.route('**/api/connector**', async route => {
      if (route.request().method() === 'GET') return json(route, consent);
      posts++; await held.promise; await json(route, { redirectUrl: callback });
    });
    try {
      await page.goto('/auth/connector?request=first'); await page.getByRole('checkbox', { name: 'Product roadmap', exact: true }).check(); await page.getByRole('button', { name: 'Allow connection', exact: true }).click();
      await expect.poll(() => posts).toBe(1); await evidence(page, info, 'approval-pending-fixture');
      await page.getByRole('link', { name: 'Back to boards' }).click(); await expect(page).toHaveURL('/app'); await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
      const complete = page.waitForResponse(response => response.url().endsWith('/api/connector') && response.request().method() === 'POST'); held.release(); await complete;
      await expect(page).toHaveURL('/app'); await expect.poll(() => callbacks).toBe(0); await evidence(page, info, 'departed-approval-fixture'); expect(posts).toBe(1);
    } finally { held.release(); }
  });

  test('late approval cannot own a successor request in the same document', async ({ page }, info) => {
    const held = gate(); let posts = 0; let callbacks = 0;
    await page.route('https://client.example.invalid/oauth/callback?**', async route => { callbacks++; await route.fulfill({ contentType: 'text/html', body: '<h1>Disposable callback</h1>' }); });
    await page.route('**/api/connector**', async route => {
      if (route.request().method() === 'GET') return json(route, new URL(route.request().url()).searchParams.get('request') === 'next' ? nextConsent : consent);
      posts++; await held.promise; await json(route, { redirectUrl: callback });
    });
    try {
      await page.goto('/auth/connector?request=first'); await page.getByRole('checkbox', { name: 'Product roadmap', exact: true }).check(); await page.getByRole('button', { name: 'Allow connection', exact: true }).click(); await expect.poll(() => posts).toBe(1);
      await changeRequest(page, 'next'); await expect(page.getByRole('heading', { name: 'Connect Fixture Codex to ZeroBoard' })).toBeVisible();
      const complete = page.waitForResponse(response => response.url().endsWith('/api/connector') && response.request().method() === 'POST'); held.release(); await complete;
      await expect(page).toHaveURL('/auth/connector?request=next'); await expect(page.getByRole('checkbox', { name: 'Private research', exact: true })).not.toBeChecked(); await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeDisabled(); expect(callbacks).toBe(0); await evidence(page, info, 'successor-request-fixture');
    } finally { held.release(); }
  });

  test('a cancellation callback does not survive a different same-document request', async ({ page }, info) => {
    await page.route('**/api/connector**', route => json(route, route.request().method() === 'POST' ? { cancelled: true, redirectUrl: callback.replace('code=disposable-code', 'error=access_denied') } : new URL(route.request().url()).searchParams.get('request') === 'next' ? nextConsent : consent));
    await page.goto('/auth/connector?request=first'); await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(page.getByRole('link', { name: 'Return to Fixture ChatGPT' })).toBeVisible();
    await changeRequest(page, 'next'); await expect(page.getByRole('heading', { name: 'Connect Fixture Codex to ZeroBoard' })).toBeVisible(); await expect(page.getByRole('link', { name: /Return to/ })).toHaveCount(0); await evidence(page, info, 'fresh-after-cancellation-fixture');
  });

  test('account replacement clears old disconnect metadata and ignores its held result', async ({ page }, info) => {
    const held = gate(); let posts = 0; const second = { ...user, id: '10000000-0000-4000-8000-000000000002', email: 'second-account@example.invalid' };
    const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: second.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.disposable-fixture`;
    await page.route('https://connector-fixture.invalid/auth/v1/**', async route => {
      if (new URL(route.request().url()).pathname === '/auth/v1/token') return json(route, { user: second, access_token: token, refresh_token: 'disposable-second-refresh', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
      const header = route.request().headers().authorization ?? ''; const id = JSON.parse(Buffer.from(header.replace(/^Bearer /, '').split('.')[1], 'base64url').toString()).sub;
      await json(route, id === USER_ID ? user : second);
    });
    await page.route('**/api/connector**', async route => {
      if (route.request().method() === 'POST') { posts++; await held.promise; return json(route, { error: 'Old fixture disconnect failure' }, 503); }
      const next = route.request().headers().authorization === `Bearer ${token}`;
      await json(route, { ...ready, connections: next ? [{ ...grant, id: 'fixture-grant-b', clientName: 'Fixture Codex' }] : [grant] });
    });
    try {
      await page.goto('/account#connectors'); await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click(); await expect.poll(() => posts).toBe(1);
      const error = await page.evaluate(async () => { const moduleUrl = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ moduleUrl); const result = await supabase.auth.signInWithPassword({ email: 'second-account@example.invalid', password: 'disposable-password' }); return result.error?.message ?? null; });
      expect(error).toBeNull(); await expect(page.getByRole('alertdialog')).toHaveCount(0); await expect(page.getByText('Fixture Codex', { exact: true })).toBeVisible();
      const complete = page.waitForResponse(response => response.url().endsWith('/api/connector') && response.request().method() === 'POST'); held.release(); await complete;
      await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText('Fixture ChatGPT', { exact: true })).toHaveCount(0); await evidence(page, info, 'replacement-account-fixture'); expect(posts).toBe(1);
    } finally { held.release(); }
  });

  test('a failed disconnect reconciles authoritative absence without a repeated POST', async ({ page }, info) => {
    let revoked = false; let posts = 0;
    await page.route('**/api/connector**', async route => {
      if (route.request().method() === 'POST') { posts++; revoked = true; return json(route, { error: 'Could not finish disconnecting. Check approved access.' }, 503); }
      await json(route, { ...ready, connections: revoked ? [] : [grant] });
    });
    await page.goto('/account#connectors'); await page.getByRole('button', { name: 'Disconnect', exact: true }).click(); await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByText(/No approved access yet/)).toBeVisible(); await expect(page.getByRole('alert')).toContainText('Could not finish disconnecting'); await expect(page.getByRole('alertdialog')).toHaveCount(0); expect(posts).toBe(1); await evidence(page, info, 'partial-revoke-reconciled-fixture');
  });
});

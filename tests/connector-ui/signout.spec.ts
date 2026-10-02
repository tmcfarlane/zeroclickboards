import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, json } from './fixtures';

const logoutUrl = '**/auth/v1/logout**';
const errorMessage = 'Could not sign out. Try again.';

async function screenshot(page: Page, info: TestInfo, label: string) {
  const directory = process.env.SIGNOUT_EVIDENCE_DIR || resolve('test-results/signout-evidence');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${label}-${info.project.name}.png`);
  await page.screenshot({ path, fullPage: label !== 'account-retry', animations: 'disabled', scale: 'css' });
  await info.attach(`Disposable fixture: ${label}`, { path, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/connector', async route => {
    if (route.request().method() !== 'GET') return json(route, { error: 'Unexpected connector mutation in sign-out fixture' }, 500);
    await json(route, {
      available: true, endpoint: 'https://board.example.invalid/mcp', connections: [],
      clients: [{ name: 'ChatGPT fixture', clientId: 'disposable-public-client', callbackKinds: ['chatgpt'] }],
    });
  });
  await page.route('https://zeroboard-media.trent-a60.workers.dev/zeroboard-mcp-commercial-31cd224f.jpg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
  }));
  await page.route('https://board.zeroclickdev.ai/embed/9df8454b-d1f6-4c6f-83b3-d4a710d45fc9', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body>Disposable public board preview</body></html>',
  }));
});

test('Account logout failure stays visible and an explicit retry succeeds', async ({ page }, info) => {
  let attempts = 0;
  await page.route(logoutUrl, async route => {
    attempts++;
    if (attempts === 1) return json(route, { code: 'unexpected_failure', msg: 'Disposable logout failure' }, 500);
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText(errorMessage, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByText('connector-fixture@example.invalid', { exact: true })).toBeVisible();
  expect(attempts).toBe(1);
  await screenshot(page, info, 'account-failure');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  await expect(page.getByRole('region', { name: /^Notifications/ })).toHaveCount(1);
  await expect(page.getByText(errorMessage, { exact: true })).toBeHidden();
  await screenshot(page, info, 'account-retry');
});

test('a held Account logout exposes pending state and prevents repeated activation', async ({ page }) => {
  let attempts = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(logoutUrl, async route => {
    attempts++;
    await held;
    await json(route, { code: 'unexpected_failure', msg: 'Disposable held logout failure' }, 500);
  });
  try {
    await page.goto('/account');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    const pending = page.getByRole('button', { name: 'Signing out...', exact: true });
    await expect(pending).toBeDisabled();
    await pending.press('Enter');
    expect(attempts).toBe(1);
    release();
    await expect(page.getByText(errorMessage, { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled();
    await expect(page).toHaveURL(/\/account$/);
    expect(attempts).toBe(1);
  } finally { release(); }
});

test('the public account menu shows failed logout and allows a keyboard retry', async ({ page }) => {
  let attempts = 0;
  await page.route(logoutUrl, async route => {
    attempts++;
    if (attempts === 1) return json(route, { code: 'unexpected_failure', msg: 'Disposable public logout failure' }, 500);
    await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('/terms');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).press('Enter');
  await expect(page.getByText(errorMessage, { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeVisible();
  expect(attempts).toBe(1);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/terms$/);
  expect(attempts).toBe(2);
  await expect(page.getByRole('region', { name: /^Notifications/ })).toHaveCount(1);
});

test('Account billing failure has a visible persistent-root toast', async ({ page }) => {
  await page.route('**/api/stripe/create-checkout', route => json(route, { error: 'Disposable checkout failure' }, 503));
  await page.goto('/account');
  await page.getByRole('button', { name: /Upgrade to Pro/ }).click();
  await expect(page.getByText('Disposable checkout failure', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('button', { name: /Upgrade to Pro/ })).toBeEnabled();
  await expect(page.getByRole('region', { name: /^Notifications/ })).toHaveCount(1);
});

test('public feedback failure renders the error without losing the submitted form', async ({ page }) => {
  await page.route('**/api/feedback/submit', route => json(route, { message: 'Disposable feedback failure' }, 503));
  await page.goto('/feedback');
  await page.getByLabel(/^Title/).fill('Disposable feedback title');
  await page.getByLabel(/^Description/).fill('Disposable feedback description retained after rejection.');
  await page.getByRole('button', { name: /Submit Feedback/i }).click();
  await expect(page.getByText('Disposable feedback failure', { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^Title/)).toHaveValue('Disposable feedback title');
  await expect(page.getByLabel(/^Description/)).toHaveValue('Disposable feedback description retained after rejection.');
  await expect(page.getByRole('button', { name: /Submit Feedback/i })).toBeEnabled();
  await expect(page.getByRole('region', { name: /^Notifications/ })).toHaveCount(1);
});

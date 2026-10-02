import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, boardRows, user, json } from './fixtures';

const prompt = 'Keep this unsent AI question 日本語';
const authKey = 'sb-connector-fixture-auth-token';
const fontFailures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = []; fontFailures.set(page, failures);
  page.on('response', response => { if (/\.woff2?(?:\?|$)/.test(response.url()) && !response.ok()) failures.push(`${response.status()} ${new URL(response.url()).pathname}`); });
});
test.afterEach(async ({ page }) => { expect(fontFailures.get(page), 'bundled local typography must load in the isolated worktree').toEqual([]); });

async function screenshot(page: Page, info: TestInfo, label: string) {
  const directory = process.env.AI_DRAFT_EVIDENCE_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${label}-${info.project.name}.png`);
  await page.screenshot({ path, fullPage: true, animations: 'disabled', scale: 'css' });
  await info.attach(`Disposable compiled-app fixture: ${label}`, { path, contentType: 'image/png' });
}

async function draftFixture(page: Page) {
  let account = user;
  let rows = structuredClone(boardRows);
  let logoutAttempts = 0;
  const writes: string[] = [];
  const aiCommands: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/ai/command') aiCommands.push(request.method());
  });
  await page.route('**/rest/v1/boards*', async route => {
    const request = route.request();
    if (request.method() !== 'GET') { writes.push(request.method()); return json(route, { error: 'No board writes expected in AI draft fixture' }, 500); }
    const url = new URL(request.url());
    const matching = rows.filter(row => !url.searchParams.has('user_id') || url.searchParams.get('user_id') === `eq.${row.user_id}`);
    return json(route, request.headers().accept?.includes('object+json') ? matching[0] ?? null : matching);
  });
  await page.route('**/auth/v1/**', async route => {
    if (new URL(route.request().url()).pathname.endsWith('/logout')) {
      logoutAttempts++;
      return logoutAttempts === 1 ? json(route, { code: 'unexpected_failure', msg: 'Disposable logout failure' }, 500) : route.fulfill({ status: 204, body: '' });
    }
    return json(route, account);
  });
  await page.route('**/api/ai/usage', route => json(route, { used: 0, limit: 10, remaining: 10 }));
  await page.route('**/api/connector*', route => json(route, { available: false, endpoint: null, connections: [], reason: 'Disposable AI navigation fixture' }));
  await page.route('https://zeroboard-media.trent-a60.workers.dev/**', route => route.fulfill({ status: 204 }));
  await page.route('https://board.zeroclickdev.ai/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Disposable preview</body></html>' }));
  return {
    writes, aiCommands, get logoutAttempts() { return logoutAttempts; },
    async authEvent(replaceAccount: boolean) {
      if (replaceAccount) {
        account = { ...user, id: '10000000-0000-4000-8000-000000000002', email: 'second-account@example.invalid' };
        rows = structuredClone(rows).map(row => ({ ...row, user_id: account.id }));
      } else {
        // Make SDK acceptance observable without changing this account's owner.
        account = { ...account, email: 'renewed-account@example.invalid' };
      }
      // Exercise the installed Auth SDK's multi-tab notification path in both
      // dev and compiled apps; never import a dev-only module or use live auth.
      const payload = Buffer.from(JSON.stringify({ sub: account.id, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
      const accessToken = `eyJhbGciOiJIUzI1NiJ9.${payload}.${replaceAccount ? 'disposable-replacement' : 'disposable-renewal'}`;
      await page.evaluate(({ key, nextUser, event, token }) => {
        const previous = JSON.parse(localStorage.getItem(key) ?? 'null');
        const next = { ...previous, user: nextUser, access_token: token, expires_at: Math.floor(Date.now() / 1000) + 3600 };
        localStorage.setItem(key, JSON.stringify(next));
        const channel = new BroadcastChannel(key);
        channel.postMessage({ event, session: next });
        channel.close();
      }, { key: authKey, nextUser: account, event: replaceAccount ? 'SIGNED_IN' : 'TOKEN_REFRESHED', token: accessToken });
    },
  };
}

async function accountThenBoard(page: Page) {
  await page.goto('/account');
  await page.getByRole('link', { name: 'Back to boards' }).click();
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => { await document.fonts.ready; return Array.from(document.fonts).some(font => font.family.replace(/^["']|["']$/g, '') === 'Geist Sans' && font.status === 'loaded'); }), 'real bundled Geist typography must be loaded before the behavior check').toBe(true);
}
async function openAI(page: Page) {
  await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
  const input = page.getByPlaceholder('What should we do next?');
  await expect(input).toBeVisible();
  return input;
}
async function closeAI(page: Page) {
  // The existing close icon has no text name. Anchor to its actual panel header.
  await page.getByRole('heading', { name: 'AI Assistant', exact: true }).locator('xpath=../../..').getByRole('button').last().click();
  await expect(page.getByPlaceholder('What should we do next?')).toBeHidden();
}
async function requestAccount(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
}
async function requestSignOut(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
}
async function preventsUnload(page: Page) {
  return page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; });
}

test('AI-only text blocks browser Back, preserves text and focus on Stay, and leaves explicitly', async ({ page }, info) => {
  const fixture = await draftFixture(page); await accountThenBoard(page);
  const input = await openAI(page); await input.fill(prompt); await input.focus();
  await page.goBack();
  const alert = page.getByRole('alertdialog', { name: 'Leave this page?' });
  await expect(alert).toBeVisible(); await expect(page).toHaveURL('/app');
  await expect(alert).toContainText('Your unsent AI text will be discarded');
  await expect(alert).not.toContainText('Open forms will close');
  await screenshot(page, info, 'visible-draft-warning');
  await alert.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(input).toHaveValue(prompt); await expect(input).toBeFocused();
  await screenshot(page, info, 'visible-draft-stay');
  expect(fixture.writes).toEqual([]);
  await page.goBack(); await alert.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(page).toHaveURL('/account');
  await page.getByRole('link', { name: 'Back to boards' }).click();
  await expect(await openAI(page)).toHaveValue('');
  expect(fixture.logoutAttempts).toBe(0); expect(fixture.writes).toEqual([]); expect(fixture.aiCommands).toEqual([]);
});

test('Clear chat and closing AI retain its hidden draft and truthful Account warning', async ({ page }, info) => {
  const fixture = await draftFixture(page); await accountThenBoard(page);
  const input = await openAI(page); await input.fill(prompt);
  await page.getByRole('button', { name: 'Clear chat', exact: true }).click();
  await expect(input).toHaveValue(prompt); await closeAI(page);
  expect(await preventsUnload(page)).toBe(true);
  await requestAccount(page);
  const alert = page.getByRole('alertdialog', { name: 'Leave this page?' });
  await expect(alert).toBeVisible(); await expect(alert).toContainText('Your unsent AI text');
  await expect(alert).not.toContainText('Open forms will close');
  await screenshot(page, info, 'hidden-draft-warning');
  await alert.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
  await expect(await openAI(page)).toHaveValue(prompt);
  await input.fill(''); expect(await preventsUnload(page)).toBe(false);
  await requestAccount(page); await expect(page).toHaveURL('/account');
  expect(fixture.writes).toEqual([]); expect(fixture.logoutAttempts).toBe(0); expect(fixture.aiCommands).toEqual([]);
});

test('hidden AI draft delays sign-out and survives a failed explicit attempt for retry', async ({ page }, info) => {
  const fixture = await draftFixture(page); await accountThenBoard(page);
  const input = await openAI(page); await input.fill(prompt); await closeAI(page);
  await requestSignOut(page);
  const alert = page.getByRole('alertdialog', { name: 'Sign out with unfinished work?' });
  await expect(alert).toBeVisible(); expect(fixture.logoutAttempts).toBe(0);
  await alert.getByRole('button', { name: 'Stay', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
  expect(fixture.logoutAttempts).toBe(0);
  await requestSignOut(page); await alert.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByText('Could not sign out. Try again.', { exact: true })).toBeVisible();
  await expect(page).toHaveURL('/app'); expect(fixture.logoutAttempts).toBe(1);
  await expect(await openAI(page)).toHaveValue(prompt); expect(await preventsUnload(page)).toBe(true);
  await screenshot(page, info, 'signout-failure-retained-draft');
  await closeAI(page); await requestSignOut(page); await expect(alert).toBeVisible();
  await alert.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/'); expect(fixture.logoutAttempts).toBe(2); expect(fixture.writes).toEqual([]); expect(fixture.aiCommands).toEqual([]);
});

test('same-owner token renewal keeps AI text while an actual SDK account replacement clears the old intent', async ({ page }) => {
  const fixture = await draftFixture(page); await accountThenBoard(page);
  const input = await openAI(page); await input.fill(prompt);
  expect(await preventsUnload(page)).toBe(true);
  await fixture.authEvent(false);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByText('renewed-account@example.invalid', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('menu')).toBeHidden();
  await expect(input).toHaveValue(prompt); expect(await preventsUnload(page)).toBe(true);
  await requestAccount(page); await expect(page.getByRole('alertdialog')).toBeVisible();
  await fixture.authEvent(true);
  await expect(page.getByRole('alertdialog')).toBeHidden(); await expect(input).toBeHidden(); await expect(page).toHaveURL('/app');
  await expect(await openAI(page)).toHaveValue(''); expect(await preventsUnload(page)).toBe(false);
  await input.fill('Second account unsent text'); expect(await preventsUnload(page)).toBe(true);
  await input.fill(''); expect(await preventsUnload(page)).toBe(false);
  expect(fixture.writes).toEqual([]); expect(fixture.logoutAttempts).toBe(0); expect(fixture.aiCommands).toEqual([]);
});

test('composing Enter keeps AI text guarded and accepted submission clears only the unsent reason', async ({ page }) => {
  const fixture = await draftFixture(page); await accountThenBoard(page);
  let requests = 0; let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/ai/command', async route => { requests++; await held; await json(route, { usage: { used: 10, limit: 10 } }, 429); });
  try {
    const input = await openAI(page); await input.fill(prompt);
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await input.dispatchEvent('keydown', { key: 'Enter', keyCode: 229 });
    await expect(input).toHaveValue(prompt); expect(requests).toBe(0); expect(await preventsUnload(page)).toBe(true);
    await input.press('Enter'); await expect(input).toHaveValue('');
    await expect.poll(() => requests).toBe(1); expect(await preventsUnload(page)).toBe(false);
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    release(); await expect(page.getByText('Daily limit reached — resets at midnight PT', { exact: true })).toBeVisible();
    const upgrade = page.getByRole('dialog', { name: 'Choose Your Plan' });
    await expect(upgrade).toBeVisible();
    await upgrade.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(upgrade).toBeHidden();
    await requestAccount(page); await expect(page).toHaveURL('/account');
    await expect(page.getByRole('alertdialog')).toBeHidden(); expect(requests).toBe(1); expect(fixture.writes).toEqual([]); expect(fixture.aiCommands).toEqual(['POST']);
  } finally { release(); }
});

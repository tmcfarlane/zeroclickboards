import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page, TestInfo } from '@playwright/test';
import { test, expect, json, BOARD_ID, OTHER_BOARD_ID, READ_ONLY_BOARD_ID } from './fixtures';
/* eslint-disable no-empty-pattern -- Playwright requires destructuring for fixture overrides. */

const endpoint = 'https://board.example.invalid/mcp';
const connection = {
  id: 'fixture-grant',
  clientName: 'ChatGPT',
  boardIds: [BOARD_ID],
  boards: [{ id: BOARD_ID, name: 'Product roadmap' }],
  scopes: ['boards:read', 'cards:add'],
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};
const ready = { available: true, endpoint, connections: [], clients: [
  { name: 'ChatGPT', clientId: 'zeroboard-review-client', callbackKinds: ['chatgpt'] },
  { name: 'Codex native', clientId: 'zeroboard-native-client', callbackKinds: ['native'] },
] };

async function screenshot(page: Page, info: TestInfo, name: string) {
  const directory = process.env.CONNECTOR_SCREENSHOT_DIR || resolve('test-results/connector-ui-evidence');
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${name}-${info.project.name}.png`);
  if (name === 'setup' && info.project.name === 'mobile') {
    await page.locator('#connectors').screenshot({ path, animations: 'disabled', scale: 'css' });
  } else {
    await page.screenshot({ path, fullPage: true, animations: 'disabled', scale: 'css' });
  }
  await info.attach(`Disposable fixture: ${name}`, { path, contentType: 'image/png' });
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test.describe('setup and access management', () => {
  test.use({ apiHandler: async ({}, provide) => { await provide(async (route) => { await json(route, ready); }); } });

  test('discover setup from the board account menu and copy the endpoint', async ({ page, apiCalls }, info) => {
    await page.goto('/app');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'ChatGPT & Codex' }).click();
    await expect(page).toHaveURL(/\/account#connectors$/);
    await expect(page.getByRole('heading', { name: 'ChatGPT & Codex', exact: true })).toBeVisible();
    await expect(page.getByText('Connection service ready', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Connection URL')).toHaveValue(endpoint);
    await page.getByRole('button', { name: 'Copy URL' }).click();
    await expect(page.getByRole('button', { name: 'URL copied', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(endpoint);
    await expect(page.getByLabel('ChatGPT OAuth client ID')).toHaveValue('zeroboard-review-client');
    await expect(page.getByText(/required OAuth client ID/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ChatGPT web setup' })).toBeVisible();
    expect(apiCalls.every((call) => call.method === 'GET')).toBe(true);
    await noHorizontalOverflow(page);
    await screenshot(page, info, 'setup');
  });

  test('clipboard denial offers manual copy without losing the endpoint', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => { throw new Error('Clipboard denied'); } },
      });
    });
    await page.goto('/account#connectors');
    await page.getByRole('button', { name: 'Copy URL' }).click();
    await expect(page.getByRole('alert')).toHaveText('Copy was blocked by your browser. Select the text and copy it manually.');
    await expect(page.getByLabel('Connection URL')).toHaveValue(endpoint);
  });

  test('native-only setup copies the required public client command without promising ChatGPT web', async ({ page, apiCalls }, info) => {
    await page.route('**/api/connector', route => json(route, { ...ready, clients: [
      { name: 'ChatGPT operator label', clientId: 'native-review-client', callbackKinds: ['native'] },
    ] }));
    await page.goto('/account#connectors');
    await expect(page.getByRole('heading', { name: 'Codex app & CLI setup' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'ChatGPT web setup' })).toHaveCount(0);
    await expect(page.getByLabel('ChatGPT operator label OAuth client ID')).toHaveValue('native-review-client');
    await page.getByRole('button', { name: 'Copy Codex command' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`codex mcp add zeroboard --url '${endpoint}' --oauth-client-id 'native-review-client' --oauth-resource '${endpoint}'`);
    await expect(page.getByRole('status')).toContainText('Complete setup in your client');
    expect(apiCalls.every(call => call.method === 'GET')).toBe(true);
    await noHorizontalOverflow(page);
    await screenshot(page, info, 'native-setup');
  });
});

test.describe('disconnect', () => {
  test.use({ apiHandler: async ({}, provide) => {
    let disconnected = false;
    await provide(async (route) => {
      if (route.request().method() === 'POST') { disconnected = true; return json(route, { success: true }); }
      await json(route, { ...ready, connections: disconnected ? [] : [connection] });
    });
  } });

  test('keeps an existing grant until explicit disconnect confirmation', async ({ page, apiCalls }, info) => {
    await page.goto('/account#connectors');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/Cards already added to ZeroBoard will stay/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep connection' }).click();
    expect(apiCalls.filter((call) => call.method === 'POST')).toEqual([]);
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await screenshot(page, info, 'disconnect-confirmation');
    await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByText(/No approved access yet/)).toBeVisible();
    expect(apiCalls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/connector', body: { action: 'revoke', connectionId: connection.id } },
    ]);
    await noHorizontalOverflow(page);
  });
});

test.describe('service failure', () => {
  test('a malformed successful status response stays inside the settings error UI', async ({ page }) => {
    await page.route('**/api/connector', (route) => json(route, { available: true, endpoint, connections: null }));
    await page.goto('/account#connectors');
    await expect(page.getByRole('alert')).toHaveText('The connection service returned an invalid response. Please try again.');
    await expect(page.getByRole('heading', { name: 'ChatGPT & Codex', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL' })).toHaveCount(0);
  });

  test('describes unavailable deployment configuration honestly', async ({ page }) => {
    await page.route('**/api/connector', (route) => json(route, {
      available: false,
      endpoint: null,
      connections: [],
      reason: 'Connections have not been configured on this deployment yet.',
    }));
    await page.goto('/account#connectors');
    await expect(page.getByText('Connection service unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Connections have not been configured on this deployment yet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Copy URL' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
    await noHorizontalOverflow(page);
  });

  test('retries a failed status request and recovers', async ({ page }) => {
    // Auth initialization can legitimately trigger more than one status request.
    // Recover only after the actual retry click, never while the user is still
    // looking at the initial failure. Capture runs before React issues its fetch.
    await page.addInitScript(() => {
      document.addEventListener('click', (event) => {
        const button = event.target instanceof Element ? event.target.closest('button') : null;
        if (button?.textContent?.trim() === 'Try again') document.documentElement.dataset.connectorRetryClicked = 'true';
      }, true);
    });
    await page.route('**/api/connector', async (route) => {
      const retried = await page.evaluate(() => document.documentElement.dataset.connectorRetryClicked === 'true');
      await json(route, retried ? ready : { error: 'Connection service temporarily unavailable.' }, retried ? 200 : 503);
    });
    await page.goto('/account#connectors');
    await expect(page.getByRole('alert')).toHaveText('Connection service temporarily unavailable.');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByText('Connection service ready', { exact: true })).toBeVisible();
  });

  test('failed revoke retains the grant and offers another confirmation attempt', async ({ page }) => {
    await page.route('**/api/connector', (route) => json(route,
      route.request().method() === 'POST' ? { error: 'Unable to disconnect. Please try again.' } : { ...ready, connections: [connection] },
      route.request().method() === 'POST' ? 503 : 200));
    await page.goto('/account#connectors');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('alertdialog').getByRole('alert')).toHaveText('Unable to disconnect. Please try again.');
    await expect(page.getByText(/1 selected board/)).toBeVisible();
  });

  test('a successful HTTP response without revoke acknowledgement keeps the connection', async ({ page }) => {
    await page.route('**/api/connector', (route) => json(route,
      route.request().method() === 'POST' ? { success: false } : { ...ready, connections: [connection] }));
    await page.goto('/account#connectors');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Disconnect', exact: true }).click();
    await expect(page.getByRole('alertdialog').getByRole('alert')).toHaveText('The connection service returned an invalid response. Please try again.');
    await expect(page.getByText(/1 selected board/)).toBeVisible();
    await expect(page.getByText(/No approved access yet/)).toHaveCount(0);
  });
});

const consent = {
  clientName: 'ChatGPT',
  scopes: ['boards:read', 'cards:add'],
  boards: [
    { id: BOARD_ID, name: 'Product roadmap', canAddCards: true },
    { id: OTHER_BOARD_ID, name: 'Private research', canAddCards: true },
    { id: READ_ONLY_BOARD_ID, name: 'Company announcements', canAddCards: false },
  ],
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};

test.describe('OAuth consent', () => {
  test.use({ apiHandler: async ({}, provide) => { await provide(async (route) => {
    if (route.request().method() === 'GET') return json(route, consent);
    const body = route.request().postDataJSON();
    return json(route, body.action === 'cancel'
      ? { cancelled: true }
      : { redirectUrl: 'https://client.example.invalid/oauth/callback?code=disposable-code&state=client-state' });
  }); } });

  test('shares only explicitly selected editable boards and returns to the client', async ({ page, apiCalls }, info) => {
    await page.route('https://client.example.invalid/oauth/callback?**', (route) => route.fulfill({ contentType: 'text/html', body: '<h1>Disposable client callback reached</h1>' }));
    await page.goto('/auth/connector?request=disposable-request');
    await expect(page.getByRole('heading', { name: 'Connect ChatGPT to ZeroBoard' })).toBeVisible();
    const approve = page.getByRole('button', { name: 'Allow connection', exact: true });
    await expect(approve).toBeDisabled();
    const first = page.getByRole('checkbox', { name: 'Product roadmap', exact: true });
    const second = page.getByRole('checkbox', { name: 'Private research', exact: true });
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Company announcements/ })).toBeDisabled();
    await first.check();
    await expect(approve).toBeEnabled();
    await expect(second).not.toBeChecked();
    await noHorizontalOverflow(page);
    await screenshot(page, info, 'consent-selected');
    await approve.click();
    await expect(page).toHaveURL('https://client.example.invalid/oauth/callback?code=disposable-code&state=client-state');
    expect(apiCalls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/connector', body: { action: 'approve', request: 'disposable-request', boardIds: [BOARD_ID] } },
    ]);
  });

  test('cancellation sends no board selection or approval', async ({ page, apiCalls }) => {
    await page.goto('/auth/connector?request=disposable-request');
    await page.getByRole('checkbox', { name: 'Product roadmap', exact: true }).check();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Connection cancelled' })).toBeVisible();
    expect(apiCalls.filter((call) => call.method === 'POST')).toEqual([
      { method: 'POST', path: '/api/connector', body: { action: 'cancel', request: 'disposable-request' } },
    ]);
  });
});

test.describe('consent validation', () => {
  test('malformed board permissions fail closed instead of enabling access', async ({ page }) => {
    await page.route('**/api/connector?**', (route) => json(route, { ...consent,
      boards: [{ id: BOARD_ID, name: 'Product roadmap', canAddCards: 'false' }] }));
    await page.goto('/auth/connector?request=disposable-request');
    await expect(page.getByRole('alert')).toHaveText('The connection service returned an invalid response. Please try again.');
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
  });

  test('an expired request fails visibly without offering approval', async ({ page }) => {
    await page.route('**/api/connector?**', (route) => json(route, { error: 'This connection request has expired. Restart setup in your client.' }, 400));
    await page.goto('/auth/connector?request=expired-request');
    await expect(page.getByRole('alert')).toHaveText('This connection request has expired. Restart setup in your client.');
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toHaveCount(0);
  });

  test('unknown permissions cannot be approved', async ({ page }) => {
    await page.route('**/api/connector?**', (route) => json(route, { ...consent, scopes: ['boards:read', 'cards:delete'] }));
    await page.goto('/auth/connector?request=disposable-request');
    await expect(page.getByRole('alert')).toHaveText('This client requested an unsupported permission. Cancel and restart setup.');
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Product roadmap', exact: true })).toBeDisabled();
  });

  test('no editable boards blocks approval with a useful next action', async ({ page }) => {
    await page.route('**/api/connector?**', (route) => json(route, { ...consent, boards: [] }));
    await page.goto('/auth/connector?request=disposable-request');
    await expect(page.getByText('You have no boards available to share. Create a board in ZeroBoard, then restart setup.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeDisabled();
  });

  test('approval failure retains the selection for retry', async ({ page }) => {
    await page.route('**/api/connector?**', (route) => json(route, consent));
    await page.route('**/api/connector', (route) => json(route, { error: 'Connection service temporarily unavailable.' }, 503));
    await page.goto('/auth/connector?request=disposable-request');
    await page.getByRole('checkbox', { name: 'Product roadmap', exact: true }).check();
    await page.getByRole('button', { name: 'Allow connection', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Connection service temporarily unavailable.');
    await expect(page.getByRole('checkbox', { name: 'Product roadmap', exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeEnabled();
  });

  for (const redirectUrl of ['javascript:alert(1)', 'http://client.example.invalid/oauth/callback']) {
    test(`rejects an unsafe callback (${new URL(redirectUrl).protocol}) without navigation`, async ({ page }) => {
      await page.route('**/api/connector?**', (route) => json(route, consent));
      await page.route('**/api/connector', (route) => json(route, { redirectUrl }));
      await page.goto('/auth/connector?request=disposable-request');
      await page.getByRole('checkbox', { name: 'Product roadmap', exact: true }).check();
      await page.getByRole('button', { name: 'Allow connection', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveText('The connection returned an invalid return address. Restart setup in your client.');
      await expect(page).toHaveURL(/\/auth\/connector\?request=disposable-request$/);
    });
  }

  test('a read-only request permits sharing a viewer board without requesting writes', async ({ page }) => {
    await page.route('**/api/connector?**', (route) => json(route, { ...consent, scopes: ['boards:read'] }));
    await page.goto('/auth/connector?request=disposable-request');
    const viewerBoard = page.getByRole('checkbox', { name: 'Company announcements', exact: true });
    await expect(viewerBoard).toBeEnabled();
    await viewerBoard.check();
    await expect(page.getByRole('button', { name: 'Allow connection', exact: true })).toBeEnabled();
    await expect(page.getByText('Add cards after you approve a preview', { exact: true })).toHaveCount(0);
  });

  test('signed-out visitors can sign in while preserving their consent request', async ({ page }) => {
    await page.addInitScript(() => { localStorage.removeItem('sb-connector-fixture-auth-token'); });
    await page.goto('/auth/connector?request=disposable-request');
    await expect(page.getByRole('heading', { name: 'Connect your ZeroBoard account' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign in to continue' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page).toHaveURL(/request=disposable-request$/);
  });

  test('opening consent directly explains how to start a connection', async ({ page, apiCalls }) => {
    await page.goto('/auth/connector');
    await expect(page.getByRole('heading', { name: 'Start in ChatGPT or Codex' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View connection setup' })).toHaveAttribute('href', '/account#connectors');
    expect(apiCalls).toEqual([]);
  });
});

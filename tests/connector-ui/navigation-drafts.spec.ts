import { test, expect, BOARD_ID, OTHER_BOARD_ID, boardRows, user, json } from './fixtures';
import type { Locator, Page } from '@playwright/test';

async function navigationFixture(page: Page, holdWrites = false) {
  let account = user;
  let readonly = false;
  let rows = structuredClone(boardRows).map((row, index) => ({ ...row, data: { columns: [
    { id: index ? 'research' : 'todo', title: 'To Do', order: 0, cards: index ? [] : [{ id: 'design-card', title: 'Design pricing page', content: { type: 'text', text: 'Existing details' }, labels: ['green'], isArchived: false, createdAt: row.created_at, updatedAt: row.updated_at }] },
    { id: index ? 'research-done' : 'doing', title: 'In Progress', order: 1, cards: [] },
  ] } }));
  const writes: Array<{ method: string; boardId: string; body: unknown }> = [];
  const acknowledgements: Array<() => Promise<void>> = [];
  let logoutRequests = 0;
  await page.route('https://zeroboard-media.trent-a60.workers.dev/**', route => route.fulfill({ status: 204 }));
  await page.route('https://board.zeroclickdev.ai/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Disposable preview</body></html>' }));
  await page.route('**/auth/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/logout')) { logoutRequests++; return route.fulfill({ status: 204 }); }
    if (path.endsWith('/token')) {
      account = { ...user, id: '10000000-0000-4000-8000-000000000002', email: 'second-account@example.invalid' };
      rows = structuredClone(rows).map(row => ({ ...row, user_id: account.id }));
      return json(route, { user: account, access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: account.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.disposable-fixture`, refresh_token: 'disposable-second-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    return json(route, account);
  });
  await page.route('**/rest/v1/boards*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() !== 'GET') {
      const id = request.method() === 'POST' ? request.postDataJSON().id : url.searchParams.get('id')?.replace(/^eq\./, '');
      const body = request.postDataJSON();
      writes.push({ method: request.method(), boardId: id, body });
      let row = rows.find(candidate => candidate.id === id);
      if (row) Object.assign(row, body, { updated_at: new Date().toISOString() });
      else { row = { ...body, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }; rows.push(row!); }
      const saved = structuredClone(row);
      if (holdWrites) {
        let released = false;
        return new Promise<void>(resolve => acknowledgements.push(async () => {
          if (released) return;
          released = true;
          try { await json(route, request.headers().accept?.includes('object+json') ? saved : [saved]); } finally { resolve(); }
        }));
      }
      return json(route, request.headers().accept?.includes('object+json') ? saved : [saved]);
    }
    const idQuery = url.searchParams.get('id');
    const matching = rows.filter(row => (!url.searchParams.has('user_id') || `eq.${row.user_id}` === url.searchParams.get('user_id'))
      && (!idQuery || `eq.${row.id}` === idQuery || idQuery.startsWith('in.(') && idQuery.slice(4, -1).split(',').includes(row.id)));
    return json(route, request.headers().accept?.includes('object+json') ? matching[0] ?? null : matching);
  });
  await page.route('**/rest/v1/board_members*', route => {
    const select = new URL(route.request().url()).searchParams.get('select');
    return json(route, readonly && !select?.includes('profiles') ? [{ board_id: BOARD_ID, role: 'viewer' }] : []);
  });
  await page.route('**/rest/v1/board_invites*', route => json(route, []));
  await page.route('**/rest/v1/card_activities*', route => json(route, []));
  await page.route('**/api/connector*', route => json(route, { available: false, endpoint: null, connections: [], reason: 'Disposable navigation fixture' }));
  await page.route('**/api/ai/usage', route => json(route, { used: 0, limit: 10, remaining: 10 }));
  return {
    writes, acknowledgements, get logoutRequests() { return logoutRequests; },
    async downgrade() {
      readonly = true; rows[0].user_id = '30000000-0000-4000-8000-000000000001';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
  };
}

async function accountThenBoard(page: Page) {
  await page.goto('/account'); await page.getByRole('link', { name: 'Back to boards' }).click();
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
}
async function requestAccount(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click(); await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
}
type Draft = 'new-card' | 'existing-card' | 'rename-board' | 'add-column' | 'new-board' | 'share-email';
async function openDraft(page: Page, kind: Draft, isMobile: boolean) {
  let input: Locator;
  if (kind === 'new-card' || kind === 'existing-card') {
    if (kind === 'new-card') await page.keyboard.press('KeyN');
    else await page.getByRole('button', { name: 'Design pricing page', exact: true }).click();
    input = page.getByRole('dialog', { name: kind === 'new-card' ? 'Create Card' : 'Edit Card' }).getByPlaceholder('Card title...');
  } else if (kind === 'rename-board') {
    await page.getByRole('button', { name: 'Product roadmap', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Actions for Product roadmap board', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    input = page.getByRole('textbox', { name: 'Board Name' });
  } else if (kind === 'add-column') {
    await page.getByRole('button', { name: 'Board actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Add Column', exact: true }).click();
    input = page.getByRole('textbox', { name: 'Column Title' });
  } else if (kind === 'new-board') {
    await page.getByRole('button', { name: 'New Board', exact: true }).click();
    await page.getByRole('dialog', { name: 'Create New Board' }).getByRole('button', { name: 'Advanced options' }).click();
    input = page.getByRole('textbox', { name: 'Name', exact: true });
  } else {
    if (isMobile) { await page.getByRole('button', { name: 'Board actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Share', exact: true }).click(); }
    else await page.getByRole('button', { name: 'Share', exact: true }).click();
    input = page.getByRole('textbox', { name: 'Invite email address' });
  }
  const text = kind === 'share-email' ? 'keep-draft@example.invalid' : `Keep my ${kind} draft`;
  await input.fill(text); await input.focus();
  return { input, text };
}

for (const kind of ['new-card', 'existing-card', 'rename-board', 'add-column', 'new-board', 'share-email'] as const) {
  test(`browser Back keeps ${kind} text and focus on Stay and leaves only after an explicit decision`, async ({ page, isMobile }) => {
    const fixture = await navigationFixture(page); await accountThenBoard(page);
    const { input, text } = await openDraft(page, kind, isMobile);
    await page.goBack(); const alert = page.getByRole('alertdialog', { name: 'Leave this page?' });
    await expect(alert).toBeVisible(); await expect(page).toHaveURL('/app');
    await expect(alert.getByRole('button', { name: 'Stay' })).toBeFocused();
    await alert.getByRole('button', { name: 'Stay' }).click();
    await expect(input).toHaveValue(text); await expect(input).toBeFocused(); expect(fixture.writes).toEqual([]);
    await page.goBack(); await alert.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(page).toHaveURL('/account'); await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
    expect(fixture.writes).toEqual([]);
  });
}

test('browser Forward and repeated history attempts retain one current guard and the exact destination', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page); await accountThenBoard(page); await requestAccount(page);
  await expect(page).toHaveURL('/account'); await page.goBack(); await expect(page).toHaveURL('/app');
  const { input, text } = await openDraft(page, 'new-card', isMobile);
  await page.goForward(); const alert = page.getByRole('alertdialog', { name: 'Leave this page?' }); await expect(alert).toBeVisible(); await expect(page).toHaveURL('/app');
  await page.goForward(); await expect(alert).toHaveCount(1); await expect(page).toHaveURL('/app');
  await alert.getByRole('button', { name: 'Stay' }).click(); await expect(input).toHaveValue(text); await expect(input).toBeFocused();
  await page.goForward(); await alert.getByRole('button', { name: 'Leave' }).click(); await expect(page).toHaveURL('/account');
  expect(fixture.writes).toEqual([]);
});

test('the navigation alert traps focus and ignores composing Enter and Escape without closing the draft', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page); await accountThenBoard(page); const { input, text } = await openDraft(page, 'rename-board', isMobile);
  await page.goBack(); const alert = page.getByRole('alertdialog', { name: 'Leave this page?' });
  const stay = alert.getByRole('button', { name: 'Stay' }); const leave = alert.getByRole('button', { name: 'Leave' });
  await expect(stay).toBeFocused(); await page.keyboard.press('Shift+Tab'); await expect(leave).toBeFocused();
  await page.keyboard.press('Tab'); await expect(stay).toBeFocused();
  for (const isComposing of [true, false]) {
    for (const key of ['Enter', 'Escape']) await stay.dispatchEvent('keydown', { key, code: key, isComposing, keyCode: isComposing ? undefined : 229, bubbles: true, cancelable: true });
    await expect(alert).toBeVisible();
  }
  await stay.press('Escape'); await expect(alert).not.toBeVisible(); await expect(input).toHaveValue(text); await expect(input).toBeFocused(); expect(fixture.writes).toEqual([]);
});

test('navigation confirmation contains global shortcuts without creating a second form behind it', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page); await accountThenBoard(page); const { input, text } = await openDraft(page, 'rename-board', isMobile);
  await page.goBack(); const alert = page.getByRole('alertdialog', { name: 'Leave this page?' });
  await expect(alert.getByRole('button', { name: 'Stay' })).toBeFocused();
  await page.keyboard.press('KeyN');
  await expect(page.getByRole('dialog', { name: 'Create Card', includeHidden: true })).toHaveCount(0);
  await page.keyboard.press('Shift+KeyN');
  await expect(page.getByRole('dialog', { name: 'Create New Board', includeHidden: true })).toHaveCount(0);
  await alert.getByRole('button', { name: 'Stay' }).click();
  await expect(input).toHaveValue(text); await expect(input).toBeFocused(); expect(fixture.writes).toEqual([]);
});

test('a failed lazy board route retains the custom Reload App recovery boundary', async ({ page }) => {
  await navigationFixture(page);
  await page.route('**/src/components/layout/AppShell.tsx*', route => route.abort('failed'));
  await page.goto('/account'); await page.getByRole('link', { name: 'Back to boards' }).click();
  await expect(page.getByRole('heading', { name: 'Something went wrong' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reload App' })).toBeVisible();
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
});

test('Stay retains a downgraded form without allowing a save or changing its target', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page); await accountThenBoard(page); const { input, text } = await openDraft(page, 'new-card', isMobile);
  await fixture.downgrade(); const card = page.getByRole('dialog', { name: 'Create Card' }); await expect(card.getByRole('alert')).toContainText('editing access');
  await page.goBack(); const alert = page.getByRole('alertdialog', { name: 'Leave this page?' }); await alert.getByRole('button', { name: 'Stay' }).click();
  await expect(input).toHaveValue(text); await expect(card.getByRole('button', { name: 'Add Card', exact: true })).toBeDisabled();
  await input.press('Enter'); await expect(card).toBeVisible(); expect(fixture.writes).toEqual([]);
});

test('a real card save continues for the same account after leaving while its acknowledgement is held', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page, true);
  try {
    await accountThenBoard(page); const { input, text } = await openDraft(page, 'new-card', isMobile);
    await input.press('Enter'); await expect(page.getByRole('dialog', { name: 'Create Card' })).not.toBeVisible(); await expect.poll(() => fixture.acknowledgements.length).toBe(1);
    await requestAccount(page); const alert = page.getByRole('alertdialog', { name: 'Leave this page?' });
    await expect(alert).toContainText('Saving can continue while you stay signed in'); await expect(alert).not.toContainText('discarded');
    await alert.getByRole('button', { name: 'Stay' }).click(); await expect(page.getByRole('button', { name: text, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).not.toHaveJSProperty('tagName', 'BODY');
    await expect(page.locator(':focus')).toBeVisible();
    await requestAccount(page); await alert.getByRole('button', { name: 'Leave' }).click(); await expect(page).toHaveURL('/account');
    await fixture.acknowledgements[0](); await page.getByRole('link', { name: 'Back to boards' }).click();
    await expect(page.getByRole('button', { name: text, exact: true })).toBeVisible(); expect(fixture.writes).toHaveLength(1); expect(fixture.writes[0]).toMatchObject({ method: 'PATCH', boardId: BOARD_ID });
    await requestAccount(page); await expect(page).toHaveURL('/account'); await expect(alert).not.toBeVisible();
  } finally { await Promise.allSettled(fixture.acknowledgements.map(release => release())); }
});

test('intentional sign-out waits for an explicit decision and makes exactly one auth request', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page, true);
  try {
    await accountThenBoard(page); const { input } = await openDraft(page, 'new-card', isMobile); await input.press('Enter');
    await expect.poll(() => fixture.acknowledgements.length).toBe(1);
    await page.getByRole('button', { name: 'Account menu' }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    const alert = page.getByRole('alertdialog', { name: 'Sign out with unfinished work?' }); await expect(alert).toContainText('before signing out');
    expect(fixture.logoutRequests).toBe(0); await alert.getByRole('button', { name: 'Stay' }).click(); expect(fixture.logoutRequests).toBe(0); await expect(page).toHaveURL('/app');
    await expect(page.getByRole('button', { name: 'Account menu' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.locator(':focus')).not.toHaveJSProperty('tagName', 'BODY');
    await expect(page.locator(':focus')).toBeVisible();
    await page.getByRole('button', { name: 'Account menu' }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await alert.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page).toHaveURL('/'); expect(fixture.logoutRequests).toBe(1);
    await fixture.acknowledgements[0](); expect(fixture.writes).toHaveLength(1);
  } finally { await Promise.allSettled(fixture.acknowledgements.map(release => release())); }
});

test('board query cleanup selects its target without a warning and saving stays on that board', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page);
  await page.goto(`/app?board=${OTHER_BOARD_ID}`); await expect(page).toHaveURL('/app');
  await expect(page.getByRole('button', { name: 'Private research', exact: true })).toBeVisible(); await expect(page.getByRole('alertdialog')).not.toBeVisible();
  const { input, text } = await openDraft(page, 'new-card', isMobile); await input.press('Enter');
  await expect(page.getByRole('button', { name: text, exact: true })).toBeVisible(); await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toMatchObject({ method: 'PATCH', boardId: OTHER_BOARD_ID });
});

test('a real auth-client replacement clears private local panels and an old navigation intent', async ({ page, isMobile }) => {
  const fixture = await navigationFixture(page); await accountThenBoard(page); const { text } = await openDraft(page, 'new-card', isMobile);
  await page.goBack(); await expect(page.getByRole('alertdialog')).toBeVisible();
  // Exercise the public auth client and its actual AuthProvider callback while
  // the old form is mounted. Transport and credentials are disposable fixtures.
  const error = await page.evaluate(async () => {
    const moduleUrl = '/src/lib/supabase.ts';
    const { supabase } = await import(/* @vite-ignore */ moduleUrl);
    const result = await supabase.auth.signInWithPassword({ email: 'second-account@example.invalid', password: 'disposable-password' });
    return result.error?.message ?? null;
  });
  expect(error).toBeNull(); await expect(page.getByRole('alertdialog')).not.toBeVisible(); await expect(page.getByRole('dialog', { name: 'Create Card' })).not.toBeVisible(); await expect(page).toHaveURL('/app');
  await page.getByRole('button', { name: 'Account menu' }).click(); await expect(page.getByText('second-account@example.invalid', { exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Account', exact: true }).click(); await expect(page).toHaveURL('/account');
  expect(fixture.writes).toEqual([]); await expect(page.getByText(text, { exact: true })).not.toBeVisible();
});

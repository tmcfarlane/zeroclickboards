import { test, expect, BOARD_ID, USER_ID, boardRows, json } from './fixtures';
import type { Page } from '@playwright/test';

type Role = 'owner' | 'editor' | 'viewer' | 'commenter';

async function installBoard(page: Page, initialRole: Role = 'owner', hidden = false) {
  let role = initialRole;
  let deleted = false;
  const today = await page.evaluate(() => {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  });
  const board = {
    ...structuredClone(boardRows[0]),
    user_id: initialRole === 'owner' ? USER_ID : '30000000-0000-4000-8000-000000000001',
    data: {
      columns: [
        { id: 'todo', title: 'To Do', order: 0, cards: [{ id: 'design-card', title: 'Design pricing page', targetDate: today, labels: ['green'], content: { type: 'text', text: 'Review mobile conversion' }, createdAt: boardRows[0].created_at, updatedAt: boardRows[0].updated_at }] },
        { id: 'doing', title: 'In Progress', order: 1, cards: [] },
      ],
      hiddenColumnIds: hidden ? ['todo', 'doing'] : [],
    },
  };
  const writes: string[] = [];
  await page.route('**/rest/v1/boards*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      writes.push(request.method());
      Object.assign(board, request.postDataJSON(), { updated_at: new Date().toISOString() });
    }
    const ownedQuery = url.searchParams.get('user_id') === `eq.${USER_ID}`;
    const rows = deleted || (ownedQuery && board.user_id !== USER_ID) ? [] : [board];
    await json(route, request.headers().accept?.includes('object+json') ? rows[0] ?? null : rows);
  });
  await page.route('**/rest/v1/board_members*', async (route) => {
    const rows = deleted || role === 'owner' ? [] : [{ board_id: BOARD_ID, role }];
    await json(route, route.request().headers().accept?.includes('object+json') ? rows[0] ?? null : rows);
  });
  await page.route('**/rest/v1/card_activities*', async (route) => {
    if (route.request().method() !== 'GET') writes.push('activity');
    await json(route, []);
  });
  return {
    writes,
    async downgrade() {
      role = 'viewer';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
    async transferOwnership() {
      board.user_id = '30000000-0000-4000-8000-000000000001';
      role = 'editor';
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
    async deleteRemotely() {
      deleted = true;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
  };
}

async function openBoard(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
}

test('slash search reaches a visible field from board and timeline', async ({ page }) => {
  await installBoard(page);
  await openBoard(page);
  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: 'Search cards' });
  await expect(search).toBeFocused();
  await search.fill('pricing');
  await expect(search).toHaveValue('pricing');
  await search.fill('');
  await search.press('Tab');
  await page.keyboard.press('KeyT');
  await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search cards' })).toBeFocused();
  await page.keyboard.type('new search');
  await expect(page.getByRole('textbox', { name: 'Search cards' })).toHaveValue('new search');
});

async function openShare(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole('button', { name: 'Board actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  } else await page.getByRole('button', { name: 'Share', exact: true }).click();
  return page.getByRole('dialog', { name: 'Share "Product roadmap"' });
}

async function installSharing(page: Page, zeroRows = false) {
  let invites = [{ id: 'pending-invite', email: 'pat@example.invalid', role: 'viewer', created_at: boardRows[0].created_at }];
  let members = [{ id: 'shared-member', user_id: '40000000-0000-4000-8000-000000000001', board_id: BOARD_ID, role: 'viewer', created_at: boardRows[0].created_at, invited_by: USER_ID, profiles: { email: 'member@example.invalid', full_name: 'Pat Member', avatar_url: null } }];
  const writes: { method: string; boardId: string | null }[] = [];
  const noRows = { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned', hint: null };
  await page.route('**/rest/v1/board_invites*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return json(route, invites);
    const url = new URL(request.url());
    writes.push({ method: request.method(), boardId: url.searchParams.get('board_id') });
    if (zeroRows) return url.searchParams.has('select') ? json(route, noRows, 406) : json(route, []);
    invites = [];
    return json(route, { id: 'pending-invite' });
  });
  await page.route('**/rest/v1/board_members*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET') {
      if (!url.searchParams.get('select')?.includes('profiles')) return route.fallback();
      return json(route, members);
    }
    writes.push({ method: request.method(), boardId: url.searchParams.get('board_id') });
    if (zeroRows) return url.searchParams.has('select') ? json(route, noRows, 406) : json(route, []);
    members = [];
    return json(route, { id: 'shared-member' });
  });
  return { writes };
}

test('a zero-row invite deletion retains the invite and reports failure', async ({ page, isMobile }) => {
  await installBoard(page);
  const sharing = await installSharing(page, true);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await share.getByTitle('Revoke invite').click();
  await expect(page.getByText('Failed to revoke invite', { exact: true })).toBeVisible();
  await expect(share.getByText('pat@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('Invite revoked', { exact: true })).not.toBeVisible();
  expect(sharing.writes).toEqual([{ method: 'DELETE', boardId: `eq.${BOARD_ID}` }]);
});

test('a zero-row member deletion retains the member and reports failure', async ({ page, isMobile }) => {
  await installBoard(page);
  await installSharing(page, true);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await share.getByRole('button', { name: 'Remove member@example.invalid', exact: true }).click();
  await expect(page.getByText('Failed to remove member', { exact: true })).toBeVisible();
  await expect(share.getByText('member@example.invalid', { exact: true })).toBeVisible();
  await expect(page.getByText('Member removed', { exact: true })).not.toBeVisible();
});

test('confirmed owner removals update the sharing list', async ({ page, isMobile }) => {
  await installBoard(page);
  const sharing = await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await share.getByRole('button', { name: 'Revoke invitation to pat@example.invalid', exact: true }).click();
  await expect(page.getByText('Invite revoked', { exact: true })).toBeVisible();
  await expect(share.getByText('pat@example.invalid', { exact: true })).not.toBeVisible();
  await share.getByRole('button', { name: 'Remove member@example.invalid', exact: true }).click();
  await expect(page.getByText('Member removed', { exact: true })).toBeVisible();
  await expect(share.getByText('member@example.invalid', { exact: true })).not.toBeVisible();
  expect(sharing.writes).toEqual([{ method: 'DELETE', boardId: `eq.${BOARD_ID}` }, { method: 'DELETE', boardId: `eq.${BOARD_ID}` }]);
});

test('an editor cannot open owner sharing controls', async ({ page, isMobile }) => {
  await installBoard(page, 'editor');
  await openBoard(page);
  if (isMobile) {
    await page.getByRole('button', { name: 'Board actions', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).not.toBeVisible();
  } else await expect(page.getByRole('button', { name: 'Share', exact: true })).not.toBeVisible();
});

test('an ownership change disables an open sharing dialog and retains invitation text', async ({ page, isMobile, apiCalls }) => {
  const fixture = await installBoard(page);
  const sharing = await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('textbox', { name: 'Invite email address', exact: true }).fill('keep@example.invalid');
  await fixture.transferOwnership();
  await expect(share.getByRole('alert')).toContainText('Only the board owner');
  await expect(share.getByRole('textbox', { name: 'Invite email address', exact: true })).toHaveValue('keep@example.invalid');
  await expect(share.getByRole('button', { name: 'Send invitation', exact: true })).toBeDisabled();
  await expect(share.getByRole('switch', { name: 'Public board' })).toBeDisabled();
  await expect(share.getByRole('switch', { name: 'Enable embedding' })).toBeDisabled();
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await expect(share.getByRole('button', { name: 'Remove member@example.invalid', exact: true })).toBeDisabled();
  await expect(share.getByRole('button', { name: 'Revoke invitation to pat@example.invalid', exact: true })).toBeDisabled();
  expect(sharing.writes).toEqual([]);
  expect(fixture.writes).toEqual([]);
  expect(apiCalls.filter((call) => call.path === '/api/invite/send')).toEqual([]);
});

test('a remotely deleted board keeps card draft recovery without writing the original board', async ({ page }) => {
  const fixture = await installBoard(page);
  await openBoard(page);
  await page.getByRole('button', { name: 'Design pricing page', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Card' });
  await editor.getByPlaceholder('Card title...').fill('Recover this draft');
  await fixture.deleteRemotely();
  await expect(page.getByText('No board selected', { exact: true })).toBeVisible();
  await expect(editor.getByPlaceholder('Card title...')).toHaveValue('Recover this draft');
  await expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeEnabled();
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Save as a new board', exact: true })).toBeVisible();
  await expect(page.getByText('Recover this draft', { exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('all-hidden columns provide recovery without a targetless card creator', async ({ page, isMobile }) => {
  const fixture = await installBoard(page, 'owner', true);
  await openBoard(page);
  await expect(page.getByText('All columns are hidden', { exact: true })).toBeVisible();
  if (isMobile) await expect(page.getByRole('button', { name: 'Add Card', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Show all columns' }).click();
  await expect(page.getByRole('button', { name: 'Design pricing page', exact: true })).toBeVisible();
  await expect.poll(() => fixture.writes).toEqual(['PATCH']);
  await expect(page.getByText('Saving changes…', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Design pricing page', exact: true })).toBeVisible();
});

test('keyboard board submenu reaches rename and delete confirmation', async ({ page }) => {
  await installBoard(page);
  await openBoard(page);
  await page.getByRole('button', { name: 'Product roadmap', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'New Board', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Product roadmap', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Actions for Product roadmap board', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('menuitem', { name: 'Rename', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  const rename = page.getByRole('dialog', { name: 'Rename Board' });
  await expect(rename.getByRole('textbox', { name: 'Board Name' })).toBeFocused();
  await rename.getByRole('textbox', { name: 'Board Name' }).fill('Keyboard roadmap');
  await rename.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Keyboard roadmap', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keyboard roadmap', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Actions for Keyboard roadmap board', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete Board' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Keyboard roadmap', exact: true })).toBeVisible();
});

for (const role of ['viewer', 'commenter'] as const) {
  test(`${role} app boards stay searchable and read-only`, async ({ page }) => {
    const fixture = await installBoard(page, role);
    await openBoard(page);
    await expect(page.getByText('Read-only board', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Card', exact: true })).not.toBeVisible();
    await page.keyboard.press('KeyN');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await page.keyboard.press('/');
    const search = page.getByRole('textbox', { name: 'Search cards' });
    await expect(search).toBeFocused();
    await search.fill('missing task');
    await expect(page.getByText('Design pricing page', { exact: true })).not.toBeVisible();
    await search.fill('');
    await expect(page.getByText('Design pricing page', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Product roadmap', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Actions for Product roadmap board', exact: true })).not.toBeVisible();
    await page.keyboard.press('Escape');
    expect(fixture.writes).toEqual([]);
  });
}

for (const mode of ['edit', 'create'] as const) {
  test(`role downgrade preserves an open ${mode} card draft and blocks writes`, async ({ page }) => {
    const fixture = await installBoard(page, 'editor');
    await openBoard(page);
    if (mode === 'edit') await page.getByRole('button', { name: 'Design pricing page', exact: true }).click();
    else await page.keyboard.press('KeyN');
    const editor = page.getByRole('dialog', { name: mode === 'edit' ? 'Edit Card' : 'Create Card' });
    await editor.getByPlaceholder('Card title...').fill('Keep this draft');
    await fixture.downgrade();
    await expect(editor.getByRole('alert')).toContainText('no longer have editing access');
    await expect(editor.getByPlaceholder('Card title...')).toHaveValue('Keep this draft');
    await expect(editor.getByRole('button', { name: mode === 'edit' ? 'Save' : 'Add Card', exact: true })).toBeDisabled();
    await editor.getByPlaceholder('Card title...').press('Enter');
    await expect(editor).toBeVisible();
    expect(fixture.writes).toEqual([]);
  });
}

test('timeline downgrade retains the title draft and blocks blur and Enter saves', async ({ page }) => {
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  await page.getByRole('button', { name: 'Timeline', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Design pricing page', exact: true }).click();
  const title = page.getByRole('textbox', { name: 'Title', exact: true });
  await title.fill('Unsaved timeline title');
  await fixture.downgrade();
  await expect(page.getByRole('alert')).toContainText('title draft is kept');
  await expect(title).toHaveValue('Unsaved timeline title');
  await title.press('Enter');
  await expect(title).toBeVisible();
  await title.press('Tab');
  expect(fixture.writes).toEqual([]);
});

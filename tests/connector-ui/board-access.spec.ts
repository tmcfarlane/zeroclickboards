import { test, expect, BOARD_ID, USER_ID, boardRows, json } from './fixtures';
import type { Page } from '@playwright/test';

type Role = 'owner' | 'editor' | 'viewer' | 'commenter';

async function installBoard(page: Page, initialRole: Role = 'owner', hidden = false, embedEnabled = false) {
  let role = initialRole;
  let deleted = false;
  const today = await page.evaluate(() => {
    const date = new Date();
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  });
  const board = {
    ...structuredClone(boardRows[0]),
    user_id: initialRole === 'owner' ? USER_ID : '30000000-0000-4000-8000-000000000001',
    embed_enabled: embedEnabled,
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
    async downgrade(nextRole: 'viewer' | 'commenter' = 'viewer') {
      role = nextRole;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
    async transferOwnership(nextRole: 'editor' | 'viewer' = 'editor') {
      board.user_id = '30000000-0000-4000-8000-000000000001';
      role = nextRole;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
    async deleteRemotely() {
      deleted = true;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
    async removeColumnRemotely() {
      board.data.columns = board.data.columns.filter((column) => column.id !== 'todo');
      board.updated_at = new Date().toISOString();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    },
  };
}

async function openBoard(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
}

async function openBoardRename(page: Page) {
  await page.getByRole('button', { name: 'Product roadmap', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Actions for Product roadmap board', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  return page.getByRole('dialog', { name: 'Rename Board' });
}

test('board rename draft survives a readonly transition without writing', async ({ page }) => {
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  const dialog = await openBoardRename(page);
  const title = dialog.getByRole('textbox', { name: 'Board Name' });
  await title.fill('Retained board name');
  await fixture.downgrade();
  await expect(dialog.getByRole('alert')).toContainText('editing access');
  await expect(title).toHaveValue('Retained board name');
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await title.press('Enter');
  await expect(dialog).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

async function openAddColumn(page: Page) {
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add Column', exact: true }).click();
  return page.getByRole('dialog', { name: 'Add Column' });
}

async function openColumnRename(page: Page) {
  await page.getByRole('button', { name: 'Actions for To Do column', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  return page.getByRole('dialog', { name: 'Rename Column' });
}

test('column add draft survives a commenter transition without writing', async ({ page }) => {
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  const dialog = await openAddColumn(page);
  const title = dialog.getByRole('textbox', { name: 'Column Title' });
  await title.fill('Retained new column');
  await fixture.downgrade('commenter');
  await expect(dialog.getByRole('alert')).toContainText('editing access');
  await expect(title).toHaveValue('Retained new column');
  await expect(dialog.getByRole('button', { name: 'Add Column', exact: true })).toBeDisabled();
  await title.press('Enter');
  await expect(dialog).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('column rename draft survives readonly and removed-column transitions', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Column actions are a desktop surface; no new mobile editing surface is introduced.');
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  const dialog = await openColumnRename(page);
  const title = dialog.getByRole('textbox', { name: 'Column Name' });
  await title.fill('Retained column name');
  await fixture.downgrade();
  await expect(dialog.getByRole('alert')).toContainText('editing access');
  await expect(title).toHaveValue('Retained column name');
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await title.press('Enter');
  await fixture.removeColumnRemotely();
  await expect(dialog.getByRole('alert')).toContainText('column is no longer available');
  await expect(title).toHaveValue('Retained column name');
  expect(fixture.writes).toEqual([]);
});

test('a removed board keeps its rename draft without creating or writing another board', async ({ page }) => {
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  const dialog = await openBoardRename(page);
  const title = dialog.getByRole('textbox', { name: 'Board Name' });
  await title.fill('Name for a removed board');
  await fixture.deleteRemotely();
  await expect(dialog.getByRole('alert')).toContainText('board is no longer available');
  await expect(title).toHaveValue('Name for a removed board');
  await expect(dialog.getByRole('button', { name: 'Rename', exact: true })).toBeDisabled();
  await title.press('Enter');
  expect(fixture.writes).toEqual([]);
});

test('column add saves successfully and cancelled changes remain unapplied', async ({ page }) => {
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  const dialog = await openAddColumn(page);
  await dialog.getByRole('textbox', { name: 'Column Title' }).fill('In Review');
  await dialog.getByRole('button', { name: 'Add Column', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect.poll(() => fixture.writes).toEqual(['PATCH']);
  await expect(page.getByText('Saving changes…', { exact: true })).not.toBeVisible();
  const rename = await openBoardRename(page);
  await rename.getByRole('textbox', { name: 'Board Name' }).fill('Cancelled name');
  await rename.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
  expect(fixture.writes).toEqual(['PATCH']);
});

test('column rename saves the chosen title', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Column actions are a desktop surface.');
  const fixture = await installBoard(page, 'editor');
  await openBoard(page);
  const dialog = await openColumnRename(page);
  await dialog.getByRole('textbox', { name: 'Column Name' }).fill('Planning');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for Planning column', exact: true })).toBeVisible();
  await expect.poll(() => fixture.writes).toEqual(['PATCH']);
});

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
  let loadFailure = false;
  let loadGate: Promise<void> | null = null;
  let resumeLoads: (() => void) | null = null;
  let invites = [{ id: 'pending-invite', email: 'pat@example.invalid', role: 'viewer', created_at: boardRows[0].created_at }];
  let members = [{ id: 'shared-member', user_id: '40000000-0000-4000-8000-000000000001', board_id: BOARD_ID, role: 'viewer', created_at: boardRows[0].created_at, invited_by: USER_ID, profiles: { email: 'member@example.invalid', full_name: 'Pat Member', avatar_url: null } }];
  const writes: { method: string; boardId: string | null }[] = [];
  const noRows = { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned', hint: null };
  await page.route('**/rest/v1/board_invites*', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (loadGate) await loadGate;
      return loadFailure ? json(route, { message: 'Sharing details unavailable' }, 503) : json(route, invites);
    }
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
      if (loadGate) await loadGate;
      if (loadFailure) return json(route, { message: 'Sharing details unavailable' }, 503);
      return json(route, members);
    }
    writes.push({ method: request.method(), boardId: url.searchParams.get('board_id') });
    if (zeroRows) return url.searchParams.has('select') ? json(route, noRows, 406) : json(route, []);
    members = [];
    return json(route, { id: 'shared-member' });
  });
  return {
    writes,
    addSavedMember: (email: string) => { members.push({ ...members[0], id: 'newly-saved-member', user_id: '40000000-0000-4000-8000-000000000002', profiles: { email, full_name: 'Saved member', avatar_url: null } }); },
    setLoadFailure: (failed: boolean) => { loadFailure = failed; },
    deferLoads: () => { loadGate = new Promise<void>((resolve) => { resumeLoads = resolve; }); },
    releaseLoads: () => { loadGate = null; resumeLoads?.(); },
  };
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

test('owner to viewer keeps the sharing invitation draft above readonly content', async ({ page, isMobile, apiCalls }) => {
  const fixture = await installBoard(page);
  const sharing = await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  const email = share.getByRole('textbox', { name: 'Invite email address' });
  await email.fill('keep@example.invalid');
  await fixture.transferOwnership('viewer');
  await expect(share.getByRole('alert')).toContainText('Only the board owner');
  await expect(email).toHaveValue('keep@example.invalid');
  await expect(share.getByRole('button', { name: 'Send invitation' })).toBeDisabled();
  await expect(share.getByRole('switch', { name: 'Public board' })).toBeDisabled();
  await email.press('Enter');
  await expect(share).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(sharing.writes).toEqual([]);
  expect(apiCalls.filter((call) => call.path === '/api/invite/send')).toEqual([]);
  await share.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByText('Read-only board', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Card', exact: true })).not.toBeVisible();
});

for (const kind of ['link', 'embed'] as const) {
  test(`sharing ${kind} copy confirms the actual copied text`, async ({ page, isMobile }) => {
    await installBoard(page, 'owner', false, true);
    await installSharing(page);
    await openBoard(page);
    const share = await openShare(page, isMobile);
    const value = await share.getByRole('textbox', { name: kind === 'link' ? 'Shareable link' : 'Embed code', exact: true }).inputValue();
    await share.getByRole('button', { name: kind === 'link' ? 'Copy shareable link' : 'Copy embed code', exact: true }).click();
    await expect(share.getByRole('button', { name: kind === 'link' ? 'Link copied' : 'Embed code copied', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  });

  test(`sharing ${kind} clipboard denial keeps honest copy feedback`, async ({ page, isMobile }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Clipboard permission denied', 'NotAllowedError'); } } });
    });
    await installBoard(page, 'owner', false, true);
    await installSharing(page);
    await openBoard(page);
    const share = await openShare(page, isMobile);
    const label = kind === 'link' ? 'Copy shareable link' : 'Copy embed code';
    await share.getByRole('button', { name: label, exact: true }).click();
    await expect(page.getByText('Could not copy. Select the text and copy it manually.', { exact: true })).toBeVisible();
    await expect(share.getByRole('button', { name: label, exact: true })).toBeVisible();
    await expect(share.getByRole('button', { name: kind === 'link' ? 'Link copied' : 'Embed code copied', exact: true })).not.toBeVisible();
  });
}

test('sharing load failure is unknown until Retry recovers confirmed lists', async ({ page, isMobile }) => {
  await installBoard(page);
  const sharing = await installSharing(page);
  sharing.setLoadFailure(true);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await expect(share.getByRole('alert')).toContainText('Could not load sharing details');
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await expect(share.getByText('No members yet', { exact: true })).not.toBeVisible();
  sharing.setLoadFailure(false);
  await share.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(share.getByText('member@example.invalid', { exact: true })).toBeVisible();
  await expect(share.getByText('pat@example.invalid', { exact: true })).toBeVisible();
  await expect(share.getByRole('alert')).not.toBeVisible();
});

test('sharing copy waits for clipboard fulfillment before confirming', async ({ page, isMobile }) => {
  await page.addInitScript(() => {
    const runtime = window as Window & { finishCopy?: () => void; writtenText?: string };
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (text: string) => new Promise<void>((resolve) => { runtime.writtenText = text; runtime.finishCopy = () => resolve(); }) } });
  });
  await installBoard(page);
  await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('button', { name: 'Copy shareable link', exact: true }).click();
  await expect(share.getByRole('button', { name: 'Copy shareable link', exact: true })).toBeVisible();
  await expect(share.getByRole('button', { name: 'Link copied', exact: true })).not.toBeVisible();
  const value = await share.getByRole('textbox', { name: 'Shareable link', exact: true }).inputValue();
  expect(await page.evaluate(() => (window as Window & { writtenText?: string }).writtenText)).toBe(value);
  await page.evaluate(() => (window as Window & { finishCopy?: () => void }).finishCopy?.());
  await expect(share.getByRole('button', { name: 'Link copied', exact: true })).toBeVisible();
});

test('a delayed sharing load blocks list changes and cannot replace readonly state', async ({ page, isMobile }) => {
  const fixture = await installBoard(page);
  const sharing = await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await expect(share.getByText('member@example.invalid', { exact: true })).toBeVisible();
  sharing.deferLoads();
  await share.getByRole('button', { name: 'Refresh sharing details', exact: true }).click();
  await expect(share.getByRole('status')).toHaveText('Loading sharing details…');
  await expect(share.getByRole('button', { name: 'Remove member@example.invalid' })).toBeDisabled();
  await expect(share.getByRole('button', { name: 'Revoke invitation to pat@example.invalid' })).toBeDisabled();
  await expect(share.getByRole('combobox', { name: 'Role for member@example.invalid' })).toBeDisabled();
  await fixture.transferOwnership('viewer');
  await expect(share.getByRole('alert')).toContainText('Only the board owner');
  sharing.releaseLoads();
  await expect(share.getByRole('status')).not.toBeVisible();
  await expect(share.getByRole('button', { name: 'Remove member@example.invalid' })).toBeDisabled();
  expect(sharing.writes).toEqual([]);
  expect(fixture.writes).toEqual([]);
});

test('an unconfirmed invitation response preserves the email and does not claim success', async ({ page, isMobile }) => {
  const calls: unknown[] = [];
  await page.route('**/api/invite/send', async (route) => { calls.push(route.request().postDataJSON()); await json(route, {}); });
  await installBoard(page);
  await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  const email = share.getByRole('textbox', { name: 'Invite email address' });
  await email.fill('keep@example.invalid');
  await share.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText('Failed to confirm the invitation. Your email is kept here.', { exact: true })).toBeVisible();
  await expect(email).toHaveValue('keep@example.invalid');
  await expect(page.getByText('Invitation sent to keep@example.invalid', { exact: true })).not.toBeVisible();
  expect(calls).toEqual([{ email: 'keep@example.invalid', boardId: BOARD_ID, boardName: 'Product roadmap', role: 'viewer' }]);
});

for (const failure of ['saved-access', 'unconfirmed-response', 'lost-response'] as const) {
  test(`an invitation ${failure} refreshes saved access and retains the email`, async ({ page, isMobile }) => {
    await installBoard(page);
    const sharing = await installSharing(page);
    await page.route('**/api/invite/send', async (route) => {
      sharing.addSavedMember('saved@example.invalid');
      if (failure === 'lost-response') return route.abort('connectionfailed');
      await json(route, failure === 'saved-access' ? { error: 'Email service unavailable', accessSaved: true } : {}, failure === 'saved-access' ? 503 : 200);
    });
    await openBoard(page);
    const share = await openShare(page, isMobile);
    await share.getByRole('tab', { name: /Permissions/ }).click();
    await expect(share.getByText('member@example.invalid', { exact: true })).toBeVisible();
    await expect(share.getByText('saved@example.invalid', { exact: true })).not.toBeVisible();
    await share.getByRole('tab', { name: 'Share', exact: true }).click();
    const email = share.getByRole('textbox', { name: 'Invite email address' });
    await email.fill('saved@example.invalid');
    await share.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText(failure === 'saved-access'
      ? 'Access was saved, but invitation delivery could not be confirmed. Review members and invitations before retrying.'
      : failure === 'lost-response' ? 'Failed to send invite' : 'Failed to confirm the invitation. Your email is kept here.', { exact: true })).toBeVisible();
    await expect(email).toHaveValue('saved@example.invalid');
    await expect(page.getByText('Invitation sent to saved@example.invalid', { exact: true })).not.toBeVisible();
    await share.getByRole('tab', { name: /Permissions/ }).click();
    await expect(share.getByText('saved@example.invalid', { exact: true })).toBeVisible();
    expect(sharing.writes).toEqual([]);
  });
}

test('a failed sharing refresh preserves the last confirmed list and can recover', async ({ page, isMobile }) => {
  await installBoard(page);
  const sharing = await installSharing(page);
  await openBoard(page);
  const share = await openShare(page, isMobile);
  await share.getByRole('tab', { name: /Permissions/ }).click();
  await expect(share.getByText('member@example.invalid', { exact: true })).toBeVisible();
  sharing.setLoadFailure(true);
  await share.getByRole('button', { name: 'Refresh sharing details', exact: true }).click();
  await expect(share.getByRole('alert')).toContainText('last loaded details are still shown');
  await expect(share.getByText('member@example.invalid', { exact: true })).toBeVisible();
  await expect(share.getByText('pat@example.invalid', { exact: true })).toBeVisible();
  sharing.setLoadFailure(false);
  await share.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(share.getByRole('alert')).not.toBeVisible();
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

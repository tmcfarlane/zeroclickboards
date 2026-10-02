import { test, expect, boardRows, USER_ID, user, json } from './fixtures';
import type { Page } from '@playwright/test';
import type { Column } from '../../src/types';

const SECOND_USER_ID = '10000000-0000-4000-8000-000000000002';
const completeTemplate = [
  { title: 'First accepted column', sampleCards: [{ title: 'Accepted detailed task', description: 'Preserve this description', content: { type: 'text', text: 'Keep all accepted details' }, labels: ['green', 'blue'] }] },
  { title: 'Remaining accepted column', sampleCards: [{ title: 'Accepted checklist task', content: { type: 'checklist', checklist: [{ text: 'First accepted step' }, { text: 'Second accepted step' }] }, labels: ['yellow'] }] },
];
type SavedBoard = { id: string; user_id: string; name: string; description?: string; data: { columns: Column[] }; created_at: string; updated_at: string };

async function generationFlow(page: Page, holdCreation = false) {
  let account = user;
  const savedBoards: SavedBoard[] = [];
  const writes: Array<{ method: string; boardId: string; userId: string; authenticatedUser: string }> = [];
  const pending: Array<(columns?: unknown[]) => Promise<void>> = [];
  const pendingCreates: Array<() => Promise<void>> = [];
  const rows: SavedBoard[] = structuredClone(boardRows);
  const initialIds = new Set(rows.map(row => row.id));
  // Sign-out visits the actual landing page. Its media and embedded preview
  // remain local fixtures too, rather than triggering third-party traffic.
  await page.route('https://zeroboard-media.trent-a60.workers.dev/**', route => route.fulfill({ status: 204 }));
  await page.route('https://board.zeroclickdev.ai/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Disposable board preview</body></html>' }));
  await page.route('**/auth/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/logout')) return route.fulfill({ status: 204 });
    if (url.pathname.endsWith('/token')) {
      account = { ...user, id: SECOND_USER_ID, email: 'second-account@example.invalid' };
      // Both accounts have the same disposable starter boards. Accepted boards
      // keep their original owner and are never reassigned by the fixture.
      rows.filter(row => initialIds.has(row.id)).forEach(row => { row.user_id = account.id; });
      return json(route, { user: account, access_token: `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: account.id, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.disposable-fixture`, refresh_token: 'disposable-second-token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600 });
    }
    return json(route, account);
  });
  await page.route('**/rest/v1/boards*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (request.method() === 'POST') {
      const saved = { ...request.postDataJSON(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as SavedBoard;
      const token = request.headers().authorization.split(' ')[1];
      writes.push({ method: 'POST', boardId: saved.id, userId: saved.user_id, authenticatedUser: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub });
      savedBoards.push(structuredClone(saved)); rows.push(saved);
      if (holdCreation) {
        let released = false;
        return new Promise<void>(resolve => pendingCreates.push(async () => {
          if (released) return;
          released = true;
          try { await json(route, request.headers().accept?.includes('object+json') ? saved : [saved]); } finally { resolve(); }
        }));
      }
      return json(route, request.headers().accept?.includes('object+json') ? saved : [saved]);
    }
    if (request.method() === 'PATCH') {
      const row = rows.find(candidate => `eq.${candidate.id}` === url.searchParams.get('id'));
      if (row) {
        const token = request.headers().authorization.split(' ')[1];
        writes.push({ method: 'PATCH', boardId: row.id, userId: row.user_id, authenticatedUser: JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub });
        Object.assign(row, request.postDataJSON(), { updated_at: new Date().toISOString() });
      }
      return json(route, request.headers().accept?.includes('object+json') ? row ?? null : row ? [row] : []);
    }
    const result = rows.filter(row => row.user_id === account.id
      && (!url.searchParams.has('id') || `eq.${row.id}` === url.searchParams.get('id'))
      && (!url.searchParams.has('user_id') || `eq.${row.user_id}` === url.searchParams.get('user_id')));
    return json(route, request.headers().accept?.includes('object+json') ? result[0] ?? null : result);
  });
  await page.route('**/api/connector*', route => json(route, { available: false, endpoint: null, connections: [], reason: 'Disposable generation fixture' }));
  await page.route('**/api/ai/usage', route => json(route, { used: 0, limit: 10, remaining: 10 }));
  await page.route('**/api/ai/board-template', async route => {
    const prompt = route.request().postDataJSON().prompt;
    let released = false;
    await new Promise<void>(resolve => pending.push(async (columns = []) => {
      if (released) return;
      released = true;
      try { await json(route, { template: { name: prompt, description: 'Disposable generated content', columns }, usage: { used: 1, limit: 10, charged: true, warning: false } }); } finally { resolve(); }
    }));
  });
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
  return { savedBoards, pending, pendingCreates, rows, writes };
}

function expectCompleteInitialSave(board: SavedBoard) {
  expect(board).toMatchObject({ user_id: USER_ID, description: 'Disposable generated content', data: { columns: [
    { id: expect.any(String), title: 'First accepted column', order: 0, cards: [{ id: expect.any(String), title: 'Accepted detailed task', description: 'Preserve this description', content: { type: 'text', text: 'Keep all accepted details' }, labels: ['green', 'blue'], isArchived: false, createdAt: expect.any(String), updatedAt: expect.any(String) }] },
    { id: expect.any(String), title: 'Remaining accepted column', order: 1, cards: [{ id: expect.any(String), title: 'Accepted checklist task', content: { type: 'checklist', checklist: [{ id: expect.any(String), text: 'First accepted step', completed: false }, { id: expect.any(String), text: 'Second accepted step', completed: false }] }, labels: ['yellow'] }] },
  ] } });
}
async function openGeneration(page: Page, prompt: string) {
  await page.getByRole('button', { name: 'New Board', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Create New Board' });
  await dialog.getByRole('textbox', { name: 'What do you want to build?' }).fill(prompt);
  return dialog;
}
async function signInSecondAccount(page: Page) {
  await page.getByRole('button', { name: 'Account menu' }).click(); await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('/'); await page.getByRole('button', { name: /Get Started/ }).first().click();
  const login = page.getByRole('dialog', { name: 'Welcome to ZeroBoard' });
  await login.getByRole('textbox', { name: 'Email', exact: true }).fill('second-account@example.invalid');
  await login.getByLabel('Password', { exact: true }).fill('disposable-password'); await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
}

test('a cancelled generation preserves a reopened draft and only its new attempt creates a board', async ({ page }) => {
  const { savedBoards, pending } = await generationFlow(page);
  try {
    const old = await openGeneration(page, 'Private cancelled plan');
    await old.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(1);
    await old.getByRole('button', { name: 'Cancel', exact: true }).click();
    const current = await openGeneration(page, 'New current plan');
    await pending[0]();
    await expect(current.getByRole('textbox', { name: 'What do you want to build?' })).toHaveValue('New current plan');
    await current.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(2);
    await pending[1]();
    await expect(page.getByRole('button', { name: 'New current plan', exact: true })).toBeVisible();
    await expect.poll(() => savedBoards.length).toBe(1);
    expect(savedBoards.map(board => ({ name: board.name, user_id: board.user_id }))).toEqual([{ name: 'New current plan', user_id: USER_ID }]);
  } finally { await Promise.allSettled(pending.map(release => release())); }
});

test('the initial save includes all generated content and its acknowledgement survives immediate account navigation', async ({ page, isMobile }) => {
  const { savedBoards, pending, pendingCreates, rows, writes } = await generationFlow(page, true);
  try {
    const dialog = await openGeneration(page, 'Accepted complete plan');
    await dialog.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(1);
    await pending[0](completeTemplate);
    await expect.poll(() => pendingCreates.length).toBe(1);
    expectCompleteInitialSave(savedBoards[0]);
    const snapshot = structuredClone(savedBoards[0]);
    // Leave through the actual profile menu while the save response is held.
    await page.getByRole('button', { name: 'Account menu' }).click(); await page.getByRole('menuitem', { name: 'Account', exact: true }).click();
    await expect(page).toHaveURL('/account'); await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
    await pendingCreates[0]();
    expect(rows.find(row => row.id === snapshot.id)).toEqual(snapshot);
    await page.getByRole('link', { name: 'Back to boards' }).click();
    await expect(page.getByRole('button', { name: 'Accepted complete plan', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Accepted detailed task', exact: true })).toBeVisible();
    const newer = await openGeneration(page, 'A cancelled newer prompt'); await newer.getByRole('button', { name: 'Cancel', exact: true }).click();
    if (isMobile) await page.getByRole('button', { name: /^Remaining accepted column/ }).click();
    await expect(page.getByRole('button', { name: 'Accepted checklist task', exact: true })).toBeVisible();
    expect(savedBoards).toHaveLength(1);
    expect(writes.filter(write => write.boardId === snapshot.id)).toEqual([{ method: 'POST', boardId: snapshot.id, userId: USER_ID, authenticatedUser: USER_ID }]);
    await expect(page.getByText(/Unable to save|Save failed|Retry saving|Your edits are kept/)).not.toBeVisible();
  } finally { await Promise.allSettled([...pending.map(release => release()), ...pendingCreates.map(release => release())]); }
});

test('an accepted full save acknowledged after sign-out cannot become a successor-account board or write', async ({ page }) => {
  const { savedBoards, pending, pendingCreates, rows, writes } = await generationFlow(page, true);
  try {
    const accepted = await openGeneration(page, 'First account accepted private plan');
    await accepted.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(1);
    await pending[0](completeTemplate); await expect.poll(() => pendingCreates.length).toBe(1);
    expectCompleteInitialSave(savedBoards[0]); const snapshot = structuredClone(savedBoards[0]);
    await signInSecondAccount(page);
    await pendingCreates[0]();
    await expect(page.getByRole('button', { name: 'First account accepted private plan', exact: true })).not.toBeVisible();
    const current = await openGeneration(page, 'Second account accepted plan');
    await current.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(2);
    await pending[1](); await expect.poll(() => pendingCreates.length).toBe(2); await pendingCreates[1]();
    await expect(page.getByRole('button', { name: 'Second account accepted plan', exact: true })).toBeVisible();
    expect(rows.find(row => row.id === snapshot.id)).toEqual(snapshot);
    expect(savedBoards.map(board => ({ name: board.name, user_id: board.user_id }))).toEqual([{ name: 'First account accepted private plan', user_id: USER_ID }, { name: 'Second account accepted plan', user_id: SECOND_USER_ID }]);
    expect(writes).toEqual([{ method: 'POST', boardId: snapshot.id, userId: USER_ID, authenticatedUser: USER_ID }, { method: 'POST', boardId: savedBoards[1].id, userId: SECOND_USER_ID, authenticatedUser: SECOND_USER_ID }]);
  } finally { await Promise.allSettled([...pending.map(release => release()), ...pendingCreates.map(release => release())]); }
});

test('previous-account pending generation cannot persist into the next account after real sign-out and sign-in', async ({ page }) => {
  const { savedBoards, pending } = await generationFlow(page);
  try {
    const old = await openGeneration(page, 'First account private pending plan');
    await old.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(1);
    await old.getByRole('button', { name: 'Cancel', exact: true }).click();
    await signInSecondAccount(page);
    const current = await openGeneration(page, 'Second account current plan');
    await current.getByRole('button', { name: 'Generate with AI' }).click(); await expect.poll(() => pending.length).toBe(2);
    await pending[0](completeTemplate); await pending[1]();
    await expect(page.getByRole('button', { name: 'Second account current plan', exact: true })).toBeVisible();
    await expect.poll(() => savedBoards.length).toBe(1);
    expect(savedBoards.map(board => ({ name: board.name, user_id: board.user_id }))).toEqual([{ name: 'Second account current plan', user_id: SECOND_USER_ID }]);
    await expect(page.getByRole('button', { name: 'First account private pending plan', exact: true })).not.toBeVisible();
  } finally { await Promise.allSettled(pending.map(release => release())); }
});

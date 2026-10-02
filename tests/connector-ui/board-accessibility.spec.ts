import { test, expect, boardRows, BOARD_ID, json } from './fixtures';
import type { Page } from '@playwright/test';

const timestamp = '2026-10-01T19:00:00.000Z';

test.beforeEach(async ({ page }) => {
  const board = {
    ...structuredClone(boardRows[0]),
    data: {
      columns: [
        {
          id: 'todo', title: 'To Do', order: 0,
          cards: [{
            id: 'design-card', title: 'Design pricing page', labels: ['green'],
            content: { type: 'text', text: 'Review mobile conversion' },
            createdAt: timestamp, updatedAt: timestamp,
          }],
        },
        { id: 'doing', title: 'In Progress', order: 1, cards: [] },
      ],
    },
  };
  await page.route('**/rest/v1/boards*', async (route) => {
    if (route.request().method() === 'PATCH') {
      Object.assign(board, route.request().postDataJSON(), { updated_at: new Date().toISOString() });
    }
    const id = new URL(route.request().url()).searchParams.get('id');
    const single = route.request().headers().accept?.includes('object+json');
    await json(route, single ? board : id === `eq.${BOARD_ID}` ? [board] : [board, boardRows[1]]);
  });
  await page.route('**/rest/v1/card_activities*', (route) => json(route, []));
});

async function openBoard(page: Page) {
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Product roadmap', exact: true })).toBeVisible();
}

test('N creates and saves a card in the first visible column', async ({ page }) => {
  await openBoard(page);
  await page.keyboard.press('KeyN');
  const editor = page.getByRole('dialog', { name: 'Create Card' });
  await expect(editor).toBeVisible();
  await editor.getByPlaceholder('Card title...').fill('Keyboard-created card');
  const saved = page.waitForResponse((response) => response.url().includes('/rest/v1/boards') && response.request().method() === 'PATCH');
  await editor.getByRole('button', { name: 'Add Card', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Keyboard-created card', exact: true })).toBeVisible();
  await saved;
  await expect(page.getByText(/^(Saving changes…|Changes waiting to save…)$/)).not.toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Keyboard-created card', exact: true })).toBeVisible();
});

test('physical Shift+N opens a board dialog while typing stays in its field', async ({ page }) => {
  await openBoard(page);
  await page.keyboard.press('Shift+KeyN');
  const dialog = page.getByRole('dialog', { name: 'Create New Board' });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Name', { exact: true });
  await name.fill('New board');
  await name.press('KeyN');
  await name.press('Shift+KeyN');
  await expect(name).toHaveValue('New boardnN');
  await expect(page.getByRole('dialog', { name: 'Create Card' })).not.toBeVisible();
});

test('board controls retain names and selected filter states on mobile', async ({ page, isMobile }) => {
  await openBoard(page);
  await expect(page.getByRole('button', { name: 'New Board', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Board', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Timeline', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Actions for Design pricing page', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Board actions', exact: true }).click();
  if (isMobile) {
    await page.getByRole('menuitem', { name: 'Filter', exact: true }).click();
    const green = page.getByRole('button', { name: /^green$/i });
    await expect(green).toHaveAttribute('aria-pressed', 'false');
    await green.click();
    await expect(green).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Close filters' }).click();
    await page.getByRole('button', { name: 'Board actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Search cards' })).toBeFocused();
    await page.getByRole('button', { name: 'Close search' }).click();
  } else {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Actions for To Do column', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Filter cards' }).click();
    const noDate = page.getByRole('button', { name: 'No date', exact: true });
    await noDate.click();
    await expect(noDate).toHaveAttribute('aria-pressed', 'true');
  }
});

test('focused menus keep letter navigation without opening global actions', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('KeyN');
  await page.keyboard.press('Shift+KeyN');
  await page.keyboard.press('KeyA');
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByPlaceholder('What should we do next?')).not.toBeVisible();
});

test('card actions and templates follow the latest edited card', async ({ page }) => {
  await openBoard(page);
  await page.getByRole('button', { name: 'Design pricing page', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit Card' });
  await editor.getByPlaceholder('Card title...').fill('Design accessible pricing');
  await editor.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole('button', { name: 'Actions for Design accessible pricing', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save as Template', exact: true }).click();
  const templates = await page.evaluate(() => JSON.parse(localStorage.getItem('zcb-card-templates') ?? '[]'));
  expect(templates).toMatchObject([{ name: 'Design accessible pricing', card: { title: 'Design accessible pricing' } }]);
});

test('viewer board routes remain read-only when using creation shortcuts', async ({ page }) => {
  const shared = { ...boardRows[0], user_id: 'different-owner', is_public: true };
  await page.route('**/rest/v1/boards*', async (route) => {
    const single = route.request().headers().accept?.includes('object+json');
    await json(route, single ? shared : [shared]);
  });
  await page.route('**/rest/v1/board_members*', async (route) => {
    const single = route.request().headers().accept?.includes('object+json');
    await json(route, single ? { role: 'viewer' } : []);
  });
  await page.route('**/rest/v1/rpc/resolve_pending_invites_for_current_user', (route) => json(route, null));
  await page.goto(`/board/${BOARD_ID}`);
  await expect(page.getByText('Viewer', { exact: true })).toBeVisible();
  await page.keyboard.press('KeyN');
  await page.keyboard.press('Shift+KeyN');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add Card', exact: true })).not.toBeVisible();
  await expect(page).toHaveURL(`/board/${BOARD_ID}`);
});

test.describe('tablet touch controls', () => {
  test.use({ viewport: { width: 834, height: 1194 }, hasTouch: true, isMobile: false });

  test('card and board actions remain visible without hover at tablet widths', async ({ page }) => {
    await openBoard(page);
    expect(await page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
    const cardActions = page.getByRole('button', { name: 'Actions for Design pricing page', exact: true });
    await expect(cardActions).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: 'Product roadmap', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Rename Product roadmap', exact: true }).locator('..')).toHaveCSS('opacity', '1');
    await expect(page.getByRole('button', { name: 'Delete Product roadmap', exact: true })).toBeVisible();
  });
});

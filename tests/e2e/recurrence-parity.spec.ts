import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Board, Card, RecurrenceConfig } from '../../src/types';
import { connectTestMcp } from './helpers/mcp.mjs';

interface TestMcp {
  call<T>(name: string, args: Record<string, unknown>): Promise<T>;
  deleteBoardAndVerify(boardId: string): Promise<void>;
  close(): Promise<void>;
}

const targetDate = '2026-06-03'; // Wednesday, independent of the day this test runs.

test.describe('Recurrence parity between MCP and browser', () => {
  test.setTimeout(60_000);

  async function withTemporaryCard(
    page: Page,
    recurrence: RecurrenceConfig,
    run: (mcp: TestMcp, board: Board, card: Card) => Promise<void>,
  ) {
    const mcp: TestMcp = await connectTestMcp();
    let boardId: string | undefined;
    try {
      const board = await mcp.call<Board>('create_board', { name: `E2E recurrence parity ${randomUUID()}` });
      boardId = board.id;
      const populated = await mcp.call<Board>('add_card', {
        boardId, columnId: board.columns[0].id, title: 'MCP recurring card', targetDate, recurrence,
      });
      await run(mcp, board, populated.columns[0].cards[0]);
    } finally {
      try {
        try {
          await page.close({ runBeforeUnload: false });
        } finally {
          if (boardId) await mcp.deleteBoardAndVerify(boardId);
        }
      } finally {
        await mcp.close();
      }
    }
  }

  async function loadBoard(page: Page, board: Board) {
    await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Changes waiting to save…', { exact: true })).toHaveCount(0);
    await page.goto(`/app?board=${board.id}`);
    await expect(page.getByRole('button', { name: board.name, exact: true })).toBeVisible();
  }

  function cardTitle(page: Page, title: string) {
    return page.getByRole('button', { name: title, exact: true }).and(page.locator('[data-kanban-card] button'));
  }

  async function openCard(page: Page, title: string) {
    await cardTitle(page, title).click();
    const editor = page.getByRole('dialog', { name: 'Edit Card', exact: true });
    await expect(editor).toBeVisible();
    return editor;
  }

  async function saveEditor(editor: Locator) {
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).not.toBeVisible();
  }

  function schedule(card: Card) {
    return card.recurrence && {
      ...card.recurrence,
      ...(card.recurrence.daysOfWeek ? { daysOfWeek: [...card.recurrence.daysOfWeek].sort() } : {}),
    };
  }

  test('round-trips a browser-edited biweekly schedule and creates the correct copies from browser and MCP archives', async ({ page }) => {
    await withTemporaryCard(page, { frequency: 'weekly', interval: 1, daysOfWeek: [3] }, async (mcp, board, card) => {
      await loadBoard(page, board);
      await expect(page.locator('[data-kanban-card]').getByText('Weekly (Wed)', { exact: true })).toBeVisible();
      const editor = await openCard(page, card.title);
      await expect(editor.getByLabel('Due date', { exact: true })).toHaveValue(targetDate);
      await expect(editor.getByRole('spinbutton', { name: 'Repeat every', exact: true })).toHaveValue('1');
      await expect(editor.getByRole('button', { name: 'Wednesday', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(editor.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute('aria-pressed', 'false');

      await editor.getByRole('spinbutton', { name: 'Repeat every', exact: true }).fill('2');
      await editor.getByRole('button', { name: 'Monday', exact: true }).click();
      await saveEditor(editor);
      const editedSchedule = { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] };
      await expect.poll(async () => {
        const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
        return { recurrence: schedule(saved), targetDate: saved.targetDate };
      }).toEqual({ recurrence: editedSchedule, targetDate });

      await loadBoard(page, board);
      await expect(page.locator('[data-kanban-card]').getByText('Every 2 weeks (Mon, Wed)', { exact: true })).toBeVisible();
      const tile = page.locator('[data-kanban-card]').filter({ has: page.getByRole('button', { name: card.title, exact: true }) });
      await expect(tile).toHaveCount(1);
      await tile.hover();
      await tile.locator('button[aria-haspopup="menu"]').click();
      await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();

      await expect.poll(async () => {
        const cards = await mcp.call<Card[]>('list_cards', { boardId: board.id, includeArchived: true });
        return {
          total: cards.length,
          originalArchived: cards.find((candidate) => candidate.id === card.id)?.isArchived,
          active: cards.filter((candidate) => !candidate.isArchived).map((candidate) => ({
            targetDate: candidate.targetDate, recurrence: schedule(candidate),
          })),
        };
      }).toEqual({ total: 2, originalArchived: true, active: [{ targetDate: '2026-06-15', recurrence: editedSchedule }] });

      const [firstCopy] = await mcp.call<Card[]>('list_cards', { boardId: board.id });
      await page.keyboard.press('ControlOrMeta+z');
      await expect.poll(async () => {
        const cards = await mcp.call<Card[]>('list_cards', { boardId: board.id, includeArchived: true });
        return cards.map((candidate) => ({ id: candidate.id, archived: !!candidate.isArchived }));
      }).toEqual([{ id: card.id, archived: false }]);
      await expect(page.locator('[data-kanban-card]')).toHaveCount(1);
      await page.keyboard.press('ControlOrMeta+Shift+z');
      await expect.poll(async () => {
        const cards = await mcp.call<Card[]>('list_cards', { boardId: board.id, includeArchived: true });
        return cards.map((candidate) => ({ id: candidate.id, archived: !!candidate.isArchived }));
      }).toEqual([{ id: card.id, archived: true }, { id: firstCopy.id, archived: false }]);

      const [mondayCopy] = await mcp.call<Card[]>('list_cards', { boardId: board.id });
      expect(mondayCopy.id).not.toBe(card.id);
      const archived = await mcp.call<Board>('archive_card', { boardId: board.id, cardId: mondayCopy.id });
      const allCards = archived.columns.flatMap((column) => column.cards);
      expect(allCards).toHaveLength(3);
      expect(allCards.filter((candidate) => candidate.isArchived)).toHaveLength(2);
      const [wednesdayCopy] = allCards.filter((candidate) => !candidate.isArchived);
      expect(wednesdayCopy.id).not.toBe(mondayCopy.id);
      expect(wednesdayCopy.targetDate).toBe('2026-06-17');
      expect(schedule(wednesdayCopy)).toEqual(editedSchedule);

      await loadBoard(page, board);
      await expect(page.locator('[data-kanban-card]')).toHaveCount(1);
      const reopened = await openCard(page, card.title);
      await expect(reopened.getByLabel('Due date', { exact: true })).toHaveValue('2026-06-17');
      await expect(reopened.getByRole('spinbutton', { name: 'Repeat every', exact: true })).toHaveValue('2');
      await expect(reopened.getByRole('button', { name: 'Monday', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(reopened.getByRole('button', { name: 'Wednesday', exact: true })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  for (const scope of ['single', 'bulk'] as const) {
    test(`overlapping ${scope} browser and MCP archives persist exactly one next occurrence`, async ({ page }) => {
      await withTemporaryCard(page, { frequency: 'daily', interval: 1 }, async (mcp, board, card) => {
        await mcp.call<Board>('add_card', { boardId: board.id, columnId: board.columns[0].id, title: 'Ordinary task' });
        await loadBoard(page, board);
        await expect(cardTitle(page, card.title)).toBeVisible();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        let patchHeld = false;
        const matchesBoard = (url: URL) => url.pathname === '/rest/v1/boards' && url.searchParams.get('id') === `eq.${board.id}`;
        await page.route(matchesBoard, async (route) => {
          if (route.request().method() === 'PATCH' && !patchHeld) {
            patchHeld = true;
            await gate;
          }
          await route.continue();
        });
        try {
          if (scope === 'single') {
            const tile = page.locator('[data-kanban-card]').filter({ has: page.getByRole('button', { name: card.title, exact: true }) });
            await tile.hover();
            await tile.locator('button[aria-haspopup="menu"]').click();
            await page.getByRole('menuitem', { name: 'Archive', exact: true }).click();
          } else {
            await page.locator('[data-kanban-column]').first().locator('button[aria-haspopup="menu"]').first().click();
            await page.getByRole('menuitem', { name: 'Archive all cards', exact: true }).click();
          }
          await expect.poll(() => patchHeld, { timeout: 10_000 }).toBe(true);
          const archived = await mcp.call<Board>('archive_card', { boardId: board.id, cardId: card.id });
          const copy = archived.columns.flatMap((column) => column.cards).find((candidate) => candidate.id !== card.id && candidate.recurrence)!;
          expect(copy).toBeDefined();
          release();
          await page.getByRole('button', { name: 'Review changes', exact: true }).click();
          await page.getByRole('button', { name: scope === 'single' ? 'Keep my edits' : 'Use incoming edits', exact: true }).click();
          await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0);
          await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
          await expect(page.getByText('Changes waiting to save…', { exact: true })).toHaveCount(0);
          await expect.poll(async () => {
            const cards = await mcp.call<Card[]>('list_cards', { boardId: board.id, includeArchived: true });
            return {
              total: cards.length,
              sources: cards.filter((candidate) => candidate.id === card.id).map((candidate) => !!candidate.isArchived),
              copies: cards.filter((candidate) => candidate.id !== card.id && candidate.recurrence).map((candidate) => ({ id: candidate.id, date: candidate.targetDate })),
              ordinaryArchived: !!cards.find((candidate) => candidate.title === 'Ordinary task')?.isArchived,
            };
          }).toEqual({ total: 3, sources: [true], copies: [{ id: copy.id, date: '2026-06-04' }], ordinaryArchived: scope === 'bulk' });
          await loadBoard(page, board);
          await expect(page.locator('[data-kanban-card]')).toHaveCount(scope === 'bulk' ? 1 : 2);
        } finally {
          release();
          await page.unroute(matchesBoard);
        }
      });
    });
  }

  test('preserves an incoming MCP recurrence clear while a title draft is open and archives without making a copy', async ({ page }) => {
    await withTemporaryCard(page, { frequency: 'daily', interval: 2 }, async (mcp, board, card) => {
      await loadBoard(page, board);
      const recurrenceBadge = page.locator('[data-kanban-card]').getByText('Every 2 days', { exact: true });
      await expect(recurrenceBadge).toBeVisible();
      const editor = await openCard(page, card.title);
      await expect(editor.getByRole('spinbutton', { name: 'Repeat every', exact: true })).toHaveValue('2');
      await editor.getByPlaceholder('Card title...').fill('Title draft survives recurrence removal');

      await mcp.call<Board>('set_recurrence', { boardId: board.id, cardId: card.id, recurrence: null });
      // Wait for the remote clear to reach the board behind the still-open editor.
      await expect(recurrenceBadge).toHaveCount(0, { timeout: 15_000 });
      await expect(editor.getByPlaceholder('Card title...')).toHaveValue('Title draft survives recurrence removal');
      await saveEditor(editor);
      await expect.poll(async () => {
        const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
        return { title: saved.title, recurrence: saved.recurrence, targetDate: saved.targetDate };
      }).toEqual({ title: 'Title draft survives recurrence removal', recurrence: undefined, targetDate });

      await loadBoard(page, board);
      await expect(cardTitle(page, 'Title draft survives recurrence removal')).toBeVisible();
      await expect(recurrenceBadge).toHaveCount(0);
      const reopened = await openCard(page, 'Title draft survives recurrence removal');
      await expect(reopened.getByLabel('Due date', { exact: true })).toHaveValue(targetDate);
      await expect(reopened.getByRole('spinbutton', { name: 'Repeat every', exact: true })).toHaveCount(0);
      await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();

      await mcp.call<Board>('archive_card', { boardId: board.id, cardId: card.id });
      const archived = await mcp.call<Card[]>('list_cards', { boardId: board.id, includeArchived: true });
      expect(archived).toHaveLength(1);
      expect(archived[0]).toMatchObject({ id: card.id, isArchived: true, targetDate });
      expect(archived[0].recurrence).toBeUndefined();
      expect(await mcp.call<Card[]>('list_cards', { boardId: board.id })).toEqual([]);
      await loadBoard(page, board);
      await expect(page.locator('[data-kanban-card]')).toHaveCount(0);
    });
  });
});

import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import type { Board, Card } from '../../src/types';
import { connectTestMcp } from './helpers/mcp.mjs';

interface TestMcp {
  call<T>(name: string, args: Record<string, unknown>): Promise<T>;
  deleteBoardAndVerify(boardId: string): Promise<void>;
  close(): Promise<void>;
}

test.describe('Browser and MCP board synchronization', () => {
  test.setTimeout(60_000);

  function cardTitle(page: Page, title: string) {
    // Sortable card containers also have role=button; choose the edit button.
    return page.getByRole('button', { name: title, exact: true }).and(page.locator('[data-kanban-card] button'));
  }

  async function withTemporaryBoard(page: Page, run: (mcp: TestMcp, board: Board, card: Card) => Promise<void>) {
    const mcp: TestMcp = await connectTestMcp();
    let boardId: string | undefined;
    try {
      const board = await mcp.call<Board>('create_board', { name: `E2E browser MCP sync ${randomUUID()}` });
      boardId = board.id;
      const withCard = await mcp.call<Board>('add_card', {
        boardId,
        columnId: board.columns[0].id,
        title: 'Original task title',
        text: 'Original body from MCP',
      });
      await page.goto(`/app?board=${boardId}`);
      await expect(page.getByRole('button', { name: board.name, exact: true })).toBeVisible();
      await expect(cardTitle(page, 'Original task title')).toBeVisible();
      await run(mcp, board, withCard.columns[0].cards[0]);
    } finally {
      // Stop browser writers before deleting, even if a test failed mid-save.
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

  async function holdNextBoardPatch(page: Page, boardId: string) {
    let release!: () => void;
    let received: Request | undefined;
    const released = new Promise<void>((resolve) => { release = resolve; });
    let held = false;
    const matchesBoard = (url: URL) => url.pathname === '/rest/v1/boards' && url.searchParams.get('id') === `eq.${boardId}`;
    const handler = async (route: Route) => {
      const request = route.request();
      if (request.method() === 'PATCH' && !held) {
        held = true;
        received = request;
        await released;
      }
      await route.continue();
    };
    await page.route(matchesBoard, handler);
    return {
      async waitForPatch() {
        await expect.poll(() => received !== undefined, {
          timeout: 10_000, message: 'The browser must issue a board PATCH before the MCP race begins',
        }).toBe(true);
        return received!;
      },
      release,
      async dispose() {
        release();
        await page.unroute(matchesBoard, handler);
      },
    };
  }

  async function editCard(page: Page, oldTitle: string, title: string, description?: string) {
    await cardTitle(page, oldTitle).click();
    const editor = page.getByRole('dialog', { name: 'Edit Card', exact: true });
    await editor.getByPlaceholder('Card title...').fill(title);
    if (description) await editor.getByPlaceholder('Add a more detailed description...').fill(description);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).not.toBeVisible();
  }

  async function reloadBoard(page: Page, board: Board) {
    await expect(page.getByText('Saving changes…', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Changes waiting to save…', { exact: true })).toHaveCount(0);
    // A document navigation reloads the application and also restores the
    // requested board after the app has consumed its original deep link.
    await page.goto(`/app?board=${board.id}`);
    await expect(page.getByRole('button', { name: board.name, exact: true })).toBeVisible();
  }

  test('merges a held browser title save with an unrelated MCP card and persists both', async ({ page }) => {
    await withTemporaryBoard(page, async (mcp, board, card) => {
      const gate = await holdNextBoardPatch(page, board.id);
      try {
        await editCard(page, card.title, 'Title edited in the browser');
        const held = await gate.waitForPatch();
        const heldRevision = new URL(held.url()).searchParams.get('updated_at');
        expect(heldRevision).toMatch(/^eq\./);

        const incoming = await mcp.call<Board>('add_card', {
          boardId: board.id, columnId: board.columns[0].id, title: 'Unrelated task added through MCP',
        });
        expect(`eq.${incoming.updatedAt}`).not.toBe(heldRevision);
        gate.release();

        await expect.poll(async () => {
          const saved = await mcp.call<Board>('get_board', { boardId: board.id });
          return saved.columns.flatMap((column) => column.cards.map((item) => item.title)).sort();
        }).toEqual(['Title edited in the browser', 'Unrelated task added through MCP']);
        await expect(cardTitle(page, 'Unrelated task added through MCP')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0);

        await reloadBoard(page, board);
        await expect(cardTitle(page, 'Title edited in the browser')).toBeVisible();
        await expect(cardTitle(page, 'Unrelated task added through MCP')).toBeVisible();
        expect((await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id })).content.text).toBe('Original body from MCP');
      } finally {
        await gate.dispose();
      }
    });
  });

  for (const choice of [
    { button: 'Keep my edits', expectedTitle: 'Browser conflicting title' },
    { button: 'Use incoming edits', expectedTitle: 'MCP conflicting title' },
  ]) {
    test(`reviews a same-field conflict with "${choice.button}" and preserves unrelated edits`, async ({ page }) => {
      await withTemporaryBoard(page, async (mcp, board, card) => {
        const gate = await holdNextBoardPatch(page, board.id);
        try {
          await editCard(page, card.title, 'Browser conflicting title', 'Description added in the browser');
          const held = await gate.waitForPatch();
          expect(new URL(held.url()).searchParams.get('updated_at')).toMatch(/^eq\./);
          await mcp.call<Board>('update_card', { boardId: board.id, cardId: card.id, title: 'MCP conflicting title' });
          await mcp.call<Board>('add_card', {
            boardId: board.id, columnId: board.columns[0].id, title: 'MCP task kept through conflict review',
          });
          gate.release();

          await page.getByRole('button', { name: 'Review changes', exact: true }).click();
          const review = page.getByRole('dialog', { name: 'Review board changes', exact: true });
          await expect(review.getByText('Browser conflicting title', { exact: true })).toBeVisible();
          await expect(review.getByText('MCP conflicting title', { exact: true })).toBeVisible();
          await review.getByRole('button', { name: choice.button, exact: true }).click();
          await expect.poll(async () => {
            const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
            return { title: saved.title, description: saved.description };
          }).toEqual({ title: choice.expectedTitle, description: 'Description added in the browser' });
          await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0);

          await reloadBoard(page, board);
          await expect(cardTitle(page, choice.expectedTitle)).toBeVisible();
          await expect(cardTitle(page, 'MCP task kept through conflict review')).toBeVisible();
          await expect(page.getByText('Description added in the browser', { exact: true })).toBeVisible();
          expect((await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id })).content.text).toBe('Description added in the browser');
        } finally {
          await gate.dispose();
        }
      });
    });
  }

  test('keeps an open editor draft through an MCP move and preserves newer body and labels on save', async ({ page }) => {
    await withTemporaryBoard(page, async (mcp, board, card) => {
      await cardTitle(page, card.title).click();
      const editor = page.getByRole('dialog', { name: 'Edit Card', exact: true });
      await editor.getByPlaceholder('Card title...').fill('Title typed before the MCP move');

      const targetColumnId = board.columns[1].id;
      await mcp.call<Board>('move_card', { boardId: board.id, cardId: card.id, targetColumnId });
      await mcp.call<Board>('add_label', { boardId: board.id, cardId: card.id, label: 'green' });
      await mcp.call<Board>('update_card', {
        boardId: board.id, cardId: card.id, text: 'MCP body changed while the editor is open',
      });

      // Observe the incoming body on the real board behind the modal. This
      // proves realtime reached the browser before submitting the stale form.
      await expect(page.locator('[data-kanban-card]').getByText('MCP body changed while the editor is open', { exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(editor).toBeVisible();
      await expect(editor.getByPlaceholder('Card title...')).toHaveValue('Title typed before the MCP move');
      await editor.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(editor).not.toBeVisible();

      await expect.poll(async () => {
        const saved = await mcp.call<Card & { columnId: string }>('get_card', { boardId: board.id, cardId: card.id });
        return { title: saved.title, body: saved.content.text, labels: saved.labels, columnId: saved.columnId };
      }).toEqual({
        title: 'Title typed before the MCP move',
        body: 'MCP body changed while the editor is open',
        labels: ['green'],
        columnId: targetColumnId,
      });

      await reloadBoard(page, board);
      await expect(cardTitle(page, 'Title typed before the MCP move')).toBeVisible();
      await expect(page.getByText('MCP body changed while the editor is open', { exact: true })).toBeVisible();
      const saved = await mcp.call<Card & { columnId: string }>('get_card', { boardId: board.id, cardId: card.id });
      expect(saved.columnId).toBe(targetColumnId);
      expect(saved.labels).toEqual(['green']);
      await expect(page.getByRole('button', { name: 'Review changes', exact: true })).toHaveCount(0);
    });
  });
});

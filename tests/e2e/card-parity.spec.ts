import { randomUUID } from 'node:crypto';
import { expect, test, type Locator, type Page } from '@playwright/test';
import type { Attachment, Board, Card } from '../../src/types';
import { BASE_URL } from './env';
import { connectTestMcp } from './helpers/mcp.mjs';

interface TestMcp {
  call<T>(name: string, args: Record<string, unknown>): Promise<T>;
  seedCardAttachments(boardId: string, cardId: string, attachments: Attachment[], coverImage: string | null): Promise<void>;
  deleteBoardAndVerify(boardId: string): Promise<void>;
  close(): Promise<void>;
}

const description = 'A concise description supplied through MCP';
const body = 'Independent body text supplied through MCP';

test.describe('Card field parity between MCP and browser', () => {
  test.setTimeout(60_000);

  async function withTemporaryCard(page: Page, run: (mcp: TestMcp, board: Board, card: Card) => Promise<void>) {
    const mcp: TestMcp = await connectTestMcp();
    let boardId: string | undefined;
    try {
      const board = await mcp.call<Board>('create_board', { name: `E2E card parity ${randomUUID()}` });
      boardId = board.id;
      const populated = await mcp.call<Board>('add_card', {
        boardId, columnId: board.columns[0].id, title: 'MCP card with separate fields', description, text: body,
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

  async function openCard(page: Page, title: string) {
    await page.getByRole('button', { name: title, exact: true }).and(page.locator('[data-kanban-card] button')).click();
    const editor = page.getByRole('dialog', { name: 'Edit Card', exact: true });
    await expect(editor).toBeVisible();
    return editor;
  }

  async function saveEditor(editor: Locator) {
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).not.toBeVisible();
  }

  function attachments(): Attachment[] {
    return [
      {
        id: randomUUID(), name: 'First illustration', addedAt: new Date().toISOString(), isCover: true,
        url: new URL('/logo/logo_color.svg?fixture=first', BASE_URL).href,
      },
      {
        id: randomUUID(), name: 'Second illustration', addedAt: new Date().toISOString(), isCover: false,
        url: new URL('/logo/logo_color.svg?fixture=second', BASE_URL).href,
      },
    ];
  }

  test('opens distinct MCP description and body fields and preserves description while editing title and body', async ({ page }) => {
    await withTemporaryCard(page, async (mcp, board, card) => {
      await loadBoard(page, board);
      const editor = await openCard(page, card.title);
      await expect(editor.getByLabel('Description', { exact: true })).toHaveValue(description);
      await expect(editor.getByLabel('Body text', { exact: true })).toHaveValue(body);

      await editor.getByPlaceholder('Card title...').fill('Browser title with independent text');
      await editor.getByLabel('Body text', { exact: true }).fill('Body text edited only in the browser');
      await saveEditor(editor);
      await expect.poll(async () => {
        const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
        return { title: saved.title, description: saved.description, body: saved.content.text };
      }).toEqual({ title: 'Browser title with independent text', description, body: 'Body text edited only in the browser' });

      await loadBoard(page, board);
      const reopened = await openCard(page, 'Browser title with independent text');
      await expect(reopened.getByLabel('Description', { exact: true })).toHaveValue(description);
      await expect(reopened.getByLabel('Body text', { exact: true })).toHaveValue('Body text edited only in the browser');
      await reopened.getByRole('button', { name: 'Cancel', exact: true }).click();

      await page.getByRole('button', { name: 'Add Card', exact: true }).first().click();
      const createEditor = page.getByRole('dialog', { name: 'Create Card', exact: true });
      await createEditor.getByPlaceholder('Card title...').fill('Browser-created distinct fields');
      await createEditor.getByLabel('Description', { exact: true }).fill('Description created in the browser');
      await createEditor.getByLabel('Body text', { exact: true }).fill('Body text created in the browser');
      await createEditor.getByRole('button', { name: 'Add Card', exact: true }).click();
      await expect(createEditor).not.toBeVisible();
      await expect.poll(async () => {
        const cards = await mcp.call<Card[]>('list_cards', { boardId: board.id });
        const created = cards.find((candidate) => candidate.title === 'Browser-created distinct fields');
        return created ? { description: created.description, body: created.content.text } : null;
      }).toEqual({ description: 'Description created in the browser', body: 'Body text created in the browser' });

      await loadBoard(page, board);
      const createdEditor = await openCard(page, 'Browser-created distinct fields');
      await expect(createdEditor.getByLabel('Description', { exact: true })).toHaveValue('Description created in the browser');
      await expect(createdEditor.getByLabel('Body text', { exact: true })).toHaveValue('Body text created in the browser');
    });
  });

  test('selects the correct existing attachment when MCP changes a cover and keeps it after browser save', async ({ page }) => {
    await withTemporaryCard(page, async (mcp, board, card) => {
      const images = attachments();
      await expect(mcp.seedCardAttachments('untracked-board', card.id, images, images[0].url))
        .rejects.toThrow('Attachment fixtures require a board created by this MCP session');
      await mcp.seedCardAttachments(board.id, card.id, images, images[0].url);
      await mcp.call<Board>('set_cover_image', { boardId: board.id, cardId: card.id, coverImage: images[1].url });

      const changed = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
      expect(changed.coverImage).toBe(images[1].url);
      expect(changed.attachments?.filter((attachment) => attachment.isCover).map((attachment) => attachment.id)).toEqual([images[1].id]);

      await loadBoard(page, board);
      await expect(page.getByRole('img', { name: 'Card cover', exact: true })).toHaveAttribute('src', images[1].url);
      const editor = await openCard(page, card.title);
      await expect(editor.getByRole('img', { name: 'Card cover', exact: true })).toHaveAttribute('src', images[1].url);
      await editor.getByPlaceholder('Card title...').fill('Browser title keeps MCP attachment cover');
      await saveEditor(editor);

      await expect.poll(async () => {
        const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
        return { title: saved.title, cover: saved.coverImage, flags: saved.attachments?.filter((attachment) => attachment.isCover).map((attachment) => attachment.id) };
      }).toEqual({ title: 'Browser title keeps MCP attachment cover', cover: images[1].url, flags: [images[1].id] });
      await loadBoard(page, board);
      const reopened = await openCard(page, 'Browser title keeps MCP attachment cover');
      await expect(reopened.getByRole('img', { name: 'Card cover', exact: true })).toHaveAttribute('src', images[1].url);
    });
  });

  test('keeps an MCP-cleared cover absent while the browser renames and removes attachments', async ({ page }) => {
    await withTemporaryCard(page, async (mcp, board, card) => {
      const images = attachments();
      await mcp.seedCardAttachments(board.id, card.id, images, images[0].url);
      await mcp.call<Board>('set_cover_image', { boardId: board.id, cardId: card.id, coverImage: null });
      const cleared = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
      expect(cleared.coverImage).toBeUndefined();
      expect(cleared.attachments?.filter((attachment) => attachment.isCover)).toEqual([]);

      await loadBoard(page, board);
      await expect(page.getByRole('img', { name: 'Card cover', exact: true })).toHaveCount(0);
      const editor = await openCard(page, card.title);
      await expect(editor.getByRole('img', { name: 'Card cover', exact: true })).toHaveCount(0);
      await editor.getByRole('button', { name: 'Actions for First illustration', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
      const attachmentName = editor.getByRole('textbox', { name: 'Attachment name', exact: true });
      await attachmentName.fill('Renamed illustration');
      await attachmentName.press('Enter');
      await expect(editor.getByText('Renamed illustration', { exact: true })).toBeVisible();
      await saveEditor(editor);

      await expect.poll(async () => {
        const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
        return { cover: saved.coverImage, flagged: saved.attachments?.filter((attachment) => attachment.isCover).length, names: saved.attachments?.map((attachment) => attachment.name) };
      }).toEqual({ cover: undefined, flagged: 0, names: ['Renamed illustration', 'Second illustration'] });

      await loadBoard(page, board);
      const reopened = await openCard(page, card.title);
      await expect(reopened.getByRole('img', { name: 'Card cover', exact: true })).toHaveCount(0);
      await reopened.getByRole('button', { name: 'Actions for Renamed illustration', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
      await expect(reopened.getByText('Renamed illustration', { exact: true })).toHaveCount(0);
      await expect(reopened.getByRole('img', { name: 'Card cover', exact: true })).toHaveCount(0);
      await saveEditor(reopened);

      await expect.poll(async () => {
        const saved = await mcp.call<Card>('get_card', { boardId: board.id, cardId: card.id });
        return { cover: saved.coverImage, flagged: saved.attachments?.filter((attachment) => attachment.isCover).length, ids: saved.attachments?.map((attachment) => attachment.id) };
      }).toEqual({ cover: undefined, flagged: 0, ids: [images[1].id] });
      await loadBoard(page, board);
      await expect(page.getByRole('img', { name: 'Card cover', exact: true })).toHaveCount(0);
      const finalEditor = await openCard(page, card.title);
      await expect(finalEditor.getByText('Second illustration', { exact: true })).toBeVisible();
      await expect(finalEditor.getByRole('img', { name: 'Card cover', exact: true })).toHaveCount(0);
    });
  });
});

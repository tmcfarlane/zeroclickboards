import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Board, Card } from '../../src/types';
import { connectTestMcp } from './helpers/mcp.mjs';

test.use({ timezoneId: 'America/Los_Angeles' });

test('keeps MCP due dates on their written calendar day in the editor and local date filters', async ({ page }) => {
  test.setTimeout(60_000);
  const now = new Date();
  await page.clock.setFixedTime(now);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)!.value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const yesterdayInstant = new Date(`${today}T12:00:00Z`);
  yesterdayInstant.setUTCDate(yesterdayInstant.getUTCDate() - 1);
  const yesterday = yesterdayInstant.toISOString().slice(0, 10);
  const mcp = await connectTestMcp();
  let boardId: string | undefined;
  try {
    const board: Board = await mcp.call('create_board', { name: `E2E date parity ${randomUUID()}` });
    boardId = board.id;
    const populated: Board = await mcp.call('add_card', {
      boardId, columnId: board.columns[0].id, title: 'Due today from MCP',
      targetDate: `${today}T23:30:00+14:00`, text: 'Keep the calendar day and body',
    });
    const card = populated.columns[0].cards[0];
    expect(card.targetDate).toBe(today);
    const beforeInvalidDate = await mcp.call('get_card', { boardId, cardId: card.id });
    await expect(mcp.call('set_target_date', {
      boardId, cardId: card.id, targetDate: '2026-02-31',
    })).rejects.toThrow();
    expect(await mcp.call('get_card', { boardId, cardId: card.id })).toEqual(beforeInvalidDate);
    await mcp.call('add_card', {
      boardId, columnId: board.columns[0].id, title: 'Due yesterday', targetDate: yesterday,
    });

    await page.goto(`/app?board=${boardId}`);
    await expect(page.getByRole('button', { name: board.name, exact: true })).toBeVisible();
    const title = (name: string) => page.locator('[data-kanban-card]').getByRole('button', { name, exact: true });
    await title(card.title).click();
    const editor = page.getByRole('dialog', { name: 'Edit Card', exact: true });
    await expect(editor.getByLabel('Due date', { exact: true })).toHaveValue(today);
    await editor.getByPlaceholder('Card title...').fill('Due today after browser edit');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect.poll(async () => {
      const saved: Card = await mcp.call('get_card', { boardId, cardId: card.id });
      return { title: saved.title, targetDate: saved.targetDate, body: saved.content.text };
    }).toEqual({ title: 'Due today after browser edit', targetDate: today, body: card.content.text });
    // AppShell consumes the board deep link, so reapply it when loading afresh.
    await page.goto(`/app?board=${boardId}`);
    await expect(page.getByRole('button', { name: board.name, exact: true })).toBeVisible();
    await expect(title('Due today after browser edit')).toBeVisible();

    const filter = page.getByRole('button', { name: 'Filter cards', exact: true });
    await filter.click();
    await page.getByRole('button', { name: 'Overdue', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(title('Due today after browser edit')).toHaveCount(0);
    await expect(title('Due yesterday')).toBeVisible();

    for (const label of ['Due this week', 'Due this month']) {
      await filter.click();
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.keyboard.press('Escape');
      await expect(title('Due today after browser edit')).toBeVisible();
    }
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
});

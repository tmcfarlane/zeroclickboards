import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { READ_ONLY } from './config.js';
import { getAuthedClient, NotAuthenticatedError } from './supabase.js';
import * as db from './board-data.js';
import { generateBoardTemplate } from './ai.js';
import { CARD_LABELS, type CardContent, type CardLabel } from './types.js';
import { recurrenceSchema } from './recurrence-schema.js';
import { targetDateSchema } from './target-date-schema.js';

const text = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
});
const fail = (e: unknown): CallToolResult => ({
  content: [{ type: 'text', text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
  isError: true,
});
const safe = async (fn: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    return text(await fn());
  } catch (e) {
    return fail(e);
  }
};

const labelEnum = z.enum(CARD_LABELS as [string, ...string[]]);
const textToContent = (t?: string): CardContent | undefined =>
  t === undefined ? undefined : { type: 'text', text: t };

/** Build the complete protocol surface; injecting clients also permits offline MCP tests. */
export function buildServer(
  client: SupabaseClient,
  user: User,
  { readOnly = READ_ONLY }: { readOnly?: boolean } = {},
): McpServer {
  const server = new McpServer({ name: 'zeroboard-mcp', version: '0.1.0' });
  registerResources(server, client, user);
  const RO = { readOnlyHint: true } as const;
  const DESTRUCTIVE = { destructiveHint: true } as const;

  // ----- Read tools -----------------------------------------------------
  server.registerTool(
    'list_boards',
    { title: 'List boards', description: 'List all of your ZeroBoard boards (id, name, column/card counts).', inputSchema: {}, annotations: RO },
    async () => safe(() => db.listBoards(client)),
  );

  server.registerTool(
    'get_board',
    { title: 'Get board', description: 'Get a full board including its columns and cards.', inputSchema: { boardId: z.string().describe('Board id') }, annotations: RO },
    async ({ boardId }) => safe(() => db.getBoard(client, boardId)),
  );

  server.registerTool(
    'list_columns',
    { title: 'List columns', description: 'List the columns of a board.', inputSchema: { boardId: z.string() }, annotations: RO },
    async ({ boardId }) =>
      safe(async () => {
        const b = await db.getBoard(client, boardId);
        return b.columns.map((c) => ({ id: c.id, title: c.title, order: c.order, cardCount: c.cards.length }));
      }),
  );

  server.registerTool(
    'list_cards',
    {
      title: 'List cards',
      description: 'List cards on a board, optionally filtered to a column. Archived cards excluded unless includeArchived.',
      inputSchema: {
        boardId: z.string(),
        columnId: z.string().optional(),
        includeArchived: z.boolean().optional(),
      },
      annotations: RO,
    },
    async ({ boardId, columnId, includeArchived }) =>
      safe(async () => {
        const b = await db.getBoard(client, boardId);
        return b.columns
          .filter((c) => !columnId || c.id === columnId)
          .flatMap((c) =>
            c.cards
              .filter((card) => includeArchived || !card.isArchived)
              .map((card) => ({ columnId: c.id, columnName: c.title, ...card })),
          );
      }),
  );

  server.registerTool(
    'get_card',
    { title: 'Get card', description: 'Get a single card by id.', inputSchema: { boardId: z.string(), cardId: z.string() }, annotations: RO },
    async ({ boardId, cardId }) =>
      safe(async () => {
        const b = await db.getBoard(client, boardId);
        for (const c of b.columns) {
          const card = c.cards.find((x) => x.id === cardId);
          if (card) return { columnId: c.id, columnName: c.title, ...card };
        }
        throw new Error(`Card ${cardId} not found`);
      }),
  );

  server.registerTool(
    'search',
    {
      title: 'Search cards',
      description: 'Search across all your boards for cards whose title/description/content match the query.',
      inputSchema: { query: z.string(), includeArchived: z.boolean().optional() },
      annotations: RO,
    },
    async ({ query, includeArchived }) => safe(() => db.search(client, query, includeArchived ?? false)),
  );

  if (readOnly) return server;

  // ----- Write tools ----------------------------------------------------
  server.registerTool(
    'create_board',
    { title: 'Create board', description: 'Create a new board with the default columns.', inputSchema: { name: z.string(), description: z.string().optional() } },
    async ({ name, description }) => safe(() => db.createBoard(client, user.id, name, description)),
  );

  server.registerTool(
    'generate_board',
    {
      title: 'Generate board (AI)',
      description:
        'Create a new board from a natural-language description using ZeroBoard AI (e.g. "a sprint board for a mobile app launch"). Subject to the daily AI limit on the free plan.',
      inputSchema: { prompt: z.string().describe('What the board is for') },
    },
    async ({ prompt }) =>
      safe(async () => {
        const { data } = await client.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error('No active session — run `zeroboard-mcp login`.');
        const template = await generateBoardTemplate(prompt, token);
        return db.createBoardFromTemplate(client, user.id, template);
      }),
  );

  server.registerTool(
    'update_board',
    { title: 'Update board', description: 'Rename a board or change its description.', inputSchema: { boardId: z.string(), name: z.string().optional(), description: z.string().optional() } },
    async ({ boardId, name, description }) => safe(() => db.updateBoardMeta(client, boardId, { name, description })),
  );

  server.registerTool(
    'delete_board',
    { title: 'Delete board', description: 'Permanently delete a board and all its cards.', inputSchema: { boardId: z.string() }, annotations: DESTRUCTIVE },
    async ({ boardId }) => safe(() => db.deleteBoard(client, boardId)),
  );

  server.registerTool(
    'add_column',
    { title: 'Add column', description: 'Add a column to a board.', inputSchema: { boardId: z.string(), title: z.string() } },
    async ({ boardId, title }) => safe(() => db.addColumn(client, boardId, title)),
  );

  server.registerTool(
    'update_column',
    { title: 'Rename column', description: 'Rename a column.', inputSchema: { boardId: z.string(), columnId: z.string(), title: z.string() } },
    async ({ boardId, columnId, title }) => safe(() => db.updateColumn(client, boardId, columnId, title)),
  );

  server.registerTool(
    'remove_column',
    { title: 'Remove column', description: 'Remove a column and its cards.', inputSchema: { boardId: z.string(), columnId: z.string() }, annotations: DESTRUCTIVE },
    async ({ boardId, columnId }) => safe(() => db.removeColumn(client, boardId, columnId)),
  );

  server.registerTool(
    'reorder_columns',
    { title: 'Reorder columns', description: 'Reorder columns. Provide every existing column id exactly once, in the desired order.', inputSchema: { boardId: z.string(), orderedColumnIds: z.array(z.string()) } },
    async ({ boardId, orderedColumnIds }) => safe(() => db.reorderColumns(client, boardId, orderedColumnIds)),
  );

  server.registerTool(
    'add_card',
    {
      title: 'Add card',
      description: 'Add a card to a column.',
      inputSchema: {
        boardId: z.string(),
        columnId: z.string(),
        title: z.string(),
        description: z.string().optional().describe('Short description, separate from the card body text'),
        text: z.string().optional().describe('Card body text'),
        targetDate: targetDateSchema.optional(),
        labels: z.array(labelEnum).optional(),
        recurrence: recurrenceSchema.optional(),
      },
    },
    async ({ boardId, columnId, title, description, text: body, targetDate, labels, recurrence }) =>
      safe(() =>
        db.addCard(client, boardId, columnId, {
          title,
          description,
          content: textToContent(body),
          targetDate,
          labels: labels as CardLabel[] | undefined,
          recurrence,
        }),
      ),
  );

  server.registerTool(
    'update_card',
    {
      title: 'Update card',
      description: 'Update fields of a card. Description and body text are separate; omitted fields are preserved.',
      inputSchema: {
        boardId: z.string(),
        cardId: z.string(),
        title: z.string().optional(),
        description: z.string().optional().describe('Short description; empty string clears it'),
        text: z.string().optional().describe('Card body text; empty string clears it'),
        targetDate: targetDateSchema.optional(),
      },
    },
    async ({ boardId, cardId, title, description, text: body, targetDate }) =>
      safe(() =>
        db.updateCard(client, boardId, cardId, {
          ...(title !== undefined ? { title } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(body !== undefined ? { content: textToContent(body) } : {}),
          ...(targetDate !== undefined ? { targetDate } : {}),
        }),
      ),
  );

  server.registerTool(
    'move_card',
    { title: 'Move card', description: 'Move a card to another column (and optional index).', inputSchema: { boardId: z.string(), cardId: z.string(), targetColumnId: z.string(), targetIndex: z.number().int().nonnegative().optional() } },
    async ({ boardId, cardId, targetColumnId, targetIndex }) => safe(() => db.moveCard(client, boardId, cardId, targetColumnId, targetIndex)),
  );

  server.registerTool(
    'archive_card',
    { title: 'Archive card', description: 'Archive a card. A recurring card creates its next scheduled copy, as in the web app; archiving an already archived card does not create another copy.', inputSchema: { boardId: z.string(), cardId: z.string() } },
    async ({ boardId, cardId }) => safe(() => db.setCardArchived(client, boardId, cardId, true)),
  );

  server.registerTool(
    'restore_card',
    { title: 'Restore card', description: 'Restore an archived card.', inputSchema: { boardId: z.string(), cardId: z.string() } },
    async ({ boardId, cardId }) => safe(() => db.setCardArchived(client, boardId, cardId, false)),
  );

  server.registerTool(
    'duplicate_card',
    { title: 'Duplicate card', description: 'Duplicate a card within its column.', inputSchema: { boardId: z.string(), cardId: z.string() } },
    async ({ boardId, cardId }) => safe(() => db.duplicateCard(client, boardId, cardId)),
  );

  server.registerTool(
    'delete_card',
    { title: 'Delete card', description: 'Permanently delete a card.', inputSchema: { boardId: z.string(), cardId: z.string() }, annotations: DESTRUCTIVE },
    async ({ boardId, cardId }) => safe(() => db.removeCard(client, boardId, cardId)),
  );

  server.registerTool(
    'add_checklist_item',
    { title: 'Add checklist item', description: 'Add a checklist item to a card (converts the card content to a checklist).', inputSchema: { boardId: z.string(), cardId: z.string(), text: z.string() } },
    async ({ boardId, cardId, text: itemText }) => safe(() => db.addChecklistItem(client, boardId, cardId, itemText)),
  );

  server.registerTool(
    'toggle_checklist_item',
    { title: 'Toggle checklist item', description: 'Toggle (or set) a checklist item completed state.', inputSchema: { boardId: z.string(), cardId: z.string(), itemId: z.string(), completed: z.boolean().optional() } },
    async ({ boardId, cardId, itemId, completed }) => safe(() => db.toggleChecklistItem(client, boardId, cardId, itemId, completed)),
  );

  server.registerTool(
    'add_label',
    { title: 'Add label', description: `Add a color label to a card (${CARD_LABELS.join(', ')}).`, inputSchema: { boardId: z.string(), cardId: z.string(), label: labelEnum } },
    async ({ boardId, cardId, label }) => safe(() => db.setLabel(client, boardId, cardId, label as CardLabel, true)),
  );

  server.registerTool(
    'remove_label',
    { title: 'Remove label', description: 'Remove a color label from a card.', inputSchema: { boardId: z.string(), cardId: z.string(), label: labelEnum } },
    async ({ boardId, cardId, label }) => safe(() => db.setLabel(client, boardId, cardId, label as CardLabel, false)),
  );

  server.registerTool(
    'set_target_date',
    { title: 'Set target date', description: 'Set a calendar due date (YYYY-MM-DD) or clear it with null. Valid ISO timestamps use their written calendar date, without timezone conversion.', inputSchema: { boardId: z.string(), cardId: z.string(), targetDate: targetDateSchema.nullable() } },
    async ({ boardId, cardId, targetDate }) => safe(() => db.setTargetDate(client, boardId, cardId, targetDate)),
  );

  server.registerTool(
    'set_recurrence',
    {
      title: 'Set recurrence',
      description: 'Replace or clear a card recurrence (null clears it), preserving its target date and other fields. Archiving a recurring card creates its next scheduled copy; configuring recurrence does not create copies.',
      inputSchema: { boardId: z.string(), cardId: z.string(), recurrence: recurrenceSchema.nullable() },
    },
    async ({ boardId, cardId, recurrence }) => safe(() => db.setRecurrence(client, boardId, cardId, recurrence)),
  );

  server.registerTool(
    'set_cover_image',
    { title: 'Set cover image', description: 'Set or clear a card cover image URL (or null to clear). Attachment cover flags follow the selected URL; clearing keeps the attachments.', inputSchema: { boardId: z.string(), cardId: z.string(), coverImage: z.string().nullable() } },
    async ({ boardId, cardId, coverImage }) => safe(() => db.setCoverImage(client, boardId, cardId, coverImage)),
  );

  return server;
}

function registerResources(server: McpServer, client: SupabaseClient, user: User): void {
  server.registerResource(
    'me',
    'zeroboard://me',
    { title: 'Current user', description: 'The authenticated ZeroBoard account.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ id: user.id, email: user.email }, null, 2) }],
    }),
  );

  server.registerResource(
    'boards',
    'zeroboard://boards',
    { title: 'Boards index', description: 'All of your boards.', mimeType: 'application/json' },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await db.listBoards(client), null, 2) }],
    }),
  );

  server.registerResource(
    'board',
    new ResourceTemplate('zeroboard://board/{boardId}', { list: undefined }),
    { title: 'Board', description: 'A full board (columns + cards) as JSON.', mimeType: 'application/json' },
    async (uri, variables) => {
      const boardId = Array.isArray(variables.boardId) ? variables.boardId[0] : variables.boardId;
      return {
        contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await db.getBoard(client, boardId), null, 2) }],
      };
    },
  );
}

export async function runServer(): Promise<void> {
  let client: SupabaseClient;
  let user: User;
  try {
    ({ client, user } = await getAuthedClient());
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      console.error(`[zeroboard-mcp] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const server = buildServer(client, user);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[zeroboard-mcp] ready as ${user.email ?? user.id}${READ_ONLY ? ' (read-only)' : ''}. Listening on stdio.`,
  );
}

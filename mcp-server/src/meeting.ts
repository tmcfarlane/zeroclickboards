import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { targetDateSchema } from './target-date-schema.js';
import * as db from './board-data.js';
const processKey = randomBytes(32);
const cardSchema = z.object({ columnId: z.string().min(1), title: z.string().trim().min(1).max(300), description: z.string().max(2000).optional(), text: z.string().max(10000).optional(), targetDate: targetDateSchema.optional() }).strict();
const proposalSchema = z.object({ boardId: z.string(), revision: z.string(), expires: z.number(), cards: z.array(cardSchema.extend({ id: z.string() })).min(1).max(50) }).strict();
export function registerMeetingTools(server: McpServer, client: SupabaseClient, readOnly: boolean, key: string | Buffer = processKey, userId: string, boardIds: readonly string[]): void {
  key = createHmac('sha256', key).update(JSON.stringify({ userId, boardIds: [...boardIds].sort() })).digest();
  const sign = (value: string) => createHmac('sha256', key).update(value).digest();
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  const safe = async (fn: () => Promise<unknown>) => {
    try { return result(await fn()); }
    catch (e) { return { ...result({ error: e instanceof Error ? e.message : 'Request failed' }), isError: true }; }
  };
  server.registerTool('preview_cards', {
    title: 'Preview meeting cards', description: 'Validate selected actions and calendar dates without saving. Show this exact preview to the user before commit.',
    inputSchema: { boardId: z.string(), cards: z.array(cardSchema).min(1).max(50) }, _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['boards:read'] }] }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, ({ boardId, cards }) => safe(async () => {
    const board = await db.getBoard(client, boardId);
    if (cards.some((card) => !board.columns.some((column) => column.id === card.columnId))) throw new Error('Unknown destination column');
    const cardId = () => { const bytes = randomBytes(16); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80; const hex = bytes.toString('hex'); return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`; };
    const proposal = { boardId, revision: board.updatedAt, expires: Date.now() + 10 * 60_000,
      cards: cards.map((card) => ({ ...card, id: cardId() })) };
    const encoded = Buffer.from(JSON.stringify(proposal)).toString('base64url');
    return { boardName: board.name, ...proposal, previewToken: `${encoded}.${sign(encoded).toString('base64url')}` };
  }));
  if (readOnly) return;
  server.registerTool('commit_cards', {
    title: 'Save approved meeting cards', description: 'Save the exact preview only after explicit user approval. Repeated commits do not duplicate saved cards. On an ambiguous error, inspect the board before trying again.',
    inputSchema: { previewToken: z.string().max(1000000), approved: z.literal(true) }, _meta: { securitySchemes: [{ type: 'oauth2', scopes: ['boards:read', 'cards:add'] }] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
  }, ({ previewToken }) => safe(async () => {
    const parts = previewToken.split('.'); if (parts.length !== 2) throw new Error('Invalid preview');
    const [encoded, signature] = parts; const expected = sign(encoded); const received = Buffer.from(signature, 'base64url');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) throw new Error('Invalid preview signature');
    const proposal = proposalSchema.parse(JSON.parse(Buffer.from(encoded, 'base64url').toString()));
    if (proposal.expires < Date.now()) throw new Error('Preview expired; preview again');
    return db.addPreviewCards(client, proposal.boardId, proposal.revision, proposal.cards);
  }));
}

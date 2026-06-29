// Shared board logic bridge.
//
// The canonical board read/write logic lives in the MCP server package
// (mcp-server/src/board-data.ts) and operates directly on the boards.data JSONB
// using a Supabase client. The in-app AI assistant reuses that SAME logic for
// server-side grounding (reading real board state, with real ids) so the model
// no longer has to guess from a title-only snapshot.
//
// This file is the single import seam: if the MCP server's board logic changes,
// the web AI picks it up here. Only zod-free, dependency-light modules are
// re-exported (board-data.ts + types.ts) — the MCP transport/schema layer
// (server.ts, zod 3) is intentionally NOT imported, since the web app is on
// zod 4 and defines its own AI-SDK tool schemas.
import type { SupabaseClient } from '@supabase/supabase-js';
import * as bd from '../../mcp-server/src/board-data.js';

export type {
  Card,
  CardContent,
  CardLabel,
  Column,
  FullBoard,
  BoardSummary,
} from '../../mcp-server/src/types.js';
export { CARD_LABELS } from '../../mcp-server/src/types.js';

// The MCP package resolves its own copy of @supabase/supabase-js, so its
// `SupabaseClient` is a nominally distinct type from the web app's copy even
// though they are identical at runtime. Cast once, here, to keep the seam clean.
type BoardClient = Parameters<typeof bd.getBoard>[0];
const asClient = (c: SupabaseClient): BoardClient => c as unknown as BoardClient;

/** Read-only board helpers, scoped to a user's Supabase client (RLS-enforced). */
export const boardCore = {
  listBoards: (client: SupabaseClient) => bd.listBoards(asClient(client)),
  getBoard: (client: SupabaseClient, boardId: string) => bd.getBoard(asClient(client), boardId),
  search: (client: SupabaseClient, query: string, includeArchived = false) =>
    bd.search(asClient(client), query, includeArchived),
};

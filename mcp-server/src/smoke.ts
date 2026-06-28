// End-to-end smoke test of the board-data layer against REAL Supabase, using the
// dedicated e2e test user. Uses a direct in-memory client (does NOT touch the
// ~/.zeroboard credential store). Run: npm run build && npm run smoke
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import * as db from './board-data.js';

function loadEnv(): void {
  for (const p of [resolve(process.cwd(), '.env.local'), resolve(process.cwd(), '..', '.env.local')]) {
    try {
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m || process.env[m[1]] !== undefined) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        process.env[m[1]] = v;
      }
    } catch {
      /* try next path */
    }
  }
}

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`FAILED: ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  loadEnv();
  const url = process.env.VITE_SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY;
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;
  if (!url || !anon || !email || !password) {
    throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / E2E_EMAIL / E2E_PASSWORD (run scripts/e2e/ensure-test-user.mjs).');
  }

  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error || !signIn.data.user) throw new Error(`sign-in failed: ${signIn.error?.message}`);
  const userId = signIn.data.user.id;
  console.log(`Signed in as ${email}\n`);

  let boardId = '';
  try {
    const board = await db.createBoard(client, userId, 'MCP Smoke Board', 'created by smoke test');
    boardId = board.id;
    check('create_board returns default columns', board.columns.length === 5);

    const list = await db.listBoards(client);
    check('list_boards includes the new board', list.some((b) => b.id === boardId));

    const withCol = await db.addColumn(client, boardId, 'Review');
    check('add_column appends a column', withCol.columns.length === 6);
    const reviewCol = withCol.columns.find((c) => c.title === 'Review')!;
    check('add_column sets incremental order', reviewCol.order === 5);

    const todo = withCol.columns.find((c) => c.title === 'To Do')!;
    const afterCard = await db.addCard(client, boardId, todo.id, { title: 'Ship MCP v1', content: { type: 'text', text: 'wire it up' }, labels: ['green'] });
    const card = afterCard.columns.find((c) => c.id === todo.id)!.cards[0];
    check('add_card creates a card with a label', card.title === 'Ship MCP v1' && card.labels?.includes('green') === true);

    const moved = await db.moveCard(client, boardId, card.id, reviewCol.id);
    check('move_card moves the card to the target column', moved.columns.find((c) => c.id === reviewCol.id)!.cards.some((x) => x.id === card.id));
    check('move_card removes from source column', moved.columns.find((c) => c.id === todo.id)!.cards.length === 0);

    const checked = await db.addChecklistItem(client, boardId, card.id, 'subtask 1');
    const checkedCard = checked.columns.flatMap((c) => c.cards).find((x) => x.id === card.id)!;
    check('add_checklist_item converts content to checklist', checkedCard.content.type === 'checklist' && checkedCard.content.checklist?.length === 1);

    const hits = await db.search(client, 'Ship MCP');
    check('search finds the card', hits.some((h) => h.cardId === card.id));

    const fetched = await db.getBoard(client, boardId);
    check('get_board persists across reads (round-trips boards.data JSONB)', fetched.columns.flatMap((c) => c.cards).some((x) => x.id === card.id));

    const renamed = await db.updateBoardMeta(client, boardId, { name: 'MCP Smoke Board (renamed)' });
    check('update_board renames', renamed.name === 'MCP Smoke Board (renamed)');
  } finally {
    if (boardId) {
      await db.deleteBoard(client, boardId);
      console.log('\n  ✓ cleanup: deleted smoke board');
    }
  }

  console.log(`\n✅ smoke passed (${passed} checks)`);
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

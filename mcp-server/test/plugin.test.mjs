import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../dist/server.js';
import { getBoard, listBoards, search, addCard } from '../dist/board-data.js';
import { createBoardFixture, makeBoard } from './helpers/boards.mjs';
const payload = (r) => { assert.notEqual(r.isError, true, JSON.stringify(r)); return JSON.parse(r.content[0].text); };
async function connect(t, overrides = {}) {
  const access = overrides.access ?? { userId: 'user-1', boardIds: ['board-1'] };
  const fixture = createBoardFixture({ access, ...overrides });
  const server = buildServer(fixture.client, { id: access.userId }, { plugin: true, boardIds: access.boardIds, proposalKey: 'test-secret-which-has-more-than-32-bytes' });
  const mcp = new Client({ name: 'plugin-test', version: '1' });
  const [c, s] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await mcp.close(); await server.close(); });
  await server.connect(s); await mcp.connect(c); return { ...fixture, mcp };
}
const actions = { boardId: 'board-1', cards: [
  { columnId: 'column-a', title: 'Send launch notes', description: 'Owner: Alice', targetDate: '2026-10-02' },
  { columnId: 'column-a', title: 'Review launch checklist', description: 'Owner: Bob' },
] };
test('selected meeting actions preview without writes, approved batch saves dates, replay is additive once, standup reads', async (t) => {
  const { mcp, state } = await connect(t);
  const tools = (await mcp.request({ method: 'tools/list' }, z.object({ tools: z.array(z.object({ name: z.string() }).passthrough()) }))).tools;
  assert.deepEqual(tools.map((t) => t.name).sort(), ['commit_cards','get_board','get_card','list_boards','list_cards','list_columns','preview_cards','search']);
  assert.ok(tools.every((tool) => tool.annotations.destructiveHint === false && tool._meta.securitySchemes[0].type === 'oauth2' && tool.securitySchemes[0].type === 'oauth2'));
  const original = structuredClone(state.row.data);
  const proposal = payload(await mcp.callTool({ name: 'preview_cards', arguments: actions }));
  assert.deepEqual(state.row.data, original);
  assert.ok(state.requests.every((request) => request.method === 'GET'));
  const rejected = await mcp.callTool({ name: 'commit_cards', arguments: { previewToken: proposal.previewToken, approved: false } });
  assert.equal(rejected.isError, true); assert.deepEqual(state.row.data, original);
  const saved = payload(await mcp.callTool({ name: 'commit_cards', arguments: { previewToken: proposal.previewToken, approved: true } }));
  assert.equal(saved.columns[0].cards.length, 3); assert.equal(saved.columns[0].cards[1].targetDate, '2026-10-02');
  assert.deepEqual(saved.columns[1].cards, original.columns[1].cards);
  payload(await mcp.callTool({ name: 'commit_cards', arguments: { previewToken: proposal.previewToken, approved: true } }));
  assert.equal(state.row.data.columns[0].cards.length, 3);
  const before = state.requests.length;
  const standup = payload(await mcp.callTool({ name: 'list_cards', arguments: { boardId: 'board-1' } }));
  assert.equal(standup.length, 4); assert.equal(standup[1].description, 'Owner: Alice');
  assert.ok(state.requests.slice(before).every((request) => request.method === 'GET'));
});
test('modified or stale preview fails without writes', async (t) => {
  const { mcp, state } = await connect(t);
  const preview = payload(await mcp.callTool({ name: 'preview_cards', arguments: actions }));
  const tampered = preview.previewToken.replace(/^./, 'z');
  assert.equal((await mcp.callTool({ name: 'commit_cards', arguments: { previewToken: tampered, approved: true } })).isError, true);
  state.row.updated_at = '2026-10-01T00:00:00Z';
  assert.equal((await mcp.callTool({ name: 'commit_cards', arguments: { previewToken: preview.previewToken, approved: true } })).isError, true);
  assert.equal(state.requests.filter((r) => r.method === 'PATCH').length, 0);
});
for (const role of ['viewer', 'editor', undefined]) {
  test(`${role ?? 'public stranger'} membership permits only intended reads and writes`, async () => {
    const fixture = createBoardFixture({ row: makeBoard({ user_id: 'another-user', is_public: true }),
      access: { userId: 'user-1', boardIds: ['board-1'] }, members: role ? [{ board_id: 'board-1', user_id: 'user-1', role }] : [] });
    if (!role) {
      assert.deepEqual(await listBoards(fixture.client), []); assert.deepEqual(await search(fixture.client, 'card'), []);
      await assert.rejects(getBoard(fixture.client, 'board-1'), /membership/);
    } else { assert.equal((await listBoards(fixture.client)).length, 1); }
    const write = addCard(fixture.client, 'board-1', 'column-a', { title: 'Approved followup' });
    if (role === 'editor') await write; else await assert.rejects(write, /owner\/editor|membership/);
    assert.equal(fixture.state.requests.filter((r) => r.method === 'PATCH').length, role === 'editor' ? 1 : 0);
  });
}
test('selected-board grant blocks direct tools, resources, search and empty grants', async (t) => {
  const { mcp, state } = await connect(t, { row: makeBoard({ id: 'unselected' }) });
  assert.deepEqual(payload(await mcp.callTool({ name: 'list_boards', arguments: {} })), []);
  assert.deepEqual(payload(await mcp.callTool({ name: 'search', arguments: { query: 'card' } })), []);
  assert.equal((await mcp.callTool({ name: 'get_board', arguments: { boardId: 'unselected' } })).isError, true);
  await assert.rejects(mcp.readResource({ uri: 'zeroboard://board/unselected' }), /selected-board/);
  assert.equal(state.requests.filter((r) => r.method !== 'GET').length, 0);
  const empty = createBoardFixture({ access: { userId: 'user-1', boardIds: [] } });
  assert.deepEqual(await listBoards(empty.client), []);
});

test('approved preview cannot cross accounts and current viewer role blocks commit', async (t) => {
  const alice = await connect(t);
  const preview = payload(await alice.mcp.callTool({ name: 'preview_cards', arguments: actions }));
  const bob = await connect(t, { access: { userId: 'user-2', boardIds: ['board-1'] }, members: [{ user_id: 'user-2', board_id: 'board-1', role: 'editor' }] });
  assert.equal((await bob.mcp.callTool({ name: 'commit_cards', arguments: { previewToken: preview.previewToken, approved: true } })).isError, true);
  assert.equal(bob.state.requests.filter((r) => r.method === 'PATCH').length, 0);
  const viewer = await connect(t, { row: makeBoard({ user_id: 'owner' }), members: [{ user_id: 'user-1', board_id: 'board-1', role: 'viewer' }] });
  const draft = payload(await viewer.mcp.callTool({ name: 'preview_cards', arguments: actions }));
  assert.equal((await viewer.mcp.callTool({ name: 'commit_cards', arguments: { previewToken: draft.previewToken, approved: true } })).isError, true);
  assert.equal(viewer.state.requests.filter((r) => r.method === 'PATCH').length, 0);
});

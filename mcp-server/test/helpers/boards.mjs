import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

export function makeCard(id, overrides = {}) {
  return {
    id,
    title: id,
    content: { type: 'text', text: 'Keep this body' },
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    ...overrides,
  };
}

export function makeBoard(overrides = {}) {
  return {
    id: 'board-1',
    user_id: 'user-1',
    name: 'Example board',
    description: null,
    data: {
      columns: [
        { id: 'column-a', title: 'To do', order: 0, cards: [makeCard('card-a')] },
        { id: 'column-b', title: 'Done', order: 1, cards: [makeCard('card-b')] },
      ],
    },
    created_at: '2026-09-06T00:00:00.000Z',
    updated_at: '2026-09-06T00:00:00.000Z',
    is_public: false,
    embed_enabled: false,
    ...overrides,
  };
}

export const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' },
});

/**
 * Exercise the real Supabase query builder with an isolated PostgREST adapter.
 * onRequest can change state.row to simulate another writer, throw a transport
 * error, or return a Response. Normal GET/PATCH/DELETE honor equality filters;
 * successful writes advance updated_at, as the production database trigger does.
 */
export function createBoardFixture({ row = makeBoard(), onRequest } = {}) {
  const state = { row: structuredClone(row), requests: [], version: 0 };
  const fetch = async (input, init = {}) => {
    const url = new URL(input);
    assert.equal(url.pathname, '/rest/v1/boards');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    const request = { method, url, body, headers: new Headers(init.headers) };
    state.requests.push(request);
    const intercepted = await onRequest?.(request, state);
    if (intercepted) return intercepted;

    const matches = state.row && ['id', 'updated_at'].every((key) => {
      const filter = url.searchParams.get(key);
      return filter === null || filter === `eq.${state.row[key]}`;
    });
    let rows = [];
    if (matches) {
      if (method === 'PATCH') {
        state.version += 1;
        state.row = {
          ...state.row,
          ...structuredClone(body),
          updated_at: `2026-09-06T01:00:00.${String(state.version).padStart(6, '0')}Z`,
        };
      }
      rows = [structuredClone(state.row)];
      if (method === 'DELETE') state.row = null;
    }
    assert.ok(['GET', 'PATCH', 'DELETE'].includes(method), `Unexpected request method ${method}`);
    if (request.headers.get('accept') === 'application/vnd.pgrst.object+json') {
      if (rows.length === 0) {
        return jsonResponse({ code: 'PGRST116', details: 'The result contains 0 rows', message: 'No rows' }, 406);
      }
      return jsonResponse(rows[0]);
    }
    return jsonResponse(rows);
  };
  const client = createClient('https://boards.test', 'test-anon-key', {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, state };
}

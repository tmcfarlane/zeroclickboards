import assert from 'node:assert/strict';
import test from 'node:test';
import { createNodeClient } from '../dist/node-client.js';

test('production client initializes without native WebSocket and leaves Realtime disconnected', async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  let fetchCount = 0;
  try {
    Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: undefined });
    const client = createNodeClient('https://boards.test', 'test-anon-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        headers: { 'x-test-option': 'preserved' },
        fetch: async (input, init) => {
          fetchCount += 1;
          assert.equal(new URL(input).pathname, '/rest/v1/boards');
          assert.equal(new Headers(init.headers).get('x-test-option'), 'preserved');
          return new Response('[]', { headers: { 'content-type': 'application/json' } });
        },
      },
    });
    assert.equal(fetchCount, 0);
    assert.equal(client.realtime.isConnected(), false);
    assert.equal(client.realtime.isConnecting(), false);
    assert.deepEqual(client.getChannels(), []);
    const { data, error } = await client.from('boards').select('id');
    assert.equal(error, null);
    assert.deepEqual(data, []);
    assert.equal(fetchCount, 1);
    assert.equal(client.realtime.isConnected(), false);
    assert.equal(client.realtime.isConnecting(), false);
  } finally {
    if (original) Object.defineProperty(globalThis, 'WebSocket', original);
    else delete globalThis.WebSocket;
  }
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APICallError, DownloadError, generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const GATEWAY_BASE = 'https://fixture-gateway.example.invalid/v1';
const FIXTURE_TEXT = 'Synthetic board response';
const FIXTURE_ERROR = 'Synthetic gateway rejected the request';

// The upstream SDK's default is 2 GiB, not an application-sized memory cap.
// Advertise a larger response while delivering a small valid stream. This
// proves early header rejection/cancellation without allocating 2 GiB; it does
// not exercise the cumulative no-Content-Length threshold.
const DECLARED_OVER_LIMIT_BYTES = 2 * 1024 * 1024 * 1024 + 1;

type Adapter = 'chat' | 'responses';

function successfulBody(adapter: Adapter) {
  if (adapter === 'chat') {
    return {
      id: 'chat_fixture',
      object: 'chat.completion',
      created: 1,
      model: 'fixture-model',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: FIXTURE_TEXT },
        finish_reason: 'stop',
        logprobs: null,
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }

  return {
    id: 'response_fixture',
    object: 'response',
    created_at: 1,
    model: 'fixture-model',
    status: 'completed',
    output: [{
      type: 'message',
      id: 'message_fixture',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: FIXTURE_TEXT, annotations: [] }],
    }],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
}

function createGatewayFixture(adapter: Adapter, { error = false, oversized = false } = {}) {
  const body = error
    ? { error: { message: FIXTURE_ERROR, type: 'fixture_error', code: 'fixture_error' } }
    : successfulBody(adapter);
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const streamState = { deliveredBytes: 0, cancelled: false, completed: false };
  let offset = 0;
  const bodyStream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        streamState.completed = true;
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + 29);
      offset += chunk.length;
      streamState.deliveredBytes += chunk.length;
      controller.enqueue(chunk);
    },
    cancel() {
      streamState.cancelled = true;
    },
  }, { highWaterMark: 0 });

  const expectedUrl = `${GATEWAY_BASE}/${adapter === 'chat' ? 'chat/completions' : 'responses'}`;
  const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    expect(url).toBe(expectedUrl);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body)).model).toBe('fixture-model');
    return new Response(bodyStream, {
      status: error ? 400 : 200,
      headers: {
        'content-type': 'application/json',
        ...(oversized ? { 'content-length': String(DECLARED_OVER_LIMIT_BYTES) } : {}),
      },
    });
  });
  const gateway = createOpenAI({
    baseURL: GATEWAY_BASE,
    apiKey: 'synthetic-fixture-key',
    fetch: fetchFixture,
  });

  return {
    generate: () => generateText({
      // These are the same public adapter modes used by the command and board-
      // template endpoints. No SDK parser/size helper or generation is mocked.
      model: adapter === 'chat' ? gateway.chat('fixture-model') : gateway('fixture-model'),
      prompt: 'Synthetic prompt; no real provider is contacted.',
      maxRetries: 0,
    }),
    fetchFixture,
    streamState,
    bodyBytes: bytes.length,
  };
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network request'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(['chat', 'responses'] as const)('actual OpenAI %s adapter response size guard', (adapter) => {
  it('accepts ordinary successful streamed JSON', async () => {
    const fixture = createGatewayFixture(adapter);

    const result = await fixture.generate();

    expect(result.text).toBe(FIXTURE_TEXT);
    expect(fixture.fetchFixture).toHaveBeenCalledTimes(1);
    expect(fixture.streamState.deliveredBytes).toBe(fixture.bodyBytes);
    expect(fixture.streamState.completed).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('preserves an ordinary streamed upstream JSON error', async () => {
    const fixture = createGatewayFixture(adapter, { error: true });

    await expect(fixture.generate()).rejects.toMatchObject({
      message: FIXTURE_ERROR,
      statusCode: 400,
    });

    expect(fixture.fetchFixture).toHaveBeenCalledTimes(1);
    expect(fixture.streamState.deliveredBytes).toBe(fixture.bodyBytes);
    expect(fixture.streamState.completed).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([false, true])('rejects and cancels declared oversized streamed JSON before reading (error=%s)', async (error) => {
    const fixture = createGatewayFixture(adapter, { error, oversized: true });

    await expect(fixture.generate()).rejects.toSatisfy((caught: unknown) => {
      expect(APICallError.isInstance(caught)).toBe(true);
      const cause = (caught as APICallError).cause;
      expect(DownloadError.isInstance(cause)).toBe(true);
      expect((cause as DownloadError).message).toContain('exceeded maximum size');
      return true;
    });

    expect(fixture.fetchFixture).toHaveBeenCalledTimes(1);
    expect(fixture.streamState.deliveredBytes).toBe(0);
    expect(fixture.streamState.cancelled).toBe(true);
    expect(fixture.streamState.completed).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

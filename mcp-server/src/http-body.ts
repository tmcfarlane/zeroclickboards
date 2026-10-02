import type { IncomingMessage } from 'node:http';

export const MCP_JSON_LIMIT = 1024 * 1024;
type BodyRequest = IncomingMessage & { body?: unknown };

function failure(type: string, status: number) {
  return Object.assign(new Error('Invalid MCP request body'), { type, status });
}

/** Inspect the adapter boundary without invoking Vercel's lazy JSON getter. */
export function hasPreparsedBody(req: IncomingMessage): boolean {
  return req.readableEnded && Object.getOwnPropertyDescriptor(req, 'body') !== undefined;
}

/** Bound every SDK parsed-body handoff; only completed adapter streams are probed. */
export function readMcpJsonBody(req: BodyRequest, preparsed: boolean): unknown {
  const contentType = req.headers['content-type'];
  const mediaType = contentType?.split(';', 1)[0].trim().toLowerCase();
  if (!contentType || mediaType !== 'application/json') throw failure('media.unsupported', 415);
  let rawTypeIndex = -1;
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index].toLowerCase() !== 'content-type') continue;
    const rawType = req.rawHeaders[index + 1].split(';', 1)[0].trim().toLowerCase();
    // Node keeps the first duplicate type, while the Web bridge joins them.
    if (rawTypeIndex !== -1 || rawType !== 'application/json') throw failure('media.unsupported', 415);
    rawTypeIndex = index + 1;
  }

  if (preparsed) {
    // A supplied object/byte buffer does not establish whether an adapter has
    // inflated an encoded body. Raw requests retain Express's inflation policy.
    const encoding = (req.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
    if (encoding !== 'identity') throw failure('encoding.unsupported', 415);
    const length = req.headers['content-length'];
    if (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > MCP_JSON_LIMIT) {
      throw failure('entity.too.large', 413);
    }
    const suppliedBytes: unknown = Object.getOwnPropertyDescriptor(req, 'rawBody')?.value;
    // The current Vercel helper restores its original Buffer behind req.read()
    // even though the original IncomingMessage has ended. No end event is awaited.
    const bytes: unknown = Buffer.isBuffer(suppliedBytes) ? suppliedBytes : req.read(MCP_JSON_LIMIT + 1);
    if (Buffer.isBuffer(bytes) && bytes.length > MCP_JSON_LIMIT) throw failure('entity.too.large', 413);
  }

  let body: unknown;
  let serialized: string | undefined;
  try {
    body = req.body;
    if (body !== undefined) {
      serialized = JSON.stringify(body);
      if (serialized === undefined) throw new Error('Not JSON');
    }
  } catch {
    throw failure('entity.parse.failed', 400);
  }
  // Consumed-only adapters cannot recover whitespace/escape bytes. This is a
  // UTF-8 logical-payload bound, supplemented by exact bytes where available.
  if (serialized !== undefined && Buffer.byteLength(serialized, 'utf8') > MCP_JSON_LIMIT) {
    throw failure('entity.too.large', 413);
  }
  // Media types are case-insensitive. The SDK checks a case-sensitive substring,
  // so canonicalize only the verified type and retain its original parameters.
  const parameters = contentType.indexOf(';');
  const normalizedType = 'application/json' + (parameters < 0 ? '' : contentType.slice(parameters));
  req.headers['content-type'] = normalizedType;
  // The SDK's Node-to-Web bridge reads rawHeaders rather than headers.
  if (rawTypeIndex < 0) req.rawHeaders.push('Content-Type', normalizedType);
  else req.rawHeaders[rawTypeIndex] = normalizedType;
  return body;
}

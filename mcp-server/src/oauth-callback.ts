/** Public-client callbacks: exact HTTPS, or a literal native loopback URI. */
function parseCallback(value: unknown): { nativePathQuery?: string } | null {
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\#]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  const authority = /^[^:]+:\/\/([^/\?]*)/.exec(value)?.[1];
  if (!authority || authority.includes('@') || url.username || url.password) return null;
  if (url.protocol === 'https:') return {};
  // Match the original authority, not URL.hostname: URL parsing normalizes
  // decimal, hex, octal and abbreviated addresses to 127.0.0.1.
  const native = /^http:\/\/127\.0\.0\.1(?::([1-9][0-9]{0,4}))?(\/[^#]*)$/.exec(value);
  if (!native || (native[1] !== undefined && Number(native[1]) > 65535)) return null;
  // A browser must visit exactly the registered path/query, without dot-segment
  // or backslash normalization. Only the native listener port may vary.
  if (native[2] !== url.pathname + url.search) return null;
  return { nativePathQuery: native[2] };
}

export function isOAuthCallbackUri(value: unknown): value is string {
  return parseCallback(value) !== null;
}

/** Registration matching only; code exchange still compares the stored URI exactly. */
export function oauthCallbackMatches(requested: unknown, registered: unknown): boolean {
  const request = parseCallback(requested);
  const registration = parseCallback(registered);
  if (!request || !registration) return false;
  if (requested === registered) return true;
  return request.nativePathQuery !== undefined && registration.nativePathQuery !== undefined &&
    request.nativePathQuery === registration.nativePathQuery;
}

export type CallbackKind = 'native' | 'chatgpt';

/** Only advertise setup paths whose documented callbacks are registered. */
export function callbackKinds(callbacks: readonly string[]): CallbackKind[] {
  const kinds: CallbackKind[] = [];
  if (callbacks.some(uri => oauthCallbackMatches('http://127.0.0.1/callback', uri))) kinds.push('native');
  if (callbacks.includes('https://chatgpt.com/connector_platform_oauth_redirect')) kinds.push('chatgpt');
  return kinds;
}

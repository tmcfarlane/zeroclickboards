import readline from 'node:readline';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createNodeClient } from './node-client.js';
import { makeClient, getAuthedClient, NotAuthenticatedError } from './supabase.js';
import { setSupabaseUrl, clearCredentials, hasCredentials } from './credentials.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, WEB_BASE_URL } from './config.js';

function flag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

function question(query: string, mask = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (mask) {
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      process.stdout.write(s.includes('\n') || s.includes(query) ? s : '*');
    };
  }
  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      if (mask) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function openBrowser(url: string): void {
  if (process.env.ZEROBOARD_NO_BROWSER) return; // headless: just print the URL
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* fall back to the printed URL */
    });
    child.unref();
  } catch {
    /* user can open the URL manually */
  }
}

interface Tokens {
  access_token: string;
  refresh_token: string;
}

/**
 * Browser sign-in: start a loopback listener, open the ZeroBoard web app's
 * /auth/cli page (which reuses the app's existing Supabase sign-in — Google or
 * email), and receive the resulting tokens back on the loopback. A random
 * `state` (only ever in the URL we opened) gates the callback against other
 * local processes/tabs. No password ever touches this CLI.
 */
async function browserLogin(): Promise<void> {
  const state = randomBytes(16).toString('hex');
  let resolveDone!: (email: string) => void;
  let rejectDone!: (e: Error) => void;
  const done = new Promise<string>((res, rej) => {
    resolveDone = res;
    rejectDone = rej;
  });

  // Validate and store a delivered session. Returns true once a VALID session is
  // accepted; a stale/invalid delivery is rejected and the loopback keeps
  // listening (so a premature delivery doesn't abort the whole login).
  const accept = async (data: { state?: string } & Partial<Tokens>): Promise<{ code: number; body: object }> => {
    if (data.state !== state) return { code: 403, body: { ok: false, error: 'state mismatch' } };
    if (!data.access_token || !data.refresh_token) return { code: 400, body: { ok: false, error: 'missing tokens' } };
    const tokens: Tokens = { access_token: data.access_token, refresh_token: data.refresh_token };

    // Validate with a throwaway, non-persisting client so a bad session never
    // pollutes the credential store.
    const probe = createNodeClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const set = await probe.auth.setSession(tokens);
    if (set.error || !set.data.session) return { code: 401, body: { ok: false, error: 'session invalid — sign in again' } };
    const who = await probe.auth.getUser();
    if (who.error || !who.data.user) return { code: 401, body: { ok: false, error: 'session could not be validated' } };

    // Persist via the file-backed client (canonical supabase-js storage format).
    const store = makeClient();
    const stored = await store.auth.setSession(tokens);
    if (stored.error || !stored.data.session) return { code: 500, body: { ok: false, error: 'failed to store session' } };
    setSupabaseUrl(SUPABASE_URL);
    resolveDone(who.data.user.email ?? 'your account');
    return { code: 200, body: { ok: true } };
  };

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'POST' && (req.url ?? '').startsWith('/callback')) {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1_000_000) req.destroy();
      });
      req.on('end', () => {
        const reply = (code: number, obj: object) => {
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(obj));
        };
        let parsed: ({ state?: string } & Partial<Tokens>) | null = null;
        try {
          parsed = JSON.parse(body) as ({ state?: string } & Partial<Tokens>) | null;
        } catch {
          reply(400, { ok: false, error: 'bad request' });
          return;
        }
        if (!parsed || typeof parsed !== 'object') {
          reply(400, { ok: false, error: 'bad request' });
          return;
        }
        accept(parsed).then(({ code, body: b }) => reply(code, b)).catch(() => reply(500, { ok: false }));
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const url = `${WEB_BASE_URL}/auth/cli?port=${port}&state=${state}`;

  console.log('Opening your browser to sign in to ZeroBoard…');
  console.log(`If it does not open automatically, visit:\n  ${url}\n`);
  openBrowser(url);

  const timeout = setTimeout(() => rejectDone(new Error('Timed out waiting for sign-in (5 minutes).')), 300_000);
  let email: string;
  try {
    email = await done;
  } finally {
    clearTimeout(timeout);
    server.close();
  }
  console.log(`✅ Signed in as ${email}.`);
}

/** Fallback: direct email/password sign-in (flags, env, or interactive prompt). */
async function passwordLogin(): Promise<void> {
  const email = flag('email') ?? process.env.ZEROBOARD_EMAIL ?? (await question('Email: '));
  const password = flag('password') ?? process.env.ZEROBOARD_PASSWORD ?? (await question('Password: ', true));
  if (!email || !password) throw new Error('Email and password are required.');

  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message ?? 'no session returned'}`);
  setSupabaseUrl(SUPABASE_URL);
  console.log(`✅ Signed in as ${data.user?.email ?? email}.`);
}

export async function login(): Promise<void> {
  // Use password mode when explicitly asked or when credentials are supplied;
  // otherwise do the browser flow (supports Google OAuth + email).
  const usePassword =
    process.argv.includes('--password') ||
    flag('email') !== undefined ||
    (!!process.env.ZEROBOARD_EMAIL && !!process.env.ZEROBOARD_PASSWORD);
  return usePassword ? passwordLogin() : browserLogin();
}

export function logout(): void {
  clearCredentials();
  console.log('✅ Signed out — local credentials cleared.');
}

export async function status(): Promise<void> {
  if (!hasCredentials()) {
    console.log('Not signed in. Run `zeroboard-mcp login`.');
    return;
  }
  try {
    const { user } = await getAuthedClient();
    console.log(`Signed in as ${user.email ?? user.id}.`);
  } catch (err) {
    if (err instanceof NotAuthenticatedError) {
      console.log(err.message);
      return;
    }
    throw err;
  }
}

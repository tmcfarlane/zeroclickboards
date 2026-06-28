import readline from 'node:readline';
import { makeClient } from './supabase.js';
import { setSupabaseUrl, clearCredentials, hasCredentials } from './credentials.js';
import { getAuthedClient, NotAuthenticatedError } from './supabase.js';
import { SUPABASE_URL } from './config.js';

function flag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.slice(name.length + 3) : undefined;
}

function question(query: string, mask = false): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (mask) {
    // Replace echoed characters with '*' while typing the password.
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

export async function login(): Promise<void> {
  const email = flag('email') ?? process.env.ZEROBOARD_EMAIL ?? (await question('Email: '));
  const password = flag('password') ?? process.env.ZEROBOARD_PASSWORD ?? (await question('Password: ', true));
  if (!email || !password) throw new Error('Email and password are required.');

  const client = makeClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`Login failed: ${error?.message ?? 'no session returned'}`);

  // The auth storage adapter already persisted the session; record the URL too.
  setSupabaseUrl(SUPABASE_URL);
  console.log(`✅ Signed in as ${data.user?.email ?? email}.`);
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

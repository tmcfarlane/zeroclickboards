import { homedir } from 'node:os';
import { join } from 'node:path';

// Public ZeroBoard Supabase project defaults so the published package works with
// zero configuration. Both values are PUBLISHABLE: the anon key is a `role: anon`
// JWT (the same one shipped in the web app's browser bundle), and Postgres RLS
// (`auth.uid() = user_id`) enforces per-user access. The service-role key is
// never included. Override with ZEROBOARD_SUPABASE_URL / ZEROBOARD_SUPABASE_ANON_KEY.
const DEFAULT_SUPABASE_URL = 'https://lhupamtkfuntxwosogtz.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxodXBhbXRrZnVudHh3b3NvZ3R6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE1OTIwNzEsImV4cCI6MjA3NzE2ODA3MX0.RRzUk5vf5cqvc-gjCua_LMT5UubaM6OJdMJ_LBls88U';

export const SUPABASE_URL =
  process.env.ZEROBOARD_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  process.env.ZEROBOARD_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;

/** The ZeroBoard web app, used for the browser sign-in (`/auth/cli`) flow. */
export const WEB_BASE_URL = (process.env.ZEROBOARD_WEB_URL ?? 'https://board.zeroclickdev.ai').replace(/\/$/, '');

/** Read-only mode: only non-mutating tools are registered. */
export const READ_ONLY =
  process.env.ZEROBOARD_READONLY === '1' || process.argv.includes('--read-only');

export const CONFIG_DIR = join(homedir(), '.zeroboard');
export const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json');

/** supabase-js derives this from the URL; we reproduce it for the storage key. */
export function storageKeyFor(url: string): string {
  try {
    const ref = new URL(url).hostname.split('.')[0];
    return `sb-${ref}-auth-token`;
  } catch {
    return 'sb-zeroboard-auth-token';
  }
}

export function assertConfigured(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'ZeroBoard Supabase URL/anon key not configured. Set ZEROBOARD_SUPABASE_URL and ' +
        'ZEROBOARD_SUPABASE_ANON_KEY (or VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
    );
  }
}

import { homedir } from 'node:os';
import { join } from 'node:path';

// When this package is published, the public ZeroBoard Supabase URL + anon key
// are baked in as defaults (both are publishable; RLS enforces per-user access).
// In-repo they are read from the environment so no secrets are committed.
const DEFAULT_SUPABASE_URL = '';
const DEFAULT_SUPABASE_ANON_KEY = '';

export const SUPABASE_URL =
  process.env.ZEROBOARD_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? DEFAULT_SUPABASE_URL;

export const SUPABASE_ANON_KEY =
  process.env.ZEROBOARD_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? DEFAULT_SUPABASE_ANON_KEY;

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

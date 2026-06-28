import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { CONFIG_DIR, CREDENTIALS_PATH } from './config.js';

// Token-at-rest store. A future version should prefer the OS keychain (keytar);
// for now we use a 0600 file under ~/.zeroboard. `token` holds the exact value
// supabase-js persists (the JSON-serialized Session), so refresh rotation just
// rewrites it via the storage adapter below.
interface CredFile {
  url?: string;
  token?: string;
}

function read(): CredFile {
  try {
    return JSON.parse(readFileSync(CREDENTIALS_PATH, 'utf8')) as CredFile;
  } catch {
    return {};
  }
}

function write(next: CredFile): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CREDENTIALS_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
}

export function setSupabaseUrl(url: string): void {
  write({ ...read(), url });
}

export function clearCredentials(): void {
  if (existsSync(CREDENTIALS_PATH)) rmSync(CREDENTIALS_PATH);
}

export function hasCredentials(): boolean {
  return !!read().token;
}

/**
 * A supabase-js storage adapter backed by the credentials file. supabase-js
 * calls setItem whenever it persists/rotates the session, so refresh tokens stay
 * current on disk. We keep a single session, so the storage key is ignored.
 */
export const fileStorage = {
  getItem(_key: string): string | null {
    return read().token ?? null;
  },
  setItem(_key: string, value: string): void {
    write({ ...read(), token: value });
  },
  removeItem(_key: string): void {
    const current = read();
    delete current.token;
    write(current);
  },
};

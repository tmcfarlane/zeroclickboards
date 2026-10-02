import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from 'node:fs';
import { CONFIG_DIR, CREDENTIALS_PATH, SUPABASE_URL } from './config.js';

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
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  // writeFileSync's mode applies only when creating a file. Tighten a copied or
  // older credentials file before writing newly rotated account tokens into it.
  if (existsSync(CREDENTIALS_PATH)) chmodSync(CREDENTIALS_PATH, 0o600);
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

function projectMatches(current: CredFile, url: string): boolean {
  // Older profiles without URL metadata remain compatible. Every new session
  // write below binds its URL at the same time as its credentials.
  if (!current.url) return true;
  try { return new URL(current.url).href.replace(/\/$/, '') === new URL(url).href.replace(/\/$/, ''); }
  catch { return false; }
}

export function credentialsMatchProject(url: string): boolean {
  return projectMatches(read(), url);
}

/**
 * A supabase-js storage adapter backed by the credentials file. supabase-js
 * calls setItem whenever it persists/rotates the session, so refresh tokens stay
 * current on disk. We keep a single session, so the storage key is ignored.
 */
export const fileStorage = {
  getItem(_key: string): string | null {
    const current = read();
    return projectMatches(current, SUPABASE_URL) ? current.token ?? null : null;
  },
  setItem(_key: string, value: string): void {
    write({ ...read(), url: SUPABASE_URL, token: value });
  },
  removeItem(_key: string): void {
    const current = read();
    // An unconfigured/foreign client must not erase the saved account when
    // its auth initialization or refresh fails against a different project.
    if (!projectMatches(current, SUPABASE_URL)) return;
    delete current.token;
    write(current);
  },
};

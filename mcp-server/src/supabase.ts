import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, storageKeyFor, assertConfigured } from './config.js';
import { fileStorage } from './credentials.js';

/**
 * Build a Supabase client backed by the on-disk credential store. With
 * persistSession + autoRefreshToken, supabase-js loads the saved session, keeps
 * the access token fresh, and rewrites the rotated refresh token to disk — the
 * server equivalent of the web app's api/_lib/auth.ts authenticated client.
 * Every request carries a fresh, RLS-scoped JWT (anon key only; never service-role).
 */
export function makeClient(): SupabaseClient {
  assertConfigured();
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: fileStorage,
      storageKey: storageKeyFor(SUPABASE_URL),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}

export class NotAuthenticatedError extends Error {
  constructor(message = 'Not signed in. Run `zeroboard-mcp login` first.') {
    super(message);
    this.name = 'NotAuthenticatedError';
  }
}

/**
 * Return a client whose stored session is valid against the server. Throws
 * NotAuthenticatedError if there is no session or the token is revoked/expired.
 */
export async function getAuthedClient(): Promise<{ client: SupabaseClient; user: User }> {
  const client = makeClient();
  const { data: sessionData } = await client.auth.getSession();
  if (!sessionData.session) throw new NotAuthenticatedError();

  // Validate against the server (also triggers a refresh if needed).
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new NotAuthenticatedError(
      `Stored session is no longer valid${error ? ` (${error.message})` : ''}. Run \`zeroboard-mcp login\`.`,
    );
  }
  return { client, user: data.user };
}

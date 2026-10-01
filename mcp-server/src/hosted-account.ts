import { createNodeClient } from './node-client.js';
import type { AccountContext } from './oauth.js';
/** The vault adapter loads/refreshes the existing Supabase account session privately. */
export function hostedAccountResolver(options: {
  supabaseUrl: string; publishableKey: string;
  loadAccessToken: (opaqueAccountRef: string) => Promise<string>;
}): (accountRef: string) => Promise<AccountContext> {
  if (new URL(options.supabaseUrl).protocol !== 'https:') throw new Error('Hosted account validation requires HTTPS');
  const key = options.publishableKey;
  if (key.startsWith('sb_secret_')) throw new Error('Hosted board clients require a publishable key');
  if (key.split('.').length === 3 && JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role !== 'anon') {
    throw new Error('Hosted board clients require an anon/publishable key');
  }
  return async (accountRef) => {
    const token = await options.loadAccessToken(accountRef);
    // Each call creates a fresh client without disk storage, shared auth state or auto-refresh timers.
    const client = createNodeClient(options.supabaseUrl, key, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) throw new Error('Existing ZeroBoard account session is unavailable');
    return { client, user: data.user };
  };
}

import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { advanceAuthSessionRevision, getAuthSessionRevision } from './auth-session';

type ApiFetchInit = Omit<RequestInit, 'headers'> & {
  session?: Session | null;
  headers?: HeadersInit;
};

export async function apiFetch(input: string, init: ApiFetchInit = {}): Promise<Response> {
  const revision = getAuthSessionRevision();
  const { session, headers, ...rest } = init;
  const merged = new Headers(headers);
  if (session?.access_token) {
    merged.set('Authorization', `Bearer ${session.access_token}`);
  }
  const res = await fetch(input, { ...rest, headers: merged });
  if (res.status === 401 && session?.access_token && revision === getAuthSessionRevision()) {
    try {
      const current = await supabase.auth.getSession();
      if (!current.error && current.data.session?.access_token === session.access_token &&
        revision === getAuthSessionRevision()) {
        // A following login intent queues behind this SDK cleanup via its lock.
        advanceAuthSessionRevision();
        await supabase.auth.signOut({ scope: 'local' });
      }
    } catch {
      // Keep the original API failure available if local session cleanup fails.
    }
  }
  return res;
}

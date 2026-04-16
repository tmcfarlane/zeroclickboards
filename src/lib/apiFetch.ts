import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

type ApiFetchInit = Omit<RequestInit, 'headers'> & {
  session?: Session | null;
  headers?: HeadersInit;
};

export async function apiFetch(input: string, init: ApiFetchInit = {}): Promise<Response> {
  const { session, headers, ...rest } = init;
  const merged = new Headers(headers);
  if (session?.access_token) {
    merged.set('Authorization', `Bearer ${session.access_token}`);
  }
  const res = await fetch(input, { ...rest, headers: merged });
  if (res.status === 401 && session?.access_token) {
    await supabase.auth.signOut({ scope: 'local' });
  }
  return res;
}

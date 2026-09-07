import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
  type WebSocketLikeConstructor,
} from '@supabase/supabase-js';
import WebSocket from 'ws';

// Supabase supports ws at runtime, but its DOM event types differ from @types/ws.
const nodeTransport = WebSocket as unknown as WebSocketLikeConstructor;

/** Supabase initializes Realtime even for REST/auth clients; Node 20 needs an explicit transport. */
export function createNodeClient(
  url: string,
  key: string,
  options: SupabaseClientOptions<'public'> = {},
): SupabaseClient {
  return createClient(url, key, {
    ...options,
    realtime: { ...options.realtime, transport: nodeTransport },
  });
}

import type { Session } from '@supabase/supabase-js';
import { apiFetch } from '@/lib/apiFetch';

export interface ConnectorConnection {
  id: string;
  clientName: string;
  boardIds: string[];
  boards?: { id: string; name: string }[];
  scopes: string[];
  expiresAt: string;
}

export interface ConnectorStatus {
  available: boolean;
  endpoint: string | null;
  connections: ConnectorConnection[];
  clients?: { name: string; clientId: string }[];
  reason?: string;
}

export interface ConnectorConsent {
  clientName: string;
  scopes: string[];
  boards: { id: string; name: string; canAddCards: boolean }[];
  expiresAt: string;
}

export const permissionLabels: Record<string, string> = {
  'boards:read': 'Read boards, cards, and due dates',
  'cards:add': 'Add cards after you approve a preview',
};

export async function connectorRequest<T>(
  session: Session,
  options: { query?: URLSearchParams; body?: Record<string, unknown>; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await apiFetch(`/api/connector${options.query ? `?${options.query}` : ''}`, {
    session,
    signal: options.signal,
    ...(options.body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.body),
    } : {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : 'Unable to contact the connection service. Please try again.');
  }
  if (!data) throw new Error('The connection service returned an invalid response. Please try again.');
  return data as T;
}

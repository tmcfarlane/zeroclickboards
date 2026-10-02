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
  clients?: { name: string; clientId: string; callbackKinds: ('native' | 'chatgpt')[] }[];
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

export function permissionLabel(scope: string): string | undefined {
  return Object.hasOwn(permissionLabels, scope) ? permissionLabels[scope] : undefined;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const isDate = (value: unknown): value is string => isText(value) && Number.isFinite(Date.parse(value));
const isBoard = (value: unknown): boolean => isObject(value) && isText(value.id) && isText(value.name);
const isEndpoint = (value: unknown): boolean => {
  if (!isText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  } catch { return false; }
};

function isConnection(value: unknown): boolean {
  return isObject(value) && isText(value.id) && isText(value.clientName) &&
    isTextList(value.boardIds) && isTextList(value.scopes) && isDate(value.expiresAt) &&
    (value.boards === undefined || Array.isArray(value.boards) && value.boards.every(isBoard));
}

function isStatus(value: Record<string, unknown>): boolean {
  return typeof value.available === 'boolean' && (value.available ? isEndpoint(value.endpoint) : value.endpoint === null) &&
    Array.isArray(value.connections) && value.connections.every(isConnection) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.clients === undefined || Array.isArray(value.clients) && value.clients.every(client =>
      isObject(client) && isText(client.name) && isText(client.clientId) && Array.isArray(client.callbackKinds) &&
      client.callbackKinds.every(kind => kind === 'native' || kind === 'chatgpt')));
}

function isConsent(value: Record<string, unknown>): boolean {
  return isText(value.clientName) && isTextList(value.scopes) && value.scopes.length > 0 && isDate(value.expiresAt) &&
    Array.isArray(value.boards) && value.boards.every(board => isBoard(board) && typeof board.canAddCards === 'boolean');
}

function matchesOperation(value: unknown, options: { query?: URLSearchParams; body?: Record<string, unknown> }): boolean {
  if (!isObject(value)) return false;
  if (options.body) {
    switch (options.body.action) {
      case 'approve': return isText(value.redirectUrl);
      case 'cancel': return value.cancelled === true && (value.redirectUrl === undefined || isText(value.redirectUrl));
      case 'revoke': return value.success === true;
      default: return false;
    }
  }
  return options.query?.get('action') === 'consent' ? isConsent(value) : isStatus(value);
}

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
  // A successful HTTP status does not establish the payload contract. Validate
  // before rendering arrays, enabling board access, or acknowledging a mutation.
  if (!matchesOperation(data, options)) throw new Error('The connection service returned an invalid response. Please try again.');
  return data as T;
}

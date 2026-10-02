import type { Board } from '@/types';

export type BoardAccess = 'owner' | 'editor' | 'viewer' | 'commenter' | 'unknown';

export function memberAccess(role: unknown): BoardAccess {
  return role === 'editor' || role === 'viewer' || role === 'commenter' ? role : 'unknown';
}

export function boardAccessFor(board: Board | undefined, userId: string | null, access: Record<string, BoardAccess>): BoardAccess {
  if (!board) return 'unknown';
  if (userId ? board.userId === userId : !board.userId) return 'owner';
  return userId ? memberAccess(access[board.id]) : 'unknown';
}

export function editableAccess(access: BoardAccess): boolean {
  return access === 'owner' || access === 'editor';
}

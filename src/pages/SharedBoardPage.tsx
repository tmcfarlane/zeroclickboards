import { useEffect, useState, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { ReadOnlyBoard } from '@/components/board/ReadOnlyBoard';
import type { Board, Column } from '@/types';

// ─── Extended board type with sharing fields ────────────────────────────────────

interface SharedBoard extends Board {
  isPublic: boolean;
  embedEnabled: boolean;
}

// ─── Helper ─────────────────────────────────────────────────────────────────────

function rowToBoard(row: Record<string, unknown>): SharedBoard {
  const data = row.data as Record<string, unknown> | null;
  const columns: Column[] = data && Array.isArray((data as Record<string, unknown>).columns)
    ? (data as Record<string, unknown>).columns as Column[]
    : [];
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    columns,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    userId: row.user_id as string,
    isPublic: (row.is_public as boolean) ?? false,
    embedEnabled: (row.embed_enabled as boolean) ?? false,
  };
}

// ─── Access level badge ─────────────────────────────────────────────────────────

type AccessLevel = 'owner' | 'editor' | 'viewer' | 'commenter' | 'public';

function AccessBadge({ level }: { level: AccessLevel }) {
  const labels: Record<AccessLevel, string> = {
    owner: 'Owner',
    editor: 'Editor',
    viewer: 'Viewer',
    commenter: 'Commenter',
    public: 'Public viewer',
  };
  return (
    <span className="inline-flex items-center rounded-full bg-[#78fcd6]/10 border border-[#78fcd6]/30 px-3 py-0.5 text-xs font-medium text-[#78fcd6]">
      {labels[level]}
    </span>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function SharedBoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const { userId, isLoaded } = useAuth();

  const [board, setBoard] = useState<SharedBoard | null>(null);
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [noAccess, setNoAccess] = useState(false);

  useEffect(() => {
    if (!boardId || !isLoaded) return;

    let cancelled = false;

    async function fetchBoard() {
      setLoading(true);
      setNoAccess(false);

      const { data: row, error } = await supabase
        .from('boards')
        .select('*')
        .eq('id', boardId!)
        .single();

      if (cancelled) return;

      if (error || !row) {
        setNoAccess(true);
        setLoading(false);
        return;
      }

      const fetchedBoard = rowToBoard(row as Record<string, unknown>);
      setBoard(fetchedBoard);

      // Determine access level
      if (userId && fetchedBoard.userId === userId) {
        setAccessLevel('owner');
        setLoading(false);
        return;
      }

      if (userId) {
        // Check board_members table
        const { data: memberRow } = await supabase
          .from('board_members')
          .select('role')
          .eq('board_id', boardId!)
          .eq('user_id', userId)
          .single();

        if (cancelled) return;

        if (memberRow) {
          const role = memberRow.role;
          if (role === 'editor') {
            setAccessLevel('editor');
          } else if (role === 'commenter') {
            setAccessLevel('commenter');
          } else {
            setAccessLevel('viewer');
          }
          setLoading(false);
          return;
        }
      }

      // No membership found — check if board is public
      if (fetchedBoard.isPublic) {
        setAccessLevel('public');
        setLoading(false);
        return;
      }

      setNoAccess(true);
      setLoading(false);
    }

    void fetchBoard();
    return () => { cancelled = true; };
  }, [boardId, userId, isLoaded]);

  // ── Render ──

  if (loading || !isLoaded) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#78fcd6] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (noAccess || !board || !accessLevel) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-2xl font-bold text-[#F2F7F7]">Board not found</p>
        <p className="text-[#A8B2B2]">
          This board doesn't exist or you don't have access to it.
        </p>
        <Link
          to="/"
          className="inline-flex items-center justify-center h-11 px-8 gradient-cyan text-[#0B0F0F] font-bold rounded-xl hover:opacity-90 transition-opacity"
        >
          Go Home
        </Link>
      </div>
    );
  }

  const canEdit = accessLevel === 'owner' || accessLevel === 'editor';

  return (
    <div className="min-h-screen bg-[#0B0F0F] flex flex-col">
      {/* Minimal header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#111515]">
        <Link to="/" className="flex items-center gap-2 text-[#F2F7F7] hover:text-[#78fcd6] transition-colors">
          <span className="gradient-cyan text-xl font-black">Z</span>
          <span className="text-sm font-semibold">ZeroBoard</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#F2F7F7] font-medium truncate max-w-xs">{board.name}</span>
          <AccessBadge level={accessLevel} />
        </div>
      </header>

      {/* Board content */}
      <div className="flex-1">
        {canEdit ? (
          // Full KanbanBoard — lazy import to avoid pulling in the full store when not needed
          <FullBoardWrapper board={board} />
        ) : (
          <ReadOnlyBoard board={board} />
        )}
      </div>
    </div>
  );
}

// ─── Lazy full board wrapper ────────────────────────────────────────────────────

const KanbanBoard = lazy(() =>
  import('@/components/board/KanbanBoard').then((m) => ({ default: m.KanbanBoard }))
);

function FullBoardWrapper({ board }: { board: SharedBoard }) {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-64">
          <div className="h-8 w-8 rounded-full border-2 border-[#78fcd6] border-t-transparent animate-spin" />
        </div>
      }
    >
      <KanbanBoard board={board} />
    </Suspense>
  );
}

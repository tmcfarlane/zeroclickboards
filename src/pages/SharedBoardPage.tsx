import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { useBoardStore } from '@/store/useBoardStore';
import { ReadOnlyBoard } from '@/components/board/ReadOnlyBoard';
import { SignInModal } from '@/components/auth/SignInModal';
import type { Board, Column } from '@/types';

// ─── Extended board type with sharing fields ────────────────────────────────────

interface SharedBoard extends Board {
  isPublic: boolean;
  embedEnabled: boolean;
}

// ─── Helper ─────────────────────────────────────────────────────────────────────

function rowToBoard(row: Record<string, unknown>): SharedBoard {
  const data = row.data as Record<string, unknown> | null;
  const columns: Column[] = data && Array.isArray(data.columns)
    ? (data.columns as Column[])
    : [];
  const background = data && typeof data.background === 'string' ? data.background : undefined;
  const hiddenColumnIds = data && Array.isArray(data.hiddenColumnIds)
    ? (data.hiddenColumnIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? undefined,
    columns,
    background,
    hiddenColumnIds,
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
  const navigate = useNavigate();

  const [board, setBoard] = useState<SharedBoard | null>(null);
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [loading, setLoading] = useState(true);
  const [noAccess, setNoAccess] = useState(false);
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const [inviteBoardName, setInviteBoardName] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { setCurrentUserId, refreshFromRemote, setActiveBoard } = useBoardStore();

  // Initialize the store for editors so KanbanBoard mutations work
  useEffect(() => {
    if (!isLoaded) return;
    setCurrentUserId(userId);
  }, [isLoaded, userId, setCurrentUserId]);

  // Fetch board name from invites for the sign-in screen (no auth needed)
  useEffect(() => {
    if (!boardId || !isLoaded || userId) return;
    supabase
      .from('board_invites')
      .select('board_name')
      .eq('board_id', boardId)
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data?.board_name) setInviteBoardName(data.board_name);
      });
  }, [boardId, isLoaded, userId]);

  useEffect(() => {
    if (!boardId || !isLoaded || !userId) return;

    const requestedBoardId = boardId;
    const requestedUserId = userId;
    let cancelled = false;

    async function fetchBoard() {
      setLoading(true);
      setNoAccess(false);
      setLoadError(null);
      setBoard(null);
      setAccessLevel(null);

      // Resolve any pending invites for the current user
      const { error: inviteError } = await supabase.rpc('resolve_pending_invites_for_current_user');
      if (cancelled) return;
      if (inviteError) throw inviteError;

      const { data: row, error } = await supabase
        .from('boards')
        .select('*')
        .eq('id', requestedBoardId)
        .single();

      if (cancelled) return;

      if (error || !row) {
        setNoAccess(true);
        setLoading(false);
        return;
      }

      const fetchedBoard = rowToBoard(row as Record<string, unknown>);
      let fetchedAccessLevel: AccessLevel | null = null;

      // Determine access level
      if (fetchedBoard.userId === requestedUserId) {
        fetchedAccessLevel = 'owner';
      } else {
        // Check board_members table
        const { data: memberRow } = await supabase
          .from('board_members')
          .select('role')
          .eq('board_id', requestedBoardId)
          .eq('user_id', requestedUserId)
          .single();

        if (cancelled) return;

        if (memberRow) {
          const role = memberRow.role;
          fetchedAccessLevel = role === 'editor' || role === 'commenter' ? role : 'viewer';
        }
      }

      // No membership found — check if board is public
      if (!fetchedAccessLevel && fetchedBoard.isPublic) fetchedAccessLevel = 'public';
      if (!fetchedAccessLevel) {
        setNoAccess(true);
        setLoading(false);
        return;
      }

      setBoard(fetchedBoard);
      setAccessLevel(fetchedAccessLevel);

      if (fetchedAccessLevel === 'owner' || fetchedAccessLevel === 'editor') {
        // The initial store load can finish before an invite becomes membership.
        // Reload after access is resolved and verify this board before redirecting.
        await refreshFromRemote();
        if (cancelled) return;
        const currentStore = useBoardStore.getState();
        if (currentStore.currentUserId !== requestedUserId) return;
        if (currentStore.remoteStatus !== 'ready' || !currentStore.getBoardsForUser().some((candidate) => candidate.id === requestedBoardId)) {
          setLoadError('This board could not be opened for editing. Please try again.');
          setLoading(false);
          return;
        }
        setActiveBoard(requestedBoardId);
        navigate(`/app?board=${encodeURIComponent(requestedBoardId)}`, { replace: true });
        return;
      }

      setLoading(false);
    }

    void fetchBoard().catch(() => {
      if (cancelled) return;
      setLoadError('This board could not be loaded. Please try again.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [boardId, userId, isLoaded, loadAttempt, refreshFromRemote, setActiveBoard, navigate]);

  const canEdit = accessLevel === 'owner' || accessLevel === 'editor';

  // ── Render ──

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#78fcd6] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Not logged in — show sign-in screen before anything else
  if (!userId) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex flex-col items-center justify-center gap-6 px-6 text-center">
        <img src="/logo/logo_color.svg" alt="ZeroBoard" className="w-16 h-16" />
        <div className="space-y-2">
          <p className="text-2xl font-bold text-[#F2F7F7]">
            {inviteBoardName
              ? `You've been invited to "${inviteBoardName}"`
              : "You've been invited to a board"}
          </p>
          <p className="text-[#A8B2B2]">
            Sign in or create an account to start collaborating.
          </p>
        </div>
        <button
          onClick={() => setIsSignInModalOpen(true)}
          className="inline-flex items-center justify-center h-12 px-10 gradient-cyan text-[#0B0F0F] font-bold rounded-xl hover:opacity-90 transition-opacity text-base"
        >
          Sign In / Sign Up
        </button>
        <Link
          to="/"
          className="text-sm text-[#A8B2B2] hover:text-[#78fcd6] transition-colors"
        >
          Go Home
        </Link>
        <SignInModal isOpen={isSignInModalOpen} onOpenChange={setIsSignInModalOpen} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#78fcd6] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-[#F2F7F7]">{loadError}</p>
        <button
          type="button"
          onClick={() => setLoadAttempt((attempt) => attempt + 1)}
          className="inline-flex items-center justify-center h-11 px-8 gradient-cyan text-[#0B0F0F] font-bold rounded-xl hover:opacity-90 transition-opacity"
        >
          Try again
        </button>
        <Link to="/" className="text-sm text-[#A8B2B2] hover:text-[#78fcd6] transition-colors">Go Home</Link>
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

  // While waiting for redirect, show spinner
  if (canEdit) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#78fcd6] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Read-only viewers get a minimal board view
  return (
    <div className="min-h-screen bg-[#0B0F0F] flex flex-col">
      <header className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-[#111515]">
        <Link to="/" className="flex items-center gap-2 text-[#F2F7F7] hover:text-[#78fcd6] transition-colors">
          <img src="/logo/logo_color.svg" alt="ZeroBoard" className="w-7 h-7" />
          <span className="text-sm font-semibold">ZeroBoard</span>
        </Link>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[#F2F7F7] font-medium truncate max-w-xs">{board.name}</span>
          <AccessBadge level={accessLevel} />
        </div>
      </header>
      <div className="flex-1">
        <ReadOnlyBoard board={board} />
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ReadOnlyBoard } from '@/components/board/ReadOnlyBoard';
import type { Board, Column } from '@/types';

// ─── Extended board type with sharing fields ────────────────────────────────────

interface EmbedBoard extends Board {
  isPublic: boolean;
  embedEnabled: boolean;
}

// ─── Helper ─────────────────────────────────────────────────────────────────────

function rowToBoard(row: Record<string, unknown>): EmbedBoard {
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

// ─── Component ──────────────────────────────────────────────────────────────────

export function EmbedBoardPage() {
  const { boardId } = useParams<{ boardId: string }>();

  const [board, setBoard] = useState<EmbedBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notAvailable, setNotAvailable] = useState(false);

  useEffect(() => {
    if (!boardId) return;

    let cancelled = false;
    let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

    async function fetchBoard() {
      setLoading(true);
      setNotAvailable(false);

      const { data: row, error } = await supabase
        .from('boards')
        .select('*')
        .eq('id', boardId!)
        .single();

      if (cancelled) return;

      if (error || !row) {
        setNotAvailable(true);
        setLoading(false);
        return;
      }

      const fetched = rowToBoard(row as Record<string, unknown>);

      if (!fetched.embedEnabled) {
        setNotAvailable(true);
        setLoading(false);
        return;
      }

      setBoard(fetched);
      setLoading(false);

      // Subscribe to realtime updates
      realtimeChannel = supabase
        .channel(`embed-board-${boardId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'boards', filter: `id=eq.${boardId}` },
          (payload) => {
            if (cancelled) return;
            if (payload.new && typeof payload.new === 'object') {
              setBoard(rowToBoard(payload.new as Record<string, unknown>));
            }
          }
        )
        .subscribe();
    }

    void fetchBoard();

    return () => {
      cancelled = true;
      if (realtimeChannel) {
        void supabase.removeChannel(realtimeChannel);
      }
    };
  }, [boardId]);

  // ── Render ──

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-[#78fcd6] border-t-transparent animate-spin" />
      </div>
    );
  }

  if (notAvailable || !board) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center px-6">
        <p className="text-[#A8B2B2] text-center">
          This board is not available for embedding.
        </p>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[#0B0F0F] flex flex-col">
      <div className="flex-1 min-h-0 flex flex-col">
        <ReadOnlyBoard board={board} />
      </div>

      {/* Watermark */}
      <a
        href={window.location.origin}
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5 rounded-lg bg-[#111515]/80 backdrop-blur-sm border border-white/10 px-3 py-1.5 text-xs text-[#A8B2B2] hover:text-[#78fcd6] transition-colors"
      >
        <span className="gradient-cyan font-black text-sm leading-none">Z</span>
        Powered by ZeroBoard
      </a>
    </div>
  );
}

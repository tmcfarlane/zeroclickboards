import { useMemo } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { ArchiveRestore, Trash2, Archive } from 'lucide-react';
import { useActivityLogger } from '@/hooks/useActivityLogger';

interface ArchiveViewProps {
  boardId: string;
}

export function ArchiveView({ boardId }: ArchiveViewProps) {
  const { boards, restoreCard, removeCard } = useBoardStore();
  const { logActivity } = useActivityLogger();

  const archived = useMemo(() => {
    const board = boards.find((b) => b.id === boardId);
    if (!board) return [];
    return board.columns.flatMap((col) =>
      col.cards
        .filter((c) => !!c.isArchived)
        .map((c) => ({ card: c, columnId: col.id, columnTitle: col.title }))
    );
  }, [boards, boardId]);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 px-3 bg-white/5 hover:bg-white/10 text-[#F2F7F7] border border-white/10 rounded-lg"
        >
          <Archive className="w-4 h-4 mr-2" />
          Archive
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-sm">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Archived cards</DialogTitle>
          {archived.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const snapshot = archived.map(({ card, columnId }) => ({ card: structuredClone(card), columnId }));
                // Suppress individual undo actions
                useUndoStore.setState({ _skipRecord: true });
                snapshot.forEach(({ card, columnId }) => removeCard(boardId, columnId, card.id));
                useUndoStore.setState({ _skipRecord: false });
                // Push single compound undo
                useUndoStore.getState().pushAction({
                  description: `Delete ${snapshot.length} archived cards`,
                  undo: () => {
                    snapshot.forEach(({ card, columnId }) => {
                      useBoardStore.setState((state) => ({
                        boards: state.boards.map((b) =>
                          b.id === boardId
                            ? {
                                ...b,
                                columns: b.columns.map((c) =>
                                  c.id === columnId ? { ...c, cards: [...c.cards, card] } : c
                                ),
                                updatedAt: new Date().toISOString(),
                              }
                            : b
                        ),
                      }));
                    });
                  },
                  redo: () => {
                    snapshot.forEach(({ card, columnId }) => {
                      useBoardStore.getState().removeCard(boardId, columnId, card.id);
                    });
                  },
                });
              }}
              className="text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 px-2 mr-4"
            >
              Delete All
            </Button>
          )}
        </DialogHeader>
        <div className="overflow-hidden">
          <div className="space-y-2">
            {archived.length === 0 ? (
              <div className="text-sm text-[#A8B2B2] py-8 text-center">No archived cards yet.</div>
            ) : (
              archived.map(({ card, columnId, columnTitle }) => (
                <div
                  key={card.id}
                  className="group flex items-center gap-3 bg-white/5 border border-white/10 rounded-lg px-3 py-2 min-w-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{card.title} <span className="text-xs text-[#A8B2B2] font-normal">— {columnTitle}</span></div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            logActivity(card.id, 'restored', {});
                            restoreCard(boardId, columnId, card.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity border-white/10 text-[#F2F7F7] hover:bg-white/5 p-2"
                        >
                          <ArchiveRestore className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Restore</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          onClick={() => removeCard(boardId, columnId, card.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 p-2"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">Delete</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

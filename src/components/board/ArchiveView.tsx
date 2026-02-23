import { useMemo } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ArchiveRestore, Trash2, Archive } from 'lucide-react';

interface ArchiveViewProps {
  boardId: string;
}

export function ArchiveView({ boardId }: ArchiveViewProps) {
  const { boards, restoreCard, removeCard } = useBoardStore();

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
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] max-w-2xl">
        <DialogHeader>
          <DialogTitle>Archived cards</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] pr-2">
          <div className="space-y-2">
            {archived.length === 0 ? (
              <div className="text-sm text-[#A8B2B2] py-8 text-center">No archived cards yet.</div>
            ) : (
              archived.map(({ card, columnId, columnTitle }) => (
                <div
                  key={card.id}
                  className="flex items-start justify-between gap-3 bg-white/5 border border-white/10 rounded-lg p-3"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{card.title}</div>
                    <div className="text-xs text-[#A8B2B2]">From {columnTitle}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => restoreCard(boardId, columnId, card.id)}
                      className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
                    >
                      <ArchiveRestore className="w-4 h-4 mr-2" />
                      Restore
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => removeCard(boardId, columnId, card.id)}
                      className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

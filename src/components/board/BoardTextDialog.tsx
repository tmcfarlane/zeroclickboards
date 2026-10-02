import { useId, useState } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import type { BoardTextDialogRequest } from '@/hooks/useBoardDialogs';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Hosted by AppShell so changing the board presentation cannot discard text. */
export function BoardTextDialog({ request, onClose }: { request: BoardTextDialogRequest; onClose: () => void }) {
  const [title, setTitle] = useState(request.initialTitle);
  const inputId = useId();
  const board = useBoardStore((state) => state.boards.find((candidate) => candidate.id === request.boardId));
  const canEdit = useBoardStore((state) => state.canEditBoard(request.boardId));
  const column = request.kind === 'rename-column' ? board?.columns.find((candidate) => candidate.id === request.columnId) : undefined;
  const blockedMessage = !board
    ? 'This board is no longer available. Your text is kept here; copy anything you need before closing it.'
    : request.kind === 'rename-column' && !column
      ? 'This column is no longer available. Your text is kept here; copy anything you need before closing it.'
      : !canEdit ? 'You no longer have editing access. Your text is kept here; copy anything you need before closing it.' : null;
  const isBoard = request.kind === 'rename-board';
  const isAdd = request.kind === 'add-column';

  const handleSave = () => {
    const store = useBoardStore.getState();
    const currentBoard = store.boards.find((candidate) => candidate.id === request.boardId);
    if (!title.trim() || !currentBoard || !store.canEditBoard(request.boardId)) return;
    if (request.kind === 'rename-column') {
      const currentColumn = currentBoard.columns.find((candidate) => candidate.id === request.columnId);
      if (!currentColumn) return;
      if (title.trim() !== currentColumn.title) store.renameColumn(request.boardId, request.columnId, title.trim());
    } else if (request.kind === 'rename-board') store.renameBoard(request.boardId, title.trim());
    else store.addColumn(request.boardId, title.trim());
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
        <DialogHeader><DialogTitle>{isBoard ? 'Rename Board' : isAdd ? 'Add Column' : 'Rename Column'}</DialogTitle></DialogHeader>
        <div className="py-4">
          {blockedMessage && <p role="alert" className="mb-3 text-sm text-amber-100">{blockedMessage}</p>}
          <Label htmlFor={inputId} className="mb-2 block">{isBoard ? 'Board Name' : isAdd ? 'Column Title' : 'Column Name'}</Label>
          <Input
            id={inputId}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            readOnly={!!blockedMessage}
            maxLength={isAdd ? 100 : undefined}
            placeholder={isAdd ? 'e.g., In Review' : undefined}
            onKeyDown={(event) => { if (event.key === 'Enter') handleSave(); }}
            className="bg-white/5 border-white/10 text-[#F2F7F7]"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} className="border-white/10 text-[#F2F7F7] hover:bg-white/5">Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim() || !!blockedMessage} className="gradient-cyan text-[#0B0F0F] hover:opacity-90">{isAdd ? 'Add Column' : 'Rename'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

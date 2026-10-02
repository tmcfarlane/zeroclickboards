import { useState } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Edit2, Trash2, Check, Plus, MoreHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface BoardSelectorProps {
  onCreateBoardClick: () => void;
}

export function BoardSelector({ onCreateBoardClick }: BoardSelectorProps) {
  const { boards, activeBoardId, setActiveBoard, renameBoard, deleteBoard, canEditBoard, canManageBoard } = useBoardStore();
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  const handleRename = () => {
    if (editingBoard && newName.trim() && useBoardStore.getState().canEditBoard(editingBoard.id)) {
      renameBoard(editingBoard.id, newName.trim());
      setIsRenameDialogOpen(false);
      setEditingBoard(null);
      setNewName('');
    }
  };

  const handleDelete = () => {
    if (editingBoard && useBoardStore.getState().canManageBoard(editingBoard.id)) {
      deleteBoard(editingBoard.id);
      setIsDeleteDialogOpen(false);
      setEditingBoard(null);
    }
  };

  const openRenameDialog = (board: { id: string; name: string }) => {
    setEditingBoard(board);
    setNewName(board.name);
    setIsRenameDialogOpen(true);
  };

  const openDeleteDialog = (board: { id: string; name: string }) => {
    setEditingBoard(board);
    setIsDeleteDialogOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 text-[#F2F7F7] hover:bg-white/5 h-10 px-2 -ml-2 max-w-full min-w-0"
          >
            <span className="text-lg font-semibold truncate">
              {activeBoard?.name || 'Select Board'}
            </span>
            <ChevronDown className="w-5 h-5 text-[#A8B2B2] shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64 bg-[#111515] border-white/10 text-[#F2F7F7]"
        >
          <DropdownMenuItem
            onClick={onCreateBoardClick}
            className="flex items-center gap-2 py-2 px-2 hover:bg-white/5 cursor-pointer focus:bg-white/5 text-[#78fcd6]"
          >
            <Plus className="w-4 h-4" />
            <span className="font-medium">New Board</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-white/10" />
          {boards.map((board) => (
            <div key={board.id} className="flex items-center group">
              <DropdownMenuItem
                onSelect={() => setActiveBoard(board.id)}
                aria-current={activeBoardId === board.id ? 'true' : undefined}
                className="flex-1 min-w-0 py-2 px-2 hover:bg-white/5 cursor-pointer focus:bg-white/5"
              >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {activeBoardId === board.id ? (
                  <Check className="w-4 h-4 text-[#78fcd6] shrink-0" />
                ) : (
                  <span className="w-4 h-4 shrink-0" />
                )}
                <span className="truncate">{board.name}</span>
              </div>
              </DropdownMenuItem>
              {canEditBoard(board.id) && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    aria-label={`Actions for ${board.name} board`}
                    className="h-10 w-9 justify-center p-2 [&>svg:last-child]:hidden opacity-100 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 text-[#A8B2B2] focus:bg-white/5 focus:text-[#78fcd6]"
                  >
                    <MoreHorizontal className="w-4 h-4" />
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
                    <DropdownMenuItem onSelect={() => openRenameDialog(board)} className="focus:bg-white/5 focus:text-[#78fcd6]">
                      <Edit2 className="w-4 h-4" />Rename
                    </DropdownMenuItem>
                    {canManageBoard(board.id) && (
                      <DropdownMenuItem onSelect={() => openDeleteDialog(board)} className="text-red-400 focus:bg-red-500/10 focus:text-red-400">
                        <Trash2 className="w-4 h-4" />Delete
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Rename Dialog */}
      <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Rename Board</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            {editingBoard && !canEditBoard(editingBoard.id) && <p role="alert" className="mb-3 text-sm text-amber-100">You no longer have editing access. Your name change is kept here.</p>}
            <Label htmlFor="rename" className="mb-2 block">
              Board Name
            </Label>
            <Input
              id="rename"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="bg-white/5 border-white/10 text-[#F2F7F7]"
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRenameDialogOpen(false)}
              className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRename}
              disabled={!newName.trim() || !editingBoard || !canEditBoard(editingBoard.id)}
              className="gradient-cyan text-[#0B0F0F] hover:opacity-90"
            >
              Rename
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Delete Board</DialogTitle>
          </DialogHeader>
          <p className="text-[#A8B2B2] py-4">
            Are you sure you want to delete "{editingBoard?.name}"? This action cannot be undone.
          </p>
          {editingBoard && !canManageBoard(editingBoard.id) && <p role="alert" className="text-sm text-amber-100">Only the board owner can delete this board.</p>}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsDeleteDialogOpen(false)}
              className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={!editingBoard || !canManageBoard(editingBoard.id)}
              variant="destructive"
              className="bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

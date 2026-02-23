import { useState } from 'react';
import { useBoardStore } from '@/store/useBoardStore';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, Edit2, Trash2, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BoardSelector() {
  const { boards, activeBoardId, setActiveBoard, renameBoard, deleteBoard } = useBoardStore();
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<{ id: string; name: string } | null>(null);
  const [newName, setNewName] = useState('');

  const activeBoard = boards.find((b) => b.id === activeBoardId);

  const handleRename = () => {
    if (editingBoard && newName.trim()) {
      renameBoard(editingBoard.id, newName.trim());
      setIsRenameDialogOpen(false);
      setEditingBoard(null);
      setNewName('');
    }
  };

  const handleDelete = () => {
    if (editingBoard) {
      deleteBoard(editingBoard.id);
      setIsDeleteDialogOpen(false);
      setEditingBoard(null);
    }
  };

  const openRenameDialog = (board: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBoard(board);
    setNewName(board.name);
    setIsRenameDialogOpen(true);
  };

  const openDeleteDialog = (board: { id: string; name: string }, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingBoard(board);
    setIsDeleteDialogOpen(true);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex items-center gap-2 text-[#F2F7F7] hover:bg-white/5 h-9 px-3"
          >
            <span className="font-medium">{activeBoard?.name || 'Select Board'}</span>
            <ChevronDown className="w-4 h-4 text-[#A8B2B2]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-64 bg-[#111515] border-white/10 text-[#F2F7F7]"
        >
          {boards.map((board) => (
            <DropdownMenuItem
              key={board.id}
              onClick={() => setActiveBoard(board.id)}
              className="flex items-center justify-between py-2 px-3 hover:bg-white/5 cursor-pointer focus:bg-white/5"
            >
              <span className="truncate flex-1">{board.name}</span>
              <div className="flex items-center gap-1">
                {activeBoardId === board.id && (
                  <Check className="w-4 h-4 text-[#78fcd6]" />
                )}
              </div>
            </DropdownMenuItem>
          ))}
          
          <DropdownMenuSeparator className="bg-white/10" />
          
          {boards.map((board) => (
            <div
              key={`actions-${board.id}`}
              className="flex items-center px-2 py-1 hover:bg-white/5"
            >
              <span className="flex-1 truncate text-sm text-[#A8B2B2] px-1">{board.name}</span>
              <button
                onClick={(e) => openRenameDialog(board, e)}
                className="p-1.5 hover:bg-white/10 rounded-md text-[#A8B2B2] hover:text-[#78fcd6] transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => openDeleteDialog(board, e)}
                className="p-1.5 hover:bg-white/10 rounded-md text-[#A8B2B2] hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
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
              disabled={!newName.trim()}
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

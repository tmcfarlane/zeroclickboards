import { useState } from 'react';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBoardStore } from '@/store/useBoardStore';
import { useBoardDialogs } from '@/hooks/useBoardDialogs';
import type { Column } from '@/types';
import { KanbanCard } from './KanbanCard';
import { Button } from '@/components/ui/button';
import { Plus, MoreHorizontal, Edit2, Trash2, Download, EyeOff, Archive } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface KanbanColumnProps {
  boardId: string;
  column: Column;
  onHide?: () => void;
  isDragOver?: boolean;
  onAddCard: () => void;
}

export function KanbanColumn({ boardId, column, onHide, isDragOver, onAddCard }: KanbanColumnProps) {
  const { removeColumn, archiveAllCards } = useBoardStore();
  const { openTextDialog } = useBoardDialogs();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: {
      type: 'column',
      column,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleDelete = () => {
    removeColumn(boardId, column.id);
    setIsDeleteDialogOpen(false);
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        data-kanban-column
        className="w-72 sm:w-80 flex-shrink-0 flex flex-col max-h-full"
      >
        {/* Column Header */}
        <div
          {...attributes}
          {...listeners}
          className="flex items-center justify-between px-3 py-2 bg-[#111515]/80 backdrop-blur-sm rounded-t-lg border border-white/10 border-b-0 cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{column.title}</span>
            <span className="text-xs text-[#A8B2B2] bg-white/5 px-2 py-0.5 rounded-full">
              {column.cards.filter(c => !c.isArchived).length}
            </span>
          </div>
          
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={`Actions for ${column.title} column`}
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
              >
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-40 bg-[#111515] border-white/10 text-[#F2F7F7]"
            >
              <DropdownMenuItem
                onClick={() => openTextDialog({ kind: 'rename-column', boardId, columnId: column.id })}
                className="hover:bg-white/5 cursor-pointer focus:bg-white/5"
              >
                <Edit2 className="w-4 h-4 mr-2" />
                Rename
              </DropdownMenuItem>
              {onHide && (
                <DropdownMenuItem
                  onClick={onHide}
                  className="hover:bg-white/5 cursor-pointer focus:bg-white/5"
                >
                  <EyeOff className="w-4 h-4 mr-2" />
                  Hide
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  const data = {
                    title: column.title,
                    cards: column.cards.filter(c => !c.isArchived).map(({ id, title, description, content, targetDate, labels, coverImage, createdAt }) => ({
                      id, title, description, content, targetDate, labels, coverImage, createdAt,
                    })),
                    exportedAt: new Date().toISOString(),
                  };
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${column.title.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  toast.success('Column exported as JSON');
                }}
                className="hover:bg-white/5 cursor-pointer focus:bg-white/5"
              >
                <Download className="w-4 h-4 mr-2" />
                Export as JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => archiveAllCards(boardId, column.id)}
                disabled={column.cards.filter(c => !c.isArchived).length === 0}
                className="hover:bg-white/5 cursor-pointer focus:bg-white/5"
              >
                <Archive className="w-4 h-4 mr-2" />
                Archive all cards
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsDeleteDialogOpen(true)}
                className="text-red-400 hover:bg-red-500/10 cursor-pointer focus:bg-red-500/10 focus:text-red-400"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Column Content */}
        <div className={`flex-1 bg-[#111515]/50 backdrop-blur-sm border border-t-0 rounded-b-lg overflow-hidden flex flex-col transition-colors duration-200 ${isDragOver ? 'border-[#78fcd6]/40 bg-[#78fcd6]/5' : 'border-white/10'}`}>
          {/* Cards List */}
          <div data-column-cards className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin min-h-[100px]">
            <SortableContext
              items={column.cards.filter((c) => !c.isArchived).map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              {column.cards.filter((c) => !c.isArchived).map((card) => (
                <KanbanCard
                  key={card.id}
                  boardId={boardId}
                  columnId={column.id}
                  card={card}
                />
              ))}
            </SortableContext>
          </div>

          {/* Add Card Button */}
          <div className="p-2 border-t border-white/5">
            <Button
                  onClick={onAddCard}
              variant="ghost"
              className="w-full h-9 justify-start text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Card
            </Button>
          </div>
        </div>
      </div>

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Delete Column</DialogTitle>
          </DialogHeader>
          <p className="text-[#A8B2B2] py-4">
            Are you sure you want to delete "{column.title}"? All {column.cards.length} cards in this column will be permanently removed.
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

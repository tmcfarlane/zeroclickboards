import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useBoardStore } from '@/store/useBoardStore';
import type { Card } from '@/types';
import { Button } from '@/components/ui/button';
import { Calendar, CheckSquare, Image as ImageIcon, FileText } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { CardEditor, type CardEditorSaveData } from './CardEditor';
import { CardActionsMenu } from './CardActionsMenu';
import { LabelStrip } from './LabelPicker';

interface KanbanCardProps {
  boardId: string;
  columnId: string;
  card: Card;
}

export function KanbanCard({ boardId, columnId, card }: KanbanCardProps) {
  const { boards, removeCard, editCard } = useBoardStore();
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const boardColumns = boards.find((b) => b.id === boardId)?.columns || [];

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.id,
    data: {
      type: 'card',
      card,
      columnId,
    },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleDelete = () => {
    removeCard(boardId, columnId, card.id);
    setIsDeleteDialogOpen(false);
  };

  const handleEdit = (data: CardEditorSaveData) => {
    editCard(boardId, columnId, card.id, {
      title: data.title,
      description: data.description,
      content: data.content,
      targetDate: data.targetDate,
      labels: data.labels,
      coverImage: data.coverImage,
    });
    setIsEditDialogOpen(false);
  };

  const getContentIcon = () => {
    switch (card.content.type) {
      case 'checklist':
        return <CheckSquare className="w-3.5 h-3.5" />;
      case 'image':
        return <ImageIcon className="w-3.5 h-3.5" />;
      default:
        return <FileText className="w-3.5 h-3.5" />;
    }
  };

  const getChecklistProgress = () => {
    if (card.content.type !== 'checklist' || !card.content.checklist) return null;
    const total = card.content.checklist.length;
    const completed = card.content.checklist.filter((item) => item.completed).length;
    return `${completed}/${total}`;
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return null;
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getDateStatus = (dateString?: string): 'overdue' | 'today' | 'soon' | 'later' => {
    if (!dateString) return 'later';
    const date = new Date(dateString);
    const now = new Date();
    const todayStr = now.toDateString();
    if (date.toDateString() === todayStr) return 'today';
    if (date < now) return 'overdue';
    const diffMs = date.getTime() - now.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays <= 2) return 'soon';
    return 'later';
  };

  const dateBadgeClass = (status: 'overdue' | 'today' | 'soon' | 'later') => {
    switch (status) {
      case 'overdue': return 'bg-red-500/20 text-red-400 border border-red-500/30';
      case 'today':
      case 'soon':   return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30';
      default:       return 'bg-white/5 text-[#A8B2B2] border border-white/10';
    }
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        className="group bg-[#1a1f1f] hover:bg-[#222828] border border-white/5 hover:border-[#78fcd6]/30 rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-200"
      >
        {card.coverImage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditDialogOpen(true);
            }}
            className="h-16 sm:h-20 w-full"
          >
            <img src={card.coverImage} alt="Card cover" className="h-full w-full object-cover" />
          </button>
        )}

        <div className="p-3">
          <LabelStrip labels={card.labels || []} />

        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditDialogOpen(true);
            }}
            className="text-left text-sm font-medium text-[#F2F7F7] flex-1 line-clamp-2"
          >
            {card.title}
          </button>

          <CardActionsMenu
            boardId={boardId}
            columnId={columnId}
            cardId={card.id}
            columns={boardColumns}
            onEdit={() => setIsEditDialogOpen(true)}
          />
        </div>

        {/* Description preview */}
        {(() => {
          const desc = card.description?.trim() || (card.content.type === 'text' ? card.content.text?.trim() : undefined);
          if (!desc) return null;
          return (
            <p className="text-xs text-[#A8B2B2] mt-1 leading-relaxed line-clamp-2">
              {desc.slice(0, 60)}{desc.length > 60 ? '…' : ''}
            </p>
          );
        })()}

        {/* Card Meta */}
        <div className="flex items-center gap-3 mt-2">
          {/* Content Type Indicator */}
          <div className="flex items-center gap-1 text-[#A8B2B2]">
            {getContentIcon()}
            {card.content.type === 'checklist' && getChecklistProgress() && (
              <span className="text-xs">{getChecklistProgress()}</span>
            )}
          </div>

          {/* Target Date */}
          {card.targetDate && (() => {
            const status = getDateStatus(card.targetDate);
            return (
              <div className={`flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${dateBadgeClass(status)}`}>
                <Calendar className="w-3 h-3" />
                <span>{formatDate(card.targetDate)}</span>
              </div>
            );
          })()}
        </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <CardEditor
        isOpen={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
        onSave={handleEdit}
        mode="edit"
        initialData={card}
      />

      {/* Delete Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Delete Card</DialogTitle>
          </DialogHeader>
          <p className="text-[#A8B2B2] py-4">
            Are you sure you want to delete "{card.title}"? This action cannot be undone.
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

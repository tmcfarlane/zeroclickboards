import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { differenceInCalendarDays } from 'date-fns';
import { useBoardStore } from '@/store/useBoardStore';
import type { Card } from '@/types';
import { Calendar, CheckSquare, Image as ImageIcon, FileText, Repeat } from 'lucide-react';
import { formatRecurrence } from '@/lib/recurrence';
import { parseLocalDate } from '@/lib/utils';
import { CardActionsMenu } from './CardActionsMenu';
import { LabelStrip } from './LabelPicker';

interface KanbanCardProps {
  boardId: string;
  columnId: string;
  card: Card;
}

export function KanbanCard({ boardId, columnId, card }: KanbanCardProps) {
  const boards = useBoardStore((state) => state.boards);
  const openCardEditor = useBoardStore((state) => state.openCardEditor);

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
    const date = parseLocalDate(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getDateStatus = (dateString?: string): 'invalid' | 'overdue' | 'today' | 'soon' | 'later' => {
    if (!dateString) return 'later';
    const date = parseLocalDate(dateString);
    if (!Number.isFinite(date.getTime())) return 'invalid';
    const diffDays = differenceInCalendarDays(date, new Date());
    if (diffDays === 0) return 'today';
    if (diffDays < 0) return 'overdue';
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
        style={{ ...style, touchAction: 'none' }}
        data-kanban-card
        {...attributes}
        {...listeners}
        className={`group rounded-lg overflow-hidden cursor-grab active:cursor-grabbing transition-all duration-200 ${
          isDragging
            ? 'opacity-30 border-2 border-dashed border-[#78fcd6]/30 bg-[#78fcd6]/5'
            : 'bg-[#1a1f1f] hover:bg-[#222828] border border-white/5 hover:border-[#78fcd6]/30'
        }`}
      >
        {card.coverImage && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openCardEditor(boardId, card.id);
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
              openCardEditor(boardId, card.id);
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
            onEdit={() => openCardEditor(boardId, card.id)}
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
            if (status === 'invalid') {
              return (
                <button
                  type="button"
                  title="Open this card to correct or remove its due date"
                  onClick={(event) => { event.stopPropagation(); openCardEditor(boardId, card.id); }}
                  className="flex items-center gap-1 text-xs rounded-full px-2 py-0.5 bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30"
                >
                  <Calendar className="w-3 h-3" />
                  Invalid due date
                </button>
              );
            }
            return (
              <div className={`flex items-center gap-1 text-xs rounded-full px-2 py-0.5 ${dateBadgeClass(status)}`}>
                <Calendar className="w-3 h-3 text-[#A8B2B2]" />
                <span>{formatDate(card.targetDate)}</span>
              </div>
            );
          })()}

          {/* Recurrence Badge */}
          {card.recurrence && (
            <div className="flex items-center gap-1 text-xs text-[#78fcd6] bg-[#78fcd6]/10 border border-[#78fcd6]/20 rounded-full px-2 py-0.5">
              <Repeat className="w-3 h-3" />
              <span>{formatRecurrence(card.recurrence)}</span>
            </div>
          )}
        </div>
        </div>
      </div>

    </>
  );
}

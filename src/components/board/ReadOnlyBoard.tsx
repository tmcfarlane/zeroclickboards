import { useEffect, useRef } from 'react';
import type { Board, Card, CardLabel } from '@/types';

interface ReadOnlyBoardProps {
  board: Board;
}

const LABEL_COLORS: Record<CardLabel, string> = {
  red: 'bg-red-500',
  yellow: 'bg-yellow-400',
  green: 'bg-green-500',
  blue: 'bg-blue-500',
  purple: 'bg-purple-500',
  gray: 'bg-gray-400',
};

function ReadOnlyCard({ card }: { card: Card }) {
  if (card.isArchived) return null;

  return (
    <div className="bg-[#1a1f1f] border border-white/5 rounded-lg p-3 space-y-2">
      {/* Cover Image */}
      {card.coverImage && (
        <div className="w-full h-24 rounded-md overflow-hidden -mt-1 mb-2">
          <img src={card.coverImage} alt="" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Labels */}
      {card.labels && card.labels.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <span
              key={label}
              className={`w-8 h-1.5 rounded-full ${LABEL_COLORS[label as CardLabel] || 'bg-gray-400'}`}
            />
          ))}
        </div>
      )}

      {/* Title */}
      <p className="text-sm font-medium text-[#F2F7F7] line-clamp-2">{card.title}</p>

      {/* Description */}
      {card.content?.text && (
        <p className="text-xs text-[#A8B2B2] line-clamp-2">{card.content.text}</p>
      )}

      {/* Target Date */}
      {card.targetDate && (
        <div className="text-xs text-[#A8B2B2]">
          Due: {new Date(card.targetDate).toLocaleDateString()}
        </div>
      )}

      {/* Checklist Progress */}
      {card.content?.type === 'checklist' && card.content.checklist && (
        <div className="text-xs text-[#A8B2B2]">
          {card.content.checklist.filter(i => i.completed).length}/{card.content.checklist.length} completed
        </div>
      )}
    </div>
  );
}

export function ReadOnlyBoard({ board }: ReadOnlyBoardProps) {
  const hiddenColumnIds = board.hiddenColumnIds ?? [];
  const visibleColumns = board.columns.filter((col) => !hiddenColumnIds.includes(col.id));

  const scrollRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, scrollLeft: 0 });

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    function onPointerDown(e: PointerEvent) {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, scrollLeft: container!.scrollLeft };
      container!.style.cursor = 'grabbing';
      container!.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDragging.current) return;
      container!.scrollLeft = dragStart.current.scrollLeft - (e.clientX - dragStart.current.x);
    }
    function onPointerUp(e: PointerEvent) {
      if (!isDragging.current) return;
      isDragging.current = false;
      container!.style.cursor = '';
      container!.releasePointerCapture(e.pointerId);
    }

    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    return () => {
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  return (
    <div
      className="h-full min-h-full flex flex-col"
      style={board.background ? { background: board.background } : undefined}
    >
      {/* Board columns */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden scrollbar-hover cursor-grab select-none"
      >
        <div className="h-full flex items-stretch gap-4 p-4 min-w-max">
          {visibleColumns.map((column) => {
            const activeCards = column.cards.filter(c => !c.isArchived);
            return (
              <div
                key={column.id}
                className="w-72 sm:w-80 flex-shrink-0 bg-[#111515] rounded-xl border border-white/5 flex flex-col min-h-0"
              >
                {/* Column Header */}
                <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#F2F7F7] truncate">{column.title}</h3>
                  <span className="text-xs text-[#A8B2B2] ml-2">{activeCards.length}</span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-hidden p-2 space-y-2">
                  {activeCards.map((card) => (
                    <ReadOnlyCard key={card.id} card={card} />
                  ))}
                  {activeCards.length === 0 && (
                    <div className="text-center py-4 text-xs text-[#A8B2B2]">
                      No cards
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

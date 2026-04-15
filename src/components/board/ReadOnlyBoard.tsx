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

  return (
    <div
      className="h-full min-h-full flex flex-col"
      style={board.background ? { background: board.background } : undefined}
    >
      {/* Board columns */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="h-full flex items-start gap-4 p-4 min-w-max">
          {visibleColumns.map((column) => {
            const activeCards = column.cards.filter(c => !c.isArchived);
            return (
              <div
                key={column.id}
                className="w-72 sm:w-80 flex-shrink-0 bg-[#111515] rounded-xl border border-white/5 flex flex-col max-h-[calc(100vh-8rem)]"
              >
                {/* Column Header */}
                <div className="px-3 py-2 border-b border-white/5 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#F2F7F7] truncate">{column.title}</h3>
                  <span className="text-xs text-[#A8B2B2] ml-2">{activeCards.length}</span>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-thin">
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

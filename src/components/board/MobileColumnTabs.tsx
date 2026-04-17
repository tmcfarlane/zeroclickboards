import { useEffect, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { Column } from '@/types';

interface MobileColumnTabsProps {
  columns: Column[];
  activeIndex: number;
  onTabChange: (index: number) => void;
}

function DroppableTab({ col, index, isActive, onTabChange }: {
  col: Column;
  index: number;
  isActive: boolean;
  onTabChange: (index: number) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column-tab-${col.id}`,
    data: { type: 'column-tab', columnId: col.id, columnIndex: index },
  });

  const cardCount = col.cards.filter(c => !c.isArchived).length;

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={() => onTabChange(index)}
      className={`flex-shrink-0 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
        isOver
          ? 'text-[#78fcd6] border-[#78fcd6] bg-[#78fcd6]/10'
          : isActive
            ? 'text-[#78fcd6] border-[#78fcd6]'
            : 'text-[#A8B2B2] border-transparent hover:text-[#F2F7F7]'
      }`}
    >
      {col.title}
      <span className={`ml-1.5 text-xs ${isActive || isOver ? 'text-[#78fcd6]/70' : 'text-[#A8B2B2]/50'}`}>
        {cardCount}
      </span>
    </button>
  );
}

export function MobileColumnTabs({ columns, activeIndex, onTabChange }: MobileColumnTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const prevActiveIndex = useRef(activeIndex);

  useEffect(() => {
    if (prevActiveIndex.current !== activeIndex) {
      const activeTab = tabsRef.current?.children[activeIndex] as HTMLElement | undefined;
      activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      prevActiveIndex.current = activeIndex;
    }
  }, [activeIndex]);

  return (
    <div
      ref={tabsRef}
      className="flex items-stretch gap-0 overflow-x-auto scrollbar-none bg-[#111515]/80 backdrop-blur-sm border-b border-white/10 sm:hidden"
    >
      {columns.map((col, i) => (
        <DroppableTab
          key={col.id}
          col={col}
          index={i}
          isActive={i === activeIndex}
          onTabChange={onTabChange}
        />
      ))}
    </div>
  );
}

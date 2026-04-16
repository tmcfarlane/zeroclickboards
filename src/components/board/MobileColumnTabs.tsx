import { useEffect, useRef } from 'react';
import type { Column } from '@/types';

interface MobileColumnTabsProps {
  columns: Column[];
  activeIndex: number;
  onTabChange: (index: number) => void;
}

export function MobileColumnTabs({ columns, activeIndex, onTabChange }: MobileColumnTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeIndex]);

  return (
    <div
      ref={tabsRef}
      className="flex items-stretch gap-0 overflow-x-auto scrollbar-none bg-[#111515]/80 backdrop-blur-sm border-b border-white/10 sm:hidden"
    >
      {columns.map((col, i) => {
        const isActive = i === activeIndex;
        const cardCount = col.cards.filter(c => !c.isArchived).length;
        return (
          <button
            key={col.id}
            ref={isActive ? activeTabRef : undefined}
            type="button"
            onClick={() => onTabChange(i)}
            className={`flex-shrink-0 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              isActive
                ? 'text-[#78fcd6] border-[#78fcd6]'
                : 'text-[#A8B2B2] border-transparent hover:text-[#F2F7F7]'
            }`}
          >
            {col.title}
            <span className={`ml-1.5 text-xs ${isActive ? 'text-[#78fcd6]/70' : 'text-[#A8B2B2]/50'}`}>
              {cardCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}

import { useState, useEffect, useRef, useCallback } from 'react';
import { DndContext, DragOverlay, type DragEndEvent, type DragOverEvent, type DragStartEvent, PointerSensor, TouchSensor, useSensor, useSensors, closestCorners, type CollisionDetection } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import type { Board, CardLabel } from '@/types';
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';
import { ArchiveView } from './ArchiveView';
import { ViewToggle } from './ViewToggle';
import { BoardSelector } from './BoardSelector';
import { Button } from '@/components/ui/button';
import { Plus, Search, Tag, Calendar, Eye, BookmarkPlus, Share2, SlidersHorizontal, MoreHorizontal, Archive, Download, Palette, Sparkles, X } from 'lucide-react';
import { ShareBoardDialog } from './ShareBoardDialog';
import { boardToTemplate, saveUserBoardTemplate } from '@/lib/templates';
import { downloadBoardJSON } from '@/lib/board-io';
import { BackgroundPicker } from './BackgroundPicker';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useIsCompact } from '@/hooks/use-is-compact';
import { MobileColumnTabs } from './MobileColumnTabs';
import { MobileBottomBar } from './MobileBottomBar';
import { MobileSearchOverlay } from './MobileSearchOverlay';
import { CardEditor, type CardEditorSaveData } from './CardEditor';

interface KanbanBoardProps {
  board: Board;
  onAIClick?: () => void;
  onNewBoardClick: () => void;
}

export function KanbanBoard({ board, onAIClick, onNewBoardClick }: KanbanBoardProps) {
  const { addColumn, addCard, moveCard, reorderColumns, reorderCards, setBoardBackground, setBoardHiddenColumns } = useBoardStore();
  const [isAddColumnDialogOpen, setIsAddColumnDialogOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDragData, setActiveDragData] = useState<{ cardId: string; sourceColumnId: string } | null>(null);
  const [activeDragType, setActiveDragType] = useState<'card' | 'column' | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const dragOriginRef = useRef<{ columnId: string; index: number } | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<CardLabel[]>([]);
  const [dueDateFilter, setDueDateFilter] = useState<string | null>(null);
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [isArchiveOpen, setIsArchiveOpen] = useState(false);
  const [isBackgroundPickerOpen, setIsBackgroundPickerOpen] = useState(false);
  const hiddenColumnIds = board.hiddenColumnIds ?? [];
  const isCompact = useIsCompact();
  const [activeColumnIndex, setActiveColumnIndex] = useState(0);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isMobileAddCardOpen, setIsMobileAddCardOpen] = useState(false);

  const hideColumn = (columnId: string) => {
    if (hiddenColumnIds.includes(columnId)) return;
    setBoardHiddenColumns(board.id, [...hiddenColumnIds, columnId]);
  };

  const showColumn = (columnId: string) => {
    setBoardHiddenColumns(board.id, hiddenColumnIds.filter(id => id !== columnId));
  };

  const activeCard = (() => {
    if (!activeDragData) return null;
    for (const col of board.columns) {
      const c = col.cards.find(card => card.id === activeDragData.cardId);
      if (c) return c;
    }
    return null;
  })();

  // Vertical wheel → horizontal board scroll everywhere on the board.
  // Only exception: if mouse is inside a column card list that has room to scroll vertically.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const mobileCardListRef = useRef<HTMLDivElement>(null);
  const isDraggingBoard = useRef(false);
  const dragStart = useRef({ x: 0, scrollLeft: 0 });

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    // Non-null alias for use inside closures (guarded by early return above)
    const container: HTMLDivElement = el;

    function onWheel(e: WheelEvent) {
      // Check if over a column card list that can still scroll vertically
      const target = e.target as HTMLElement;
      const colScroll = target.closest('[data-column-cards]') as HTMLElement | null;
      if (colScroll && e.deltaY !== 0) {
        const atTop = colScroll.scrollTop <= 0;
        const atBottom = colScroll.scrollTop + colScroll.clientHeight >= colScroll.scrollHeight - 1;
        if (!(e.deltaY < 0 && atTop) && !(e.deltaY > 0 && atBottom)) {
          return; // column can scroll in this direction, let it
        }
      }
      // Convert vertical wheel → horizontal scroll
      if (e.deltaY !== 0) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    }

    // Click-and-drag to scroll horizontally
    function onPointerDown(e: PointerEvent) {
      const target = e.target as HTMLElement;
      // Only drag on the canvas background or column headers, not on cards/inputs/buttons
      if (target.closest('button, input, textarea, [data-kanban-card], a, [role="dialog"]')) return;
      isDraggingBoard.current = true;
      dragStart.current = { x: e.clientX, scrollLeft: container.scrollLeft };
      container.style.cursor = 'grabbing';
      container.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!isDraggingBoard.current) return;
      const dx = e.clientX - dragStart.current.x;
      container.scrollLeft = dragStart.current.scrollLeft - dx;
    }
    function onPointerUp(e: PointerEvent) {
      if (!isDraggingBoard.current) return;
      isDraggingBoard.current = false;
      container.style.cursor = '';
      container.releasePointerCapture(e.pointerId);
    }

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('pointerdown', onPointerDown);
    container.addEventListener('pointermove', onPointerMove);
    container.addEventListener('pointerup', onPointerUp);
    container.addEventListener('pointercancel', onPointerUp);

    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('pointerdown', onPointerDown);
      container.removeEventListener('pointermove', onPointerMove);
      container.removeEventListener('pointerup', onPointerUp);
      container.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  useEffect(() => {
    const el = mobileCardListRef.current;
    if (!el || !isCompact) return;

    let touchStartX = 0;
    let touchStartY = 0;
    let isSwiping = false;

    function onTouchStart(e: TouchEvent) {
      if (activeDragData) return;
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isSwiping = false;
    }

    function onTouchMove(e: TouchEvent) {
      if (activeDragData) return;
      if (isSwiping) return;
      const touch = e.touches[0];
      const dx = Math.abs(touch.clientX - touchStartX);
      const dy = Math.abs(touch.clientY - touchStartY);
      if (dx > 10 || dy > 10) {
        isSwiping = dx > dy;
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (activeDragData || !isSwiping) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - touchStartX;
      if (Math.abs(dx) < 50) return;

      if (dx < 0 && activeColumnIndex < filteredColumns.length - 1) {
        setActiveColumnIndex(activeColumnIndex + 1);
      } else if (dx > 0 && activeColumnIndex > 0) {
        setActiveColumnIndex(activeColumnIndex - 1);
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [isCompact, activeDragData, activeColumnIndex, filteredColumns.length]);

  const ALL_LABELS: CardLabel[] = ['red', 'yellow', 'green', 'blue', 'purple', 'gray'];
  const LABEL_COLORS: Record<CardLabel, string> = {
    red: 'bg-red-500',
    yellow: 'bg-yellow-400',
    green: 'bg-green-500',
    blue: 'bg-blue-500',
    purple: 'bg-purple-500',
    gray: 'bg-gray-400',
  };
  const DUE_DATE_OPTIONS = [
    { value: 'overdue', label: 'Overdue' },
    { value: 'this-week', label: 'Due this week' },
    { value: 'this-month', label: 'Due this month' },
    { value: 'no-date', label: 'No date' },
  ];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    })
  );

  // When dragging a column, only consider other columns as drop targets to prevent
  // oscillation from closestCorners bouncing between cards and columns.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      if (activeDragType === 'column') {
        return closestCorners({
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => container.data.current?.type === 'column'
          ),
        });
      }
      return closestCorners(args);
    },
    [activeDragType]
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeData = active.data.current;

    if (activeData?.type === 'card') {
      const colId = activeData.columnId as string;
      const col = board.columns.find((c) => c.id === colId);
      const idx = col?.cards.findIndex((c) => c.id === active.id) ?? -1;
      dragOriginRef.current = { columnId: colId, index: idx >= 0 ? idx : 0 };
      setActiveDragData({
        cardId: active.id as string,
        sourceColumnId: colId,
      });
    }

    setActiveDragType((activeData?.type as 'card' | 'column') ?? null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type !== 'card') return;

    const sourceColumnId = activeData.columnId as string;

    if (overData?.type === 'card') {
      const targetColumnId = overData.columnId as string;
      setDragOverColumnId(targetColumnId);
      if (sourceColumnId !== targetColumnId) {
        // Cross-column move: place card before the target card
        const targetColumn = board.columns.find((c) => c.id === targetColumnId);
        const targetIndex = targetColumn ? targetColumn.cards.findIndex((c) => c.id === overId) : undefined;
        moveCard(board.id, sourceColumnId, targetColumnId, activeId as string, targetIndex === -1 ? undefined : targetIndex);
      }
    } else if (overData?.type === 'column') {
      const targetColumnId = overId as string;
      setDragOverColumnId(targetColumnId);
      if (sourceColumnId !== targetColumnId) {
        // Card dragged onto an empty column — append to end
        moveCard(board.id, sourceColumnId, targetColumnId, activeId as string);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;

    setActiveDragData(null);
    setActiveDragType(null);
    setDragOverColumnId(null);

    if (!over) return;

    // Record undo for cross-column card moves using the origin captured at drag start
    if (origin && active.data.current?.type === 'card') {
      const cardId = active.id as string;
      // Find which column the card ended up in
      let finalColumnId: string | null = null;
      let finalIndex = 0;
      for (const col of board.columns) {
        const idx = col.cards.findIndex((c) => c.id === cardId);
        if (idx >= 0) {
          finalColumnId = col.id;
          finalIndex = idx;
          break;
        }
      }
      if (finalColumnId && finalColumnId !== origin.columnId) {
        const origColId = origin.columnId;
        const origIdx = origin.index;
        const destColId = finalColumnId;
        const destIdx = finalIndex;
        const bId = board.id;
        useUndoStore.getState().pushAction({
          description: 'Move card',
          undo: () => {
            useBoardStore.getState().moveCard(bId, destColId, origColId, cardId, origIdx);
          },
          redo: () => {
            useBoardStore.getState().moveCard(bId, origColId, destColId, cardId, destIdx);
          },
        });
      }
    }

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type === 'column') {
      // Determine target column — over element may be a column or a card inside one
      const targetColumnId =
        overData?.type === 'column'
          ? (overId as string)
          : overData?.type === 'card'
            ? (overData.columnId as string)
            : null;

      if (targetColumnId && targetColumnId !== activeId) {
        const oldIndex = board.columns.findIndex((c) => c.id === activeId);
        const newIndex = board.columns.findIndex((c) => c.id === targetColumnId);
        if (oldIndex !== -1 && newIndex !== -1) {
          const newColumnIds = arrayMove(
            board.columns.map((c) => c.id),
            oldIndex,
            newIndex
          );
          reorderColumns(board.id, newColumnIds);
        }
      }
      return;
    }

    if (activeData?.type === 'card' && overData?.type === 'card') {
      const sourceColumnId = activeData.columnId as string;
      const targetColumnId = overData.columnId as string;

      if (sourceColumnId === targetColumnId) {
        // Same-column reorder
        const column = board.columns.find((c) => c.id === sourceColumnId);
        if (!column) return;
        const oldIndex = column.cards.findIndex((c) => c.id === activeId);
        const newIndex = column.cards.findIndex((c) => c.id === overId);
        const newCardIds = arrayMove(
          column.cards.map((c) => c.id),
          oldIndex,
          newIndex
        );
        reorderCards(board.id, sourceColumnId, newCardIds);
      }
      // Cross-column moves are handled in handleDragOver
    }
  };

  const handleDragCancel = () => {
    dragOriginRef.current = null;
    setActiveDragData(null);
    setActiveDragType(null);
    setDragOverColumnId(null);
  };

  const handleAddColumn = () => {
    if (newColumnTitle.trim()) {
      addColumn(board.id, newColumnTitle.trim());
      setNewColumnTitle('');
      setIsAddColumnDialogOpen(false);
    }
  };

  const handleMobileAddCard = (data: CardEditorSaveData) => {
    if (!activeColumn) return;
    addCard(board.id, activeColumn.id, data.title, data.content, data.targetDate, {
      labels: data.labels,
      coverImage: data.coverImage,
      attachments: data.attachments,
      recurrence: data.recurrence,
    });
    setIsMobileAddCardOpen(false);
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(startOfToday.getDate() + (6 - startOfToday.getDay()) + 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const visibleColumns = board.columns.filter(col => !hiddenColumnIds.includes(col.id));
  const hiddenColumns = board.columns.filter(col => hiddenColumnIds.includes(col.id));

  const filteredColumns = visibleColumns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => {
      if (!card.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;

      if (selectedLabels.length > 0) {
        const cardLabels = card.labels ?? [];
        if (!selectedLabels.some((l) => cardLabels.includes(l))) return false;
      }

      if (dueDateFilter) {
        if (dueDateFilter === 'no-date') {
          if (card.targetDate) return false;
        } else if (dueDateFilter === 'overdue') {
          if (!card.targetDate) return false;
          if (new Date(card.targetDate) >= startOfToday) return false;
        } else if (dueDateFilter === 'this-week') {
          if (!card.targetDate) return false;
          const d = new Date(card.targetDate);
          if (d < startOfToday || d >= endOfWeek) return false;
        } else if (dueDateFilter === 'this-month') {
          if (!card.targetDate) return false;
          const d = new Date(card.targetDate);
          if (d < startOfToday || d >= endOfMonth) return false;
        }
      }

      return true;
    }),
  }));

  useEffect(() => {
    if (activeColumnIndex >= filteredColumns.length && filteredColumns.length > 0) {
      setActiveColumnIndex(filteredColumns.length - 1);
    }
  }, [filteredColumns.length, activeColumnIndex]);

  const activeColumn = filteredColumns[activeColumnIndex] ?? filteredColumns[0];
  const activeColumnCards = activeColumn?.cards.filter(c => !c.isArchived) ?? [];

  return (
    <div className="h-full flex flex-col" style={board.background ? { background: board.background } : undefined}>
      {/* Mobile Header */}
      <div className="relative flex sm:hidden items-center justify-between px-3 pt-3 pb-2 border-b border-white/5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BoardSelector onCreateBoardClick={onNewBoardClick} />
        </div>
        <div className="flex items-center gap-1">
          <ViewToggle />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5">
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-[#111515] border-white/10">
              <DropdownMenuItem onClick={() => setIsMobileSearchOpen(true)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <Search className="w-4 h-4" />
                Search
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsFilterOpen(!isFilterOpen)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <SlidersHorizontal className="w-4 h-4" />
                Filter
                {(selectedLabels.length > 0 || dueDateFilter) && (
                  <span className="ml-auto w-2 h-2 bg-[#78fcd6] rounded-full" />
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsShareDialogOpen(true)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <Share2 className="w-4 h-4" />
                Share
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />
              <DropdownMenuItem onClick={() => setIsAddColumnDialogOpen(true)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <Plus className="w-4 h-4" />
                Add Column
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { const template = boardToTemplate(board); saveUserBoardTemplate(template); toast.success('Board saved as template'); }} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <BookmarkPlus className="w-4 h-4" />
                Save as Template
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { downloadBoardJSON(board); toast.success('Board exported'); }} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <Download className="w-4 h-4" />
                Export to JSON
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsBackgroundPickerOpen(true)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <Palette className="w-4 h-4" />
                Change Background
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setIsArchiveOpen(true)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                <Archive className="w-4 h-4" />
                Archive
              </DropdownMenuItem>
              {hiddenColumns.length > 0 && (
                <>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuLabel className="text-[#A8B2B2] text-xs">Hidden Columns</DropdownMenuLabel>
                  {hiddenColumns.map((col) => (
                    <DropdownMenuItem key={col.id} onClick={() => showColumn(col.id)} className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]">
                      <Eye className="w-4 h-4" />
                      {col.title}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <MobileSearchOverlay isOpen={isMobileSearchOpen} onClose={() => setIsMobileSearchOpen(false)} value={searchQuery} onChange={setSearchQuery} />
      </div>

      {/* Mobile Filter Panel */}
      {isFilterOpen && (
        <div className="sm:hidden px-3 py-3 border-b border-white/10 bg-[#111515]/80 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-[#A8B2B2]">Filters</p>
            <button type="button" onClick={() => setIsFilterOpen(false)} className="text-[#A8B2B2] hover:text-[#F2F7F7]">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-[#A8B2B2] mb-2 flex items-center gap-1.5">
                <Tag className="w-3 h-3" /> Labels
              </p>
              <div className="flex flex-wrap gap-2">
                {ALL_LABELS.map((label) => (
                  <button key={label} type="button" onClick={() => { setSelectedLabels(selectedLabels.includes(label) ? selectedLabels.filter((l) => l !== label) : [...selectedLabels, label]); }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${selectedLabels.includes(label) ? 'border-[#78fcd6]/50 bg-[#78fcd6]/10 text-[#78fcd6]' : 'border-white/10 bg-white/5 text-[#A8B2B2]'}`}>
                    <div className={`w-3 h-3 rounded ${LABEL_COLORS[label]}`} />
                    <span className="capitalize">{label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-medium text-[#A8B2B2] mb-2 flex items-center gap-1.5">
                <Calendar className="w-3 h-3" /> Due Date
              </p>
              <div className="flex flex-wrap gap-2">
                {DUE_DATE_OPTIONS.map((opt) => (
                  <button key={opt.value} type="button" onClick={() => setDueDateFilter(dueDateFilter === opt.value ? null : opt.value)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${dueDateFilter === opt.value ? 'border-[#78fcd6]/50 bg-[#78fcd6]/20 text-[#78fcd6]' : 'border-white/10 text-[#A8B2B2] bg-white/5'}`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {(selectedLabels.length > 0 || dueDateFilter) && (
              <Button variant="ghost" size="sm" onClick={() => { setSelectedLabels([]); setDueDateFilter(null); }} className="h-7 text-xs text-[#A8B2B2] hover:text-[#F2F7F7]">
                Clear All
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Board Header */}
      <div className="hidden sm:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 pt-5 pb-3 border-b border-white/5">
        <div className="flex items-center gap-3 min-w-0">
          <BoardSelector onCreateBoardClick={onNewBoardClick} />
          <ViewToggle />
        </div>

        <div className="flex items-center gap-1.5">
          {/* Ask AI */}
          {onAIClick && (
            <button
              onClick={onAIClick}
              className="mr-2 flex items-center gap-1.5 h-9 px-4 font-medium text-sm text-[#78fcd6] hover:text-[#00ffb6] transition-colors bg-white/5 border border-white/10 rounded-lg hover:bg-white/10"
            >
              <Sparkles className="w-4 h-4" />
              <span>Ask AI</span>
            </button>
          )}

          {/* Search */}
          <div className="relative min-w-0 shrink">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8B2B2]" />
            <Input
              id="board-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search... (/)"
              className="w-32 sm:w-64 pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 h-9"
            />
          </div>

          {/* Filters */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className={`relative h-9 w-9 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5 ${
                  selectedLabels.length > 0 || dueDateFilter ? 'text-[#78fcd6]' : ''
                }`}
              >
                <SlidersHorizontal className="w-4 h-4" />
                {(selectedLabels.length > 0 || dueDateFilter) && (
                  <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#78fcd6] rounded-full" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 bg-[#111515] border-white/10 p-3" align="end">
              <div className="space-y-3">
                {/* Labels */}
                <div>
                  <p className="text-xs font-medium text-[#A8B2B2] mb-2 flex items-center gap-1.5">
                    <Tag className="w-3 h-3" /> Labels
                  </p>
                  <div className="space-y-1.5">
                    {ALL_LABELS.map((label) => (
                      <label key={label} className="flex items-center gap-2 cursor-pointer hover:bg-white/5 rounded p-1">
                        <Checkbox
                          checked={selectedLabels.includes(label)}
                          onCheckedChange={(checked) => {
                            setSelectedLabels(checked
                              ? [...selectedLabels, label]
                              : selectedLabels.filter((l) => l !== label)
                            );
                          }}
                          className="border-white/20 data-[state=checked]:bg-[#78fcd6] data-[state=checked]:border-[#78fcd6]"
                        />
                        <div className={`w-4 h-4 rounded ${LABEL_COLORS[label]}`} />
                        <span className="text-sm text-[#F2F7F7] capitalize">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/10" />

                {/* Due Date */}
                <div>
                  <p className="text-xs font-medium text-[#A8B2B2] mb-2 flex items-center gap-1.5">
                    <Calendar className="w-3 h-3" /> Due Date
                  </p>
                  <div className="space-y-1">
                    {DUE_DATE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDueDateFilter(dueDateFilter === opt.value ? null : opt.value)}
                        className={`w-full text-left text-sm px-2 py-1.5 rounded transition-colors ${
                          dueDateFilter === opt.value
                            ? 'bg-[#78fcd6]/20 text-[#78fcd6]'
                            : 'text-[#F2F7F7] hover:bg-white/5'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clear All */}
                {(selectedLabels.length > 0 || dueDateFilter) && (
                  <>
                    <div className="border-t border-white/10" />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setSelectedLabels([]); setDueDateFilter(null); }}
                      className="w-full h-7 text-xs text-[#A8B2B2] hover:text-[#F2F7F7]"
                    >
                      Clear All
                    </Button>
                  </>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Share Board */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setIsShareDialogOpen(true)}
            className="h-9 px-3 bg-white/5 hover:bg-white/10 text-[#F2F7F7] border border-white/10 rounded-lg"
          >
            <Share2 className="w-4 h-4 mr-1.5" />
            Share
          </Button>

          {/* More Options */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
              >
                <MoreHorizontal className="w-5 h-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48 bg-[#111515] border-white/10">
              <DropdownMenuItem
                onClick={() => setIsAddColumnDialogOpen(true)}
                className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
              >
                <Plus className="w-4 h-4" />
                Add Column
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const template = boardToTemplate(board);
                  saveUserBoardTemplate(template);
                  toast.success('Board saved as template — use it when creating a new board');
                }}
                className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
              >
                <BookmarkPlus className="w-4 h-4" />
                Save as Template
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  downloadBoardJSON(board);
                  toast.success('Board exported');
                }}
                className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
              >
                <Download className="w-4 h-4" />
                Export to JSON
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsBackgroundPickerOpen(true)}
                className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
              >
                <Palette className="w-4 h-4" />
                Change Background
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsArchiveOpen(true)}
                className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
              >
                <Archive className="w-4 h-4" />
                Archive
              </DropdownMenuItem>
              {hiddenColumns.length > 0 && (
                <>
                  <DropdownMenuSeparator className="bg-white/10" />
                  <DropdownMenuLabel className="text-[#A8B2B2] text-xs">
                    Hidden Columns
                  </DropdownMenuLabel>
                  {hiddenColumns.map((col) => (
                    <DropdownMenuItem
                      key={col.id}
                      onClick={() => showColumn(col.id)}
                      className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
                    >
                      <Eye className="w-4 h-4" />
                      {col.title}
                    </DropdownMenuItem>
                  ))}
                  {hiddenColumns.length > 1 && (
                    <DropdownMenuItem
                      onClick={() => setBoardHiddenColumns(board.id, [])}
                      className="text-[#78fcd6] focus:bg-white/5 focus:text-[#78fcd6]"
                    >
                      Show All Columns
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          <ArchiveView boardId={board.id} open={isArchiveOpen} onOpenChange={setIsArchiveOpen} />
          <BackgroundPicker
            open={isBackgroundPickerOpen}
            onOpenChange={setIsBackgroundPickerOpen}
            currentBackground={board.background}
            onSelect={(bg) => {
              setBoardBackground(board.id, bg);
              setIsBackgroundPickerOpen(false);
            }}
          />
        </div>
      </div>

      {/* Mobile Column Tabs */}
      <MobileColumnTabs columns={filteredColumns} activeIndex={activeColumnIndex} onTabChange={setActiveColumnIndex} />

      {/* Board Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {/* Mobile: single column card list */}
        {isCompact && activeColumn && (
          <div ref={mobileCardListRef} className="flex-1 overflow-y-auto sm:hidden">
            <div className="p-3 space-y-2">
              <SortableContext items={activeColumnCards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                {activeColumnCards.map((card) => (
                  <KanbanCard key={card.id} boardId={board.id} columnId={activeColumn.id} card={card} />
                ))}
              </SortableContext>
              {activeColumnCards.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-[#A8B2B2]">
                  <p className="text-sm">No cards in this column</p>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={scrollContainerRef} className="hidden sm:flex flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin cursor-grab flex-col">
          <div className="h-full flex items-start gap-4 p-4 min-w-max">
            <SortableContext
              items={visibleColumns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {filteredColumns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  boardId={board.id}
                  column={column}
                  onHide={() => hideColumn(column.id)}
                  isDragOver={dragOverColumnId === column.id}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
              {activeCard ? (
                <div className="w-[calc(100vw-24px)] sm:w-80 bg-[#1a1f1f] border border-[#78fcd6]/30 rounded-lg p-3 shadow-2xl shadow-[#78fcd6]/10 opacity-90 rotate-2">
                  <p className="text-sm font-medium text-[#F2F7F7] line-clamp-2">{activeCard.title}</p>
                  {activeCard.description && (
                    <p className="text-xs text-[#A8B2B2] mt-1 line-clamp-1">{activeCard.description}</p>
                  )}
                </div>
              ) : null}
            </DragOverlay>
          </div>
        </div>
      </DndContext>

      {/* Mobile Bottom Bar */}
      <MobileBottomBar onAIClick={onAIClick} onAddCard={() => setIsMobileAddCardOpen(true)} />

      {/* Mobile Add Card Dialog */}
      <CardEditor isOpen={isMobileAddCardOpen} onClose={() => setIsMobileAddCardOpen(false)} onSave={handleMobileAddCard} mode="create" />

      {/* Share Board Dialog */}
      <ShareBoardDialog
        boardId={board.id}
        boardName={board.name}
        isPublic={board.isPublic ?? false}
        embedEnabled={board.embedEnabled ?? false}
        isOpen={isShareDialogOpen}
        onOpenChange={setIsShareDialogOpen}
      />

      {/* Add Column Dialog */}
      <Dialog open={isAddColumnDialogOpen} onOpenChange={setIsAddColumnDialogOpen}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Add Column</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="column-title" className="mb-2 block">
              Column Title
            </Label>
            <Input
              id="column-title"
              value={newColumnTitle}
              onChange={(e) => setNewColumnTitle(e.target.value)}
              placeholder="e.g., In Review"
              maxLength={100}
              className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
              onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsAddColumnDialogOpen(false)}
              className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleAddColumn}
              disabled={!newColumnTitle.trim()}
              className="gradient-cyan text-[#0B0F0F] hover:opacity-90"
            >
              Add Column
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useState } from 'react';
import { DndContext, type DragEndEvent, type DragOverEvent, type DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners } from '@dnd-kit/core';
import { SortableContext, arrayMove, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useBoardStore } from '@/store/useBoardStore';
import type { Board, CardLabel } from '@/types';
import { KanbanColumn } from './KanbanColumn';
import { ArchiveView } from './ArchiveView';
import { Button } from '@/components/ui/button';
import { Plus, Search, Tag, Calendar, ChevronDown } from 'lucide-react';
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

interface KanbanBoardProps {
  board: Board;
}

export function KanbanBoard({ board }: KanbanBoardProps) {
  const { addColumn, moveCard, reorderColumns, reorderCards } = useBoardStore();
  const [isAddColumnDialogOpen, setIsAddColumnDialogOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [, setActiveDragData] = useState<{ cardId: string; sourceColumnId: string } | null>(null);
  const [selectedLabels, setSelectedLabels] = useState<CardLabel[]>([]);
  const [dueDateFilter, setDueDateFilter] = useState<string | null>(null);

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
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const activeData = active.data.current;
    
    if (activeData?.type === 'card') {
      setActiveDragData({
        cardId: active.id as string,
        sourceColumnId: activeData.columnId as string,
      });
    }
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
      if (sourceColumnId !== targetColumnId) {
        // Cross-column move: place card before the target card
        const targetColumn = board.columns.find((c) => c.id === targetColumnId);
        const targetIndex = targetColumn ? targetColumn.cards.findIndex((c) => c.id === overId) : undefined;
        moveCard(board.id, sourceColumnId, targetColumnId, activeId as string, targetIndex === -1 ? undefined : targetIndex);
      }
    } else if (overData?.type === 'column') {
      const targetColumnId = overId as string;
      if (sourceColumnId !== targetColumnId) {
        // Card dragged onto an empty column — append to end
        moveCard(board.id, sourceColumnId, targetColumnId, activeId as string);
      }
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    setActiveDragData(null);

    if (!over) return;

    const activeId = active.id;
    const overId = over.id;

    if (activeId === overId) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type === 'column' && overData?.type === 'column') {
      // Reorder columns
      const oldIndex = board.columns.findIndex((c) => c.id === activeId);
      const newIndex = board.columns.findIndex((c) => c.id === overId);
      const newColumnIds = arrayMove(
        board.columns.map((c) => c.id),
        oldIndex,
        newIndex
      );
      reorderColumns(board.id, newColumnIds);
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

  const handleAddColumn = () => {
    if (newColumnTitle.trim()) {
      addColumn(board.id, newColumnTitle.trim());
      setNewColumnTitle('');
      setIsAddColumnDialogOpen(false);
    }
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfWeek = new Date(startOfToday);
  endOfWeek.setDate(startOfToday.getDate() + (6 - startOfToday.getDay()) + 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const filteredColumns = board.columns.map((column) => ({
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

  return (
    <div className="h-full flex flex-col">
      {/* Board Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div>
          <h1 className="text-lg font-semibold">{board.name}</h1>
          {board.description && (
            <p className="text-sm text-[#A8B2B2]">{board.description}</p>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8B2B2]" />
            <Input
              id="board-search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cards... (press /)"
              className="w-64 pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 h-9"
            />
          </div>

          {/* Label Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={`h-9 px-3 border-white/10 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5 ${selectedLabels.length > 0 ? 'border-[#78fcd6]/50 text-[#78fcd6]' : ''}`}
              >
                <Tag className="w-4 h-4 mr-1.5" />
                Labels
                {selectedLabels.length > 0 && (
                  <span className="ml-1 text-xs bg-[#78fcd6]/20 px-1.5 rounded-full">{selectedLabels.length}</span>
                )}
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 bg-[#111515] border-white/10 p-3" align="end">
              <div className="space-y-2">
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
                {selectedLabels.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedLabels([])}
                    className="w-full h-7 text-xs text-[#A8B2B2] hover:text-[#F2F7F7]"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Due Date Filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className={`h-9 px-3 border-white/10 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5 ${dueDateFilter ? 'border-[#78fcd6]/50 text-[#78fcd6]' : ''}`}
              >
                <Calendar className="w-4 h-4 mr-1.5" />
                Due Date
                <ChevronDown className="w-3 h-3 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-48 bg-[#111515] border-white/10 p-3" align="end">
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
                {dueDateFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDueDateFilter(null)}
                    className="w-full h-7 text-xs text-[#A8B2B2] hover:text-[#F2F7F7] mt-1"
                  >
                    Clear
                  </Button>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <ArchiveView boardId={board.id} />

          {/* Add Column Button */}
          <Button
            onClick={() => setIsAddColumnDialogOpen(true)}
            className="h-9 px-4 bg-white/5 hover:bg-white/10 text-[#F2F7F7] border border-white/10 rounded-lg"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            Column
          </Button>
        </div>
      </div>

      {/* Board Columns */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin">
          <div className="h-full flex items-start gap-4 p-4 min-w-max">
            <SortableContext
              items={board.columns.map((c) => c.id)}
              strategy={horizontalListSortingStrategy}
            >
              {filteredColumns.map((column) => (
                <KanbanColumn
                  key={column.id}
                  boardId={board.id}
                  column={column}
                />
              ))}
            </SortableContext>
          </div>
        </div>
      </DndContext>

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

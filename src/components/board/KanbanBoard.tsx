import { useState } from 'react';
import { DndContext, type DragEndEvent, type DragOverEvent, type DragStartEvent, PointerSensor, useSensor, useSensors, closestCorners } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { useBoardStore } from '@/store/useBoardStore';
import type { Board } from '@/types';
import { KanbanColumn } from './KanbanColumn';
import { ArchiveView } from './ArchiveView';
import { Button } from '@/components/ui/button';
import { Plus, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';

interface KanbanBoardProps {
  board: Board;
}

export function KanbanBoard({ board }: KanbanBoardProps) {
  const { addColumn, moveCard, reorderColumns } = useBoardStore();
  const [isAddColumnDialogOpen, setIsAddColumnDialogOpen] = useState(false);
  const [newColumnTitle, setNewColumnTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [, setActiveDragData] = useState<{ cardId: string; sourceColumnId: string } | null>(null);

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
    
    if (activeData?.type === 'card' && overData?.type === 'card') {
      const sourceColumnId = activeData.columnId as string;
      const targetColumnId = overData.columnId as string;
      
      if (sourceColumnId !== targetColumnId) {
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
      
      const newColumnIds = board.columns.map((c) => c.id);
      newColumnIds.splice(oldIndex, 1);
      newColumnIds.splice(newIndex, 0, activeId as string);
      
      reorderColumns(board.id, newColumnIds);
    }
  };

  const handleAddColumn = () => {
    if (newColumnTitle.trim()) {
      addColumn(board.id, newColumnTitle.trim());
      setNewColumnTitle('');
      setIsAddColumnDialogOpen(false);
    }
  };

  const filteredColumns = board.columns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) =>
      card.title.toLowerCase().includes(searchQuery.toLowerCase())
    ),
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
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cards..."
              className="w-64 pl-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50 h-9"
            />
          </div>

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

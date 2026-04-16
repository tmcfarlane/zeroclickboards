import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import type { Board, Card, CardLabel } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ViewToggle } from '@/components/board/ViewToggle';
import { BoardSelector } from '@/components/board/BoardSelector';
import { CardEditor, type CardEditorSaveData } from '@/components/board/CardEditor';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { ChevronLeft, ChevronRight, Calendar, Clock, Repeat, Pencil } from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns';
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { parseLocalDate } from '@/lib/utils';
import { getOccurrencesInRange } from '@/lib/recurrence';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import { useActivityLogger } from '@/hooks/useActivityLogger';

const LABEL_HEX: Record<CardLabel, string> = {
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  gray: '#6b7280',
};

const ALL_LABELS: CardLabel[] = ['red', 'yellow', 'green', 'blue', 'purple', 'gray'];

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function labelCardStyle(labels: CardLabel[] | undefined): CSSProperties | undefined {
  if (!labels || labels.length === 0) return undefined;
  if (labels.length === 1) {
    const c = LABEL_HEX[labels[0]];
    return {
      backgroundImage: `linear-gradient(to right, ${hexToRgba(c, 0.4)}, ${hexToRgba(c, 0.2)})`,
      borderColor: hexToRgba(c, 0.5),
    };
  }
  const stops = labels
    .map((label, i) => {
      const pct = (i / (labels.length - 1)) * 100;
      return `${hexToRgba(LABEL_HEX[label], 0.4)} ${pct.toFixed(2)}%`;
    })
    .join(', ');
  return {
    backgroundImage: `linear-gradient(90deg, ${stops})`,
    borderColor: hexToRgba(LABEL_HEX[labels[0]], 0.5),
  };
}

const DEFAULT_CARD_STYLE =
  'bg-gradient-to-r from-[#78fcd6]/30 to-[#00ffb6]/20 border-[#78fcd6]/30';

interface TimelineViewProps {
  board: Board;
  onNewBoardClick: () => void;
}

interface TimelineCardEntry {
  card: Card;
  columnName: string;
  columnId: string;
  occurrenceDate: string;
  isRecurringInstance: boolean;
}

interface TimelineSwimlane {
  columnId: string;
  columnName: string;
  cards: TimelineCardEntry[];
}

interface ActiveDrag {
  cardId: string;
  sourceColumnId: string;
  sourceDate: string;
}

export function TimelineView({ board, onNewBoardClick }: TimelineViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [activeDrag, setActiveDrag] = useState<ActiveDrag | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } })
  );

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Get all cards with target dates, expanding recurring cards into per-occurrence entries.
  const timelineCards = useMemo(() => {
    const cards: TimelineCardEntry[] = [];
    board.columns.forEach((column) => {
      column.cards.forEach((card) => {
        if (card.isArchived) return;
        if (!card.targetDate) return;
        const occurrences = getOccurrencesInRange(
          card.targetDate,
          card.recurrence,
          weekStart,
          weekEnd
        );
        occurrences.forEach((occurrenceDate) => {
          cards.push({
            card,
            columnName: column.title,
            columnId: column.id,
            occurrenceDate,
            isRecurringInstance: !!card.recurrence && occurrenceDate !== card.targetDate,
          });
        });
      });
    });
    return cards.sort(
      (a, b) => parseLocalDate(a.occurrenceDate).getTime() - parseLocalDate(b.occurrenceDate).getTime()
    );
  }, [board, weekStart, weekEnd]);

  // Group cards by column (swimlanes). Always include every column so empty
  // statuses still render as drop targets.
  const swimlanes = useMemo<TimelineSwimlane[]>(() => {
    const byColumnId = new Map<string, TimelineCardEntry[]>();
    board.columns.forEach((column) => byColumnId.set(column.id, []));
    timelineCards.forEach((item) => {
      const lane = byColumnId.get(item.columnId);
      if (lane) lane.push(item);
    });
    return board.columns.map((column) => ({
      columnId: column.id,
      columnName: column.title,
      cards: byColumnId.get(column.id) ?? [],
    }));
  }, [timelineCards, board.columns]);

  const goToPreviousWeek = () => setCurrentDate(subWeeks(currentDate, 1));
  const goToNextWeek = () => setCurrentDate(addWeeks(currentDate, 1));
  const goToToday = () => setCurrentDate(new Date());

  const isToday = (date: Date) => isSameDay(date, new Date());

  const getCardPosition = (targetDate: string) => {
    const date = parseLocalDate(targetDate);
    const dayIndex = days.findIndex((d) => isSameDay(d, date));
    if (dayIndex === -1) return null;
    return dayIndex;
  };

  const activeCard = activeDrag
    ? board.columns
        .find((c) => c.id === activeDrag.sourceColumnId)
        ?.cards.find((c) => c.id === activeDrag.cardId) ?? null
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type !== 'timeline-card') return;
    setActiveDrag({
      cardId: data.cardId as string,
      sourceColumnId: data.sourceColumnId as string,
      sourceDate: data.sourceDate as string,
    });
  };

  const handleDragCancel = () => setActiveDrag(null);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    if (activeData?.type !== 'timeline-card' || overData?.type !== 'timeline-cell') return;

    const cardId = activeData.cardId as string;
    const sourceColumnId = activeData.sourceColumnId as string;
    const sourceDate = activeData.sourceDate as string;
    const targetColumnId = overData.targetColumnId as string;
    const targetDate = overData.targetDate as string;

    const columnChanged = sourceColumnId !== targetColumnId;
    const dateChanged = sourceDate !== targetDate;
    if (!columnChanged && !dateChanged) return;

    const boardId = board.id;
    const store = useBoardStore.getState();

    if (columnChanged) {
      store.moveCard(boardId, sourceColumnId, targetColumnId, cardId);
    }

    if (dateChanged) {
      const finalColId = columnChanged ? targetColumnId : sourceColumnId;
      // editCard pushes its own undo — suppress so we can push one combined entry.
      useUndoStore.setState({ _skipRecord: true });
      useBoardStore.getState().editCard(boardId, finalColId, cardId, { targetDate });
      useUndoStore.setState({ _skipRecord: false });
    }

    useUndoStore.getState().pushAction({
      description: 'Move card on timeline',
      undo: () => {
        if (dateChanged) {
          const finalColId = columnChanged ? targetColumnId : sourceColumnId;
          useBoardStore.getState().editCard(boardId, finalColId, cardId, { targetDate: sourceDate });
        }
        if (columnChanged) {
          useBoardStore.getState().moveCard(boardId, targetColumnId, sourceColumnId, cardId);
        }
      },
      redo: () => {
        if (columnChanged) {
          useBoardStore.getState().moveCard(boardId, sourceColumnId, targetColumnId, cardId);
        }
        if (dateChanged) {
          const finalColId = columnChanged ? targetColumnId : sourceColumnId;
          useBoardStore.getState().editCard(boardId, finalColId, cardId, { targetDate });
        }
      },
    });
  };

  const hasAnyTimelineCards = timelineCards.length > 0;

  return (
    <div className="h-full flex flex-col">
      {/* Timeline Header */}
      <div className="px-4 py-3 border-b border-white/5 space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <BoardSelector onCreateBoardClick={onNewBoardClick} />
          <ViewToggle />

          <div className="flex items-center gap-2">
            <Button
              onClick={goToToday}
              variant="outline"
              className="h-9 border-white/10 text-[#F2F7F7] hover:bg-white/5"
            >
              <Calendar className="w-4 h-4 sm:mr-1.5 text-[#A8B2B2]" />
              <span className="hidden sm:inline">Today</span>
            </Button>
            <div className="flex items-center bg-white/5 rounded-lg">
              <Button
                onClick={goToPreviousWeek}
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                onClick={goToNextWeek}
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          </div>
        </div>
        <p className="text-sm text-[#A8B2B2]">
          {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
        </p>
      </div>

      {/* Timeline Grid */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <div className="p-4">
          <DndContext
            sensors={sensors}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            {/* Days Header */}
            <div className="grid grid-cols-7 gap-2 mb-4">
              {days.map((day) => (
                <div
                  key={day.toISOString()}
                  className={`relative text-center p-1.5 sm:p-3 rounded-lg ${
                    isToday(day)
                      ? 'bg-[#78fcd6]/20 border border-[#78fcd6]/40 shadow-[0_0_0_1px_rgba(120,252,214,0.25),0_0_24px_-8px_rgba(120,252,214,0.6)]'
                      : 'bg-white/5 border border-white/5'
                  }`}
                >
                  {isToday(day) && (
                    <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-[#78fcd6] text-[#0B0F0F] text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full">
                      Today
                    </span>
                  )}
                  <div className={`text-xs font-medium ${isToday(day) ? 'text-[#78fcd6]' : 'text-[#A8B2B2]'}`}>
                    {format(day, 'EEE')}
                  </div>
                  <div className={`text-sm sm:text-lg font-semibold ${isToday(day) ? 'text-[#78fcd6]' : 'text-[#F2F7F7]'}`}>
                    {format(day, 'd')}
                  </div>
                </div>
              ))}
            </div>

            {/* Swimlanes */}
            {!hasAnyTimelineCards ? (
              <div className="text-center py-16">
                <Clock className="w-12 h-12 text-[#A8B2B2] mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No cards with target dates</h3>
                <p className="text-sm text-[#A8B2B2]">
                  Add target dates to cards to see them on the timeline
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {swimlanes.map((lane) => {
                  const cardsByDay = new Map<number, TimelineCardEntry[]>();
                  lane.cards.forEach((item) => {
                    const position = getCardPosition(item.occurrenceDate);
                    if (position === null) return;
                    const bucket = cardsByDay.get(position) ?? [];
                    bucket.push(item);
                    cardsByDay.set(position, bucket);
                  });
                  const maxStack = Math.max(1, ...Array.from(cardsByDay.values(), (b) => b.length));

                  return (
                    <div key={lane.columnId} className="space-y-2">
                      {/* Swimlane Header */}
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-[#78fcd6]/30" />
                        <span className="text-sm font-medium text-[#A8B2B2]">{lane.columnName}</span>
                        <span className="text-xs text-[#A8B2B2]/60">({lane.cards.length})</span>
                      </div>

                      {/* Swimlane Grid */}
                      <div className="grid grid-cols-7 gap-2">
                        {days.map((day, dayIdx) => {
                          const dayCards = cardsByDay.get(dayIdx) ?? [];
                          const dateStr = format(day, 'yyyy-MM-dd');
                          return (
                            <TimelineCell
                              key={`cell-${lane.columnId}-${dateStr}`}
                              columnId={lane.columnId}
                              dateStr={dateStr}
                              isToday={isToday(day)}
                              minHeight={maxStack * 3.5 + 0.5}
                            >
                              {dayCards.map((item) => (
                                <TimelineCardItem
                                  key={`${item.card.id}-${item.occurrenceDate}`}
                                  boardId={board.id}
                                  columnId={lane.columnId}
                                  item={item}
                                />
                              ))}
                            </TimelineCell>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
              {activeCard ? (
                <div className="bg-[#1a1f1f] border border-[#78fcd6]/40 rounded-lg p-2 shadow-2xl shadow-[#78fcd6]/10 opacity-95 rotate-2">
                  <p className="text-xs font-medium text-[#F2F7F7] line-clamp-2">
                    {activeCard.title}
                  </p>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
    </div>
  );
}

interface TimelineCellProps {
  columnId: string;
  dateStr: string;
  isToday: boolean;
  minHeight: number;
  children: React.ReactNode;
}

function TimelineCell({ columnId, dateStr, isToday, minHeight, children }: TimelineCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell-${columnId}-${dateStr}`,
    data: { type: 'timeline-cell', targetColumnId: columnId, targetDate: dateStr },
  });

  const base = isToday
    ? 'bg-[#78fcd6]/[0.07] border-[#78fcd6]/30'
    : 'bg-white/[0.02] border-white/5';
  const over = isOver ? 'ring-2 ring-[#78fcd6]/60 bg-[#78fcd6]/10' : '';

  return (
    <div
      ref={setNodeRef}
      className={`rounded-lg border p-1 flex flex-col gap-1 transition-colors ${base} ${over}`}
      style={{ minHeight: `${minHeight}rem` }}
    >
      {children}
    </div>
  );
}

interface TimelineCardItemProps {
  boardId: string;
  columnId: string;
  item: TimelineCardEntry;
}

function TimelineCardItem({ boardId, columnId, item }: TimelineCardItemProps) {
  const { card, occurrenceDate, isRecurringInstance } = item;
  const isRecurring = !!card.recurrence;
  const { editCard, removeCard } = useBoardStore();
  const { logActivity } = useActivityLogger();

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(card.title);
  const [editingFull, setEditingFull] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `${card.id}-${occurrenceDate}`,
    data: {
      type: 'timeline-card',
      cardId: card.id,
      sourceColumnId: columnId,
      sourceDate: occurrenceDate,
    },
    disabled: isRecurring,
  });

  const labels = card.labels;
  const inlineStyle = labelCardStyle(labels);
  const iconColor = inlineStyle
    ? (isRecurringInstance ? 'text-white/60' : 'text-white/85')
    : (isRecurringInstance ? 'text-[#78fcd6]/70' : 'text-[#78fcd6]');

  const dragStyle: CSSProperties = {
    ...inlineStyle,
    transform: transform ? CSS.Translate.toString(transform) : undefined,
    opacity: isDragging ? 0.3 : undefined,
  };

  const cursorClass = isRecurring ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing';

  const openPopover = () => {
    setTitleDraft(card.title);
    setPopoverOpen(true);
  };

  const commitTitle = () => {
    const next = titleDraft.trim();
    if (!next || next === card.title) {
      setTitleDraft(card.title);
      return;
    }
    logActivity(card.id, 'renamed', { from: card.title, to: next });
    editCard(boardId, columnId, card.id, { title: next });
  };

  const toggleLabel = (label: CardLabel) => {
    const current = card.labels ?? [];
    const nextLabels = current.includes(label)
      ? current.filter((l) => l !== label)
      : [...current, label];
    const added = nextLabels.filter((l) => !current.includes(l));
    const removed = current.filter((l) => !nextLabels.includes(l));
    if (added.length > 0 || removed.length > 0) {
      logActivity(card.id, 'label_changed', { added, removed });
    }
    editCard(boardId, columnId, card.id, { labels: nextLabels });
  };

  const handleFullSave = (data: CardEditorSaveData) => {
    if (data.title !== card.title) {
      logActivity(card.id, 'renamed', { from: card.title, to: data.title });
    }
    const oldLabels = card.labels || [];
    const newLabels = data.labels || [];
    const addedLabels = newLabels.filter((l) => !oldLabels.includes(l));
    const removedLabels = oldLabels.filter((l) => !newLabels.includes(l));
    if (addedLabels.length > 0 || removedLabels.length > 0) {
      logActivity(card.id, 'label_changed', { added: addedLabels, removed: removedLabels });
    }
    if (data.targetDate !== card.targetDate) {
      logActivity(card.id, 'date_changed', { from: card.targetDate || null, to: data.targetDate || null });
    }
    editCard(boardId, columnId, card.id, {
      title: data.title,
      description: data.description,
      content: data.content,
      targetDate: data.targetDate,
      labels: data.labels,
      coverImage: data.coverImage,
      attachments: data.attachments,
      recurrence: data.recurrence,
    });
    setEditingFull(false);
  };

  const recurringTitle = isRecurring
    ? 'Open card to change date — recurring schedule must be edited in the full editor.'
    : undefined;

  return (
    <>
      <Popover
        open={popoverOpen}
        onOpenChange={(next) => {
          if (isDragging) return;
          setPopoverOpen(next);
          if (!next) setTitleDraft(card.title);
        }}
      >
        <PopoverAnchor asChild>
          <div
            ref={setNodeRef}
            style={dragStyle}
            {...attributes}
            {...listeners}
            onClick={openPopover}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openPopover();
              }
            }}
            role="button"
            tabIndex={0}
            aria-label={`Edit ${card.title}`}
            title={recurringTitle}
            className={`${inlineStyle ? '' : DEFAULT_CARD_STYLE} border rounded-lg p-1 sm:p-2 overflow-hidden transition-[filter,transform] hover:brightness-125 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#78fcd6]/60 ${cursorClass}`}
          >
            <div className="flex items-start gap-1">
              <p className="text-xs font-medium text-[#F2F7F7] line-clamp-2 flex-1 pointer-events-none">
                {card.title}
              </p>
              {isRecurring && (
                <Repeat className={`w-3 h-3 shrink-0 mt-0.5 ${iconColor} pointer-events-none`} />
              )}
            </div>
            <p className="text-[10px] text-[#A8B2B2] mt-1 pointer-events-none">
              {format(parseLocalDate(occurrenceDate), 'MMM d')}
            </p>
          </div>
        </PopoverAnchor>

        <PopoverContent
          className="w-64 bg-[#111515] border-white/10 p-3 space-y-3"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="space-y-1.5">
            <label htmlFor={`timeline-title-${card.id}`} className="text-[10px] uppercase tracking-wide text-[#A8B2B2]">
              Title
            </label>
            <Input
              id={`timeline-title-${card.id}`}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitTitle();
                  setPopoverOpen(false);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setTitleDraft(card.title);
                  setPopoverOpen(false);
                }
              }}
              className="h-8 bg-white/5 border-white/10 text-[#F2F7F7] text-sm"
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] uppercase tracking-wide text-[#A8B2B2]">Labels</p>
            <div className="flex flex-wrap gap-1.5">
              {ALL_LABELS.map((label) => {
                const active = (card.labels ?? []).includes(label);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => toggleLabel(label)}
                    aria-label={`${active ? 'Remove' : 'Add'} ${label} label`}
                    aria-pressed={active}
                    className={`h-6 w-6 rounded-full border transition-transform hover:scale-110 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[#78fcd6]/60 ${
                      active ? 'ring-2 ring-white/80 ring-offset-2 ring-offset-[#111515]' : 'border-white/10'
                    }`}
                    style={{ backgroundColor: LABEL_HEX[label] }}
                  />
                );
              })}
            </div>
          </div>

          <div className="pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setPopoverOpen(false);
                setEditingFull(true);
              }}
              className="w-full h-8 border-white/10 bg-white/5 text-[#F2F7F7] hover:bg-white/10"
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" />
              Open Full Editor
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {editingFull && (
        <CardEditor
          isOpen={editingFull}
          onClose={() => setEditingFull(false)}
          onSave={handleFullSave}
          onDelete={() => {
            removeCard(boardId, columnId, card.id);
            setEditingFull(false);
          }}
          mode="edit"
          cardId={card.id}
          initialData={card}
        />
      )}
    </>
  );
}

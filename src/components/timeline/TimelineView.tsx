import type { CSSProperties } from 'react';
import { useMemo, useState } from 'react';
import type { Board, Card, CardLabel } from '@/types';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, Calendar, Clock, Repeat } from 'lucide-react';
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
} from 'date-fns';
import { parseLocalDate } from '@/lib/utils';
import { getOccurrencesInRange } from '@/lib/recurrence';

const LABEL_HEX: Record<CardLabel, string> = {
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
  gray: '#6b7280',
};

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
}

interface TimelineCard {
  card: Card;
  columnName: string;
  columnId: string;
  occurrenceDate: string;
  isRecurringInstance: boolean;
}

export function TimelineView({ board }: TimelineViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // Get all cards with target dates, expanding recurring cards into per-occurrence entries.
  const timelineCards = useMemo(() => {
    const cards: TimelineCard[] = [];
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

  // Group cards by column (swimlanes)
  const swimlanes = useMemo(() => {
    const lanes = new Map<string, TimelineCard[]>();
    board.columns.forEach((column) => {
      lanes.set(column.title, []);
    });
    timelineCards.forEach((item) => {
      const lane = lanes.get(item.columnName) || [];
      lane.push(item);
      lanes.set(item.columnName, lane);
    });
    return Array.from(lanes.entries()).filter(([, cards]) => cards.length > 0);
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

  return (
    <div className="h-full flex flex-col">
      {/* Timeline Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-b border-white/5">
        <div>
          <h1 className="text-lg font-semibold">{board.name} - Timeline</h1>
          <p className="text-sm text-[#A8B2B2]">
            {format(weekStart, 'MMM d')} - {format(weekEnd, 'MMM d, yyyy')}
          </p>
        </div>

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

      {/* Timeline Grid */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <div className="p-4">
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
          <div className="space-y-4">
            {swimlanes.length === 0 ? (
              <div className="text-center py-16">
                <Clock className="w-12 h-12 text-[#A8B2B2] mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No cards with target dates</h3>
                <p className="text-sm text-[#A8B2B2]">
                  Add target dates to cards to see them on the timeline
                </p>
              </div>
            ) : (
              swimlanes.map(([columnName, cards]) => {
                const cardsByDay = new Map<number, TimelineCard[]>();
                cards.forEach((item) => {
                  const position = getCardPosition(item.occurrenceDate);
                  if (position === null) return;
                  const bucket = cardsByDay.get(position) ?? [];
                  bucket.push(item);
                  cardsByDay.set(position, bucket);
                });
                const maxStack = Math.max(1, ...Array.from(cardsByDay.values(), (b) => b.length));

                return (
                  <div key={columnName} className="space-y-2">
                    {/* Swimlane Header */}
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full bg-[#78fcd6]/30" />
                      <span className="text-sm font-medium text-[#A8B2B2]">{columnName}</span>
                      <span className="text-xs text-[#A8B2B2]/60">({cards.length})</span>
                    </div>

                    {/* Swimlane Grid */}
                    <div className="grid grid-cols-7 gap-2">
                      {days.map((day, dayIdx) => {
                        const dayCards = cardsByDay.get(dayIdx) ?? [];
                        return (
                          <div
                            key={`cell-${day.toISOString()}`}
                            className={`rounded-lg border p-1 flex flex-col gap-1 ${
                              isToday(day)
                                ? 'bg-[#78fcd6]/[0.07] border-[#78fcd6]/30'
                                : 'bg-white/[0.02] border-white/5'
                            }`}
                            style={{ minHeight: `${maxStack * 3.5 + 0.5}rem` }}
                          >
                            {dayCards.map((item) => {
                              const labels = item.card.labels;
                              const inlineStyle = labelCardStyle(labels);
                              const iconColor = inlineStyle
                                ? (item.isRecurringInstance ? 'text-white/60' : 'text-white/85')
                                : (item.isRecurringInstance ? 'text-[#78fcd6]/70' : 'text-[#78fcd6]');
                              return (
                                <div
                                  key={`${item.card.id}-${item.occurrenceDate}`}
                                  className={`${inlineStyle ? '' : DEFAULT_CARD_STYLE} border rounded-lg p-1 sm:p-2 overflow-hidden transition-[filter] hover:brightness-125 cursor-pointer`}
                                  style={inlineStyle}
                                >
                                  <div className="flex items-start gap-1">
                                    <p className="text-xs font-medium text-[#F2F7F7] line-clamp-2 flex-1">
                                      {item.card.title}
                                    </p>
                                    {item.card.recurrence && (
                                      <Repeat className={`w-3 h-3 shrink-0 mt-0.5 ${iconColor}`} />
                                    )}
                                  </div>
                                  <p className="text-[10px] text-[#A8B2B2] mt-1">
                                    {format(parseLocalDate(item.occurrenceDate), 'MMM d')}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
          </div>

        </div>
      </div>
    </div>
  );
}

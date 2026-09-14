import { endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { parseCalendarDate } from '../../mcp-server/src/calendar-date';

export { normalizeCalendarDate, parseCalendarDate, formatCalendarDate } from '../../mcp-server/src/calendar-date';

export type DueDateFilter = 'no-date' | 'overdue' | 'this-week' | 'this-month';

export function matchesDueDateFilter(targetDate: string | undefined, filter: DueDateFilter | null, now: Date): boolean {
  if (!filter) return true;
  if (filter === 'no-date') return !targetDate;
  if (!targetDate) return false;
  const date = parseCalendarDate(targetDate);
  if (!Number.isFinite(date.getTime())) return false;

  switch (filter) {
    case 'overdue':
      return date < startOfDay(now);
    case 'this-week':
      return date >= startOfWeek(now, { weekStartsOn: 1 }) && date <= endOfWeek(now, { weekStartsOn: 1 });
    case 'this-month':
      return date >= startOfMonth(now) && date <= endOfMonth(now);
  }
}

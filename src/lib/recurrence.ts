import { v4 as uuidv4 } from 'uuid';
import type { Card, RecurrenceConfig } from '@/types';
import { parseLocalDate } from '@/lib/utils';

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Active recurrence weeks are Monday–Sunday, matching the timeline. Weekday
// storage remains JavaScript's Sunday=0 convention; offsets are Monday=0.
function selectedWeekdayOffsets(config: RecurrenceConfig): number[] {
  return [...new Set((config.daysOfWeek ?? [])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .map((day) => (day + 6) % 7))].sort((a, b) => a - b);
}

function recurrenceInterval(config: RecurrenceConfig): number {
  return Number.isFinite(config.interval) ? Math.max(1, Math.floor(config.interval)) : 1;
}

// Count calendar dates, not elapsed local milliseconds (DST days need not be
// 24 hours). This allows seeking directly to a distant visible range.
function calendarDay(date: Date): number {
  const utc = new Date(0);
  utc.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor(utc.getTime() / 86_400_000);
}

export function getOccurrencesInRange(
  baseDateStr: string,
  config: RecurrenceConfig | undefined,
  rangeStart: Date,
  rangeEnd: Date
): string[] {
  const base = parseLocalDate(baseDateStr);
  const start = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate());
  const end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), rangeEnd.getDate());
  if (![base, start, end].every((date) => Number.isFinite(date.getTime())) || start > end || base > end) return [];
  if (!config) return base >= start ? [toDateString(base)] : [];

  const interval = recurrenceInterval(config);
  const results: string[] = [];
  const selectedDays = config.frequency === 'weekly' ? selectedWeekdayOffsets(config) : [];

  if (selectedDays.length) {
    // The assigned target remains the first occurrence, even when it is not a
    // selected weekday. Later dates use selected days in its active week, then
    // jump interval weeks. Every generated copy can anchor that same pattern.
    if (base >= start) results.push(toDateString(base));
    const week = new Date(base);
    week.setDate(week.getDate() - (week.getDay() + 6) % 7);
    const period = 7 * interval;
    const skipped = Math.max(0, Math.floor((calendarDay(start) - calendarDay(week)) / period));
    week.setDate(week.getDate() + skipped * period);
    while (week <= end) {
      for (const offset of selectedDays) {
        const candidate = new Date(week);
        candidate.setDate(candidate.getDate() + offset);
        if (candidate > base && candidate >= start && candidate <= end) results.push(toDateString(candidate));
      }
      week.setDate(week.getDate() + period);
    }
    return results;
  }

  if (config.frequency === 'monthly') {
    const targetDay = config.dayOfMonth || base.getDate();
    const monthsToStart = (start.getFullYear() - base.getFullYear()) * 12 + start.getMonth() - base.getMonth();
    let occurrence = Math.max(0, Math.floor(monthsToStart / interval));
    while (true) {
      const candidate = new Date(base);
      if (occurrence > 0) {
        candidate.setDate(1);
        candidate.setMonth(base.getMonth() + occurrence * interval);
        const lastDay = new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate();
        candidate.setDate(Math.min(targetDay, lastDay));
      }
      if (!Number.isFinite(candidate.getTime()) || candidate > end) break;
      if (candidate >= start) results.push(toDateString(candidate));
      occurrence++;
    }
    return results;
  }

  const period = (config.frequency === 'weekly' ? 7 : 1) * interval;
  const skipped = Math.max(0, Math.ceil((calendarDay(start) - calendarDay(base)) / period));
  const cursor = new Date(base);
  cursor.setDate(cursor.getDate() + skipped * period);
  while (cursor <= end) {
    if (cursor >= start) results.push(toDateString(cursor));
    cursor.setDate(cursor.getDate() + period);
  }
  return results;
}

export function calculateNextTargetDate(
  currentTargetDate: string | undefined,
  config: RecurrenceConfig
): string {
  const base = currentTargetDate ? parseLocalDate(currentTargetDate) : new Date();
  // Ensure we work with date only (no time component issues)
  base.setHours(12, 0, 0, 0);

  const interval = recurrenceInterval(config);

  switch (config.frequency) {
    case 'daily':
      base.setDate(base.getDate() + interval);
      break;

    case 'weekly': {
      const selectedDays = selectedWeekdayOffsets(config);
      if (selectedDays.length) {
        const currentDay = (base.getDay() + 6) % 7;
        const laterDay = selectedDays.find((day) => day > currentDay);
        const offset = laterDay === undefined
          ? 7 * interval - currentDay + selectedDays[0]
          : laterDay - currentDay;
        base.setDate(base.getDate() + offset);
      } else {
        base.setDate(base.getDate() + 7 * interval);
      }
      break;
    }

    case 'monthly': {
      const targetDay = config.dayOfMonth || base.getDate();
      // Reset before adding months so Jan 31 cannot overflow past February.
      base.setDate(1);
      base.setMonth(base.getMonth() + interval);
      // Clamp to last day of month if needed
      const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      base.setDate(Math.min(targetDay, lastDay));
      break;
    }
  }

  return toDateString(base);
}

export function createRecurringCardCopy(card: Card, columnId?: string): Card {
  const now = new Date().toISOString();
  const recurrence = card.recurrence ? structuredClone(card.recurrence) : undefined;
  // Preserve an implicit monthly anchor before a short month clamps the next
  // target. Undated cards retain their existing current-date fallback.
  if (recurrence?.frequency === 'monthly' && recurrence.dayOfMonth === undefined && card.targetDate) {
    const day = parseLocalDate(card.targetDate).getDate();
    if (Number.isFinite(day)) recurrence.dayOfMonth = day;
  }
  const nextDate = recurrence ? calculateNextTargetDate(card.targetDate, recurrence) : undefined;

  // Deep clone content and reset checklist items
  const content = structuredClone(card.content);
  if (content.type === 'checklist' && content.checklist) {
    content.checklist = content.checklist.map((item) => ({
      ...item,
      completed: false,
    }));
  }

  void columnId; // parameter reserved for future use

  return {
    id: uuidv4(),
    title: card.title,
    description: card.description,
    content,
    targetDate: nextDate,
    labels: card.labels ? [...card.labels] : undefined,
    coverImage: card.coverImage,
    attachments: card.attachments ? structuredClone(card.attachments) : undefined,
    recurrence,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function formatRecurrence(config: RecurrenceConfig): string {
  const { frequency, interval, daysOfWeek, dayOfMonth } = config;
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (frequency === 'daily') {
    return interval === 1 ? 'Daily' : `Every ${interval} days`;
  }

  if (frequency === 'weekly') {
    const base = interval === 1 ? 'Weekly' : `Every ${interval} weeks`;
    if (daysOfWeek && daysOfWeek.length > 0) {
      const days = [...daysOfWeek].sort((a, b) => a - b).map((d) => dayNames[d]).join(', ');
      return `${base} (${days})`;
    }
    return base;
  }

  if (frequency === 'monthly') {
    const base = interval === 1 ? 'Monthly' : `Every ${interval} months`;
    if (dayOfMonth) {
      const suffix = dayOfMonth === 1 || dayOfMonth === 21 || dayOfMonth === 31 ? 'st'
        : dayOfMonth === 2 || dayOfMonth === 22 ? 'nd'
        : dayOfMonth === 3 || dayOfMonth === 23 ? 'rd'
        : 'th';
      return `${base} on the ${dayOfMonth}${suffix}`;
    }
    return base;
  }

  return 'Recurring';
}

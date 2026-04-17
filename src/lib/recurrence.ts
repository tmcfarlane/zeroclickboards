import { v4 as uuidv4 } from 'uuid';
import type { Card, RecurrenceConfig } from '@/types';
import { parseLocalDate } from '@/lib/utils';

function toDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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

  if (!config) {
    return base >= start && base <= end ? [toDateString(base)] : [];
  }

  const interval = Math.max(1, config.interval || 1);
  const results: string[] = [];
  const safetyLimit = 500;

  if (config.frequency === 'weekly' && config.daysOfWeek && config.daysOfWeek.length > 0) {
    const cursor = new Date(base);
    let iterations = 0;
    while (cursor <= end && iterations < safetyLimit) {
      for (let i = 0; i < 7; i++) {
        const candidate = new Date(cursor);
        candidate.setDate(cursor.getDate() + i);
        if (candidate < base || candidate > end) continue;
        if (!config.daysOfWeek.includes(candidate.getDay())) continue;
        if (candidate >= start) results.push(toDateString(candidate));
      }
      cursor.setDate(cursor.getDate() + 7 * interval);
      iterations++;
    }
    return results;
  }

  const cursor = new Date(base);
  let iterations = 0;
  while (cursor <= end && iterations < safetyLimit) {
    if (cursor >= start) results.push(toDateString(cursor));
    switch (config.frequency) {
      case 'daily':
        cursor.setDate(cursor.getDate() + interval);
        break;
      case 'weekly':
        cursor.setDate(cursor.getDate() + 7 * interval);
        break;
      case 'monthly': {
        const targetDay = config.dayOfMonth || base.getDate();
        cursor.setDate(1);
        cursor.setMonth(cursor.getMonth() + interval);
        const lastDay = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        cursor.setDate(Math.min(targetDay, lastDay));
        break;
      }
    }
    iterations++;
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

  const interval = config.interval || 1;

  switch (config.frequency) {
    case 'daily':
      base.setDate(base.getDate() + interval);
      break;

    case 'weekly':
      if (config.daysOfWeek && config.daysOfWeek.length > 0) {
        // Find next matching day
        let found = false;
        for (let i = 1; i <= 7 * interval + 7; i++) {
          const candidate = new Date(base);
          candidate.setDate(candidate.getDate() + i);
          if (config.daysOfWeek.includes(candidate.getDay())) {
            base.setTime(candidate.getTime());
            found = true;
            break;
          }
        }
        if (!found) {
          base.setDate(base.getDate() + 7 * interval);
        }
      } else {
        base.setDate(base.getDate() + 7 * interval);
      }
      break;

    case 'monthly': {
      const targetDay = config.dayOfMonth || base.getDate();
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
  const nextDate = card.recurrence
    ? calculateNextTargetDate(card.targetDate, card.recurrence)
    : undefined;

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
    recurrence: card.recurrence ? { ...card.recurrence } : undefined,
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
      const days = daysOfWeek.sort().map((d) => dayNames[d]).join(', ');
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

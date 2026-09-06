import { randomUUID } from 'node:crypto';
import type { Card, RecurrenceConfig } from './types.js';

// Keep date-only values in local calendar time, matching the web app.
function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date(value);
}

function toDateString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Mirrors the web app's next-occurrence convention for recurring cards. */
export function calculateNextTargetDate(
  currentTargetDate: string | undefined,
  config: RecurrenceConfig,
): string {
  const base = currentTargetDate ? parseLocalDate(currentTargetDate) : new Date();
  base.setHours(12, 0, 0, 0);
  const interval = config.interval || 1;

  switch (config.frequency) {
    case 'daily':
      base.setDate(base.getDate() + interval);
      break;
    case 'weekly': {
      // The app selects the next matching weekday when explicit days are set.
      // A valid weekday must match within seven days; keep this search bounded.
      let next: Date | undefined;
      if (config.daysOfWeek?.length) {
        for (let offset = 1; offset <= 7; offset++) {
          const candidate = new Date(base);
          candidate.setDate(candidate.getDate() + offset);
          if (config.daysOfWeek.includes(candidate.getDay())) {
            next = candidate;
            break;
          }
        }
      }
      if (next) base.setTime(next.getTime());
      else base.setDate(base.getDate() + 7 * interval);
      break;
    }
    case 'monthly': {
      const targetDay = config.dayOfMonth || base.getDate();
      // Reset before adding months so Jan 31 cannot overflow past February.
      base.setDate(1);
      base.setMonth(base.getMonth() + interval);
      const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      base.setDate(Math.min(targetDay, lastDay));
      break;
    }
  }

  return toDateString(base);
}

/** Preserve card metadata while starting a fresh, unarchived occurrence. */
export function createRecurringCardCopy(card: Card): Card {
  const now = new Date().toISOString();
  const copy: Card = {
    ...structuredClone(card),
    id: randomUUID(),
    targetDate: card.recurrence
      ? calculateNextTargetDate(card.targetDate, card.recurrence)
      : undefined,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
  delete copy.archivedAt;
  if (copy.content.type === 'checklist' && copy.content.checklist) {
    for (const item of copy.content.checklist) item.completed = false;
  }
  return copy;
}

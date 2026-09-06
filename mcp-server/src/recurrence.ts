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

// Monday–Sunday active weeks match the web timeline; stored weekdays remain
// Sunday=0. A copy's target date stays within an active week, so no extra anchor
// field is needed to preserve multiweek cycles across successive archives.
function selectedWeekdayOffsets(config: RecurrenceConfig): number[] {
  return [...new Set((config.daysOfWeek ?? [])
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .map((day) => (day + 6) % 7))].sort((a, b) => a - b);
}

/** Mirrors the web app's next-occurrence convention for recurring cards. */
export function calculateNextTargetDate(
  currentTargetDate: string | undefined,
  config: RecurrenceConfig,
): string {
  const base = currentTargetDate ? parseLocalDate(currentTargetDate) : new Date();
  base.setHours(12, 0, 0, 0);
  const interval = Number.isFinite(config.interval) ? Math.max(1, Math.floor(config.interval)) : 1;

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
  // Pin the initial target's implicit monthly day before February (or another
  // short month) can change the recurrence anchor in the next archived copy.
  if (copy.recurrence?.frequency === 'monthly' && copy.recurrence.dayOfMonth === undefined && card.targetDate) {
    const day = parseLocalDate(card.targetDate).getDate();
    if (Number.isFinite(day)) copy.recurrence.dayOfMonth = day;
  }
  delete copy.archivedAt;
  if (copy.content.type === 'checklist' && copy.content.checklist) {
    for (const item of copy.content.checklist) item.completed = false;
  }
  return copy;
}

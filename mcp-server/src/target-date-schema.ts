import { z } from 'zod';
import { normalizeCalendarDate } from './calendar-date.js';

export const targetDateSchema = z.string()
  .refine((value) => normalizeCalendarDate(value) !== undefined, 'targetDate must be a real calendar date (YYYY-MM-DD) or a valid ISO timestamp; use null with set_target_date to clear it')
  .describe('Calendar due date, YYYY-MM-DD with a positive year of at least four digits. Valid ISO timestamps are normalized to their written calendar date, without timezone conversion.');

/** Validate before any database access, including calls made outside the protocol. */
export function parseTargetDate(value: unknown): string {
  return normalizeCalendarDate(targetDateSchema.parse(value))!;
}

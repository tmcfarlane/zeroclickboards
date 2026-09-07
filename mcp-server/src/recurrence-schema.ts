import { z } from 'zod';
import type { RecurrenceConfig } from './types.js';

const interval = () => z.number().int().min(1).max(99).describe('Repeat every 1–99 days, weeks, or months');

/** Share the protocol contract with direct mutation callers before any database request. */
export const recurrenceSchema = z.discriminatedUnion('frequency', [
  z.object({ frequency: z.literal('daily'), interval: interval() }).strict(),
  z.object({
    frequency: z.literal('weekly'),
    interval: interval(),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7)
      .refine((days) => new Set(days).size === days.length, 'daysOfWeek must contain unique weekdays')
      .optional()
      .describe('Unique weekdays, Sunday = 0 through Saturday = 6; omitted or empty uses the target weekday. Selected days repeat in Monday–Sunday weeks.'),
  }).strict(),
  z.object({
    frequency: z.literal('monthly'),
    interval: interval(),
    dayOfMonth: z.number().int().min(1).max(31).optional()
      .describe('Day of month, 1–31; omitted follows the initial target day. Shorter months use their last day.'),
  }).strict(),
]).describe('Daily, weekly, or monthly recurrence. Weekday selection is only valid for weekly; dayOfMonth is only valid for monthly.');

export function parseRecurrence(value: unknown): RecurrenceConfig {
  const recurrence = recurrenceSchema.parse(value);
  if (recurrence.frequency === 'weekly' && recurrence.daysOfWeek) {
    recurrence.daysOfWeek.sort((a, b) => a - b);
  }
  return recurrence;
}

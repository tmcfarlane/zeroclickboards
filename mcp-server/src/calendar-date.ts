// Target dates describe calendar days, not instants. Legacy ISO timestamps
// retain their written date even when their offset would cross midnight.
const calendarPattern = /^(\d{4,})-(\d{2})-(\d{2})(?:[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:[Zz]|([+-])(\d{2}):?(\d{2}))?)?$/;

/** Parse a real positive Gregorian date at local midnight, or return Invalid Date. */
export function parseCalendarDate(value: string): Date {
  const invalid = () => new Date(NaN);
  if (typeof value !== 'string') return invalid();
  const match = calendarPattern.exec(value);
  if (!match || match[0] !== value) return invalid();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isSafeInteger(year) || year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return invalid();
  if (match[4] !== undefined && (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6] ?? 0) > 59)) return invalid();
  if (match[7] !== undefined && (Number(match[8]) > 23 || Number(match[9]) > 59)) return invalid();

  // The multi-argument Date constructor interprets years 0–99 as 1900–1999.
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return invalid();
  return date;
}

/** Format a finite, positive local calendar date; early years stay zero-padded. */
export function formatCalendarDate(date: Date): string | undefined {
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1) return undefined;
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Validate a date or ISO timestamp and normalize it to its written calendar date. */
export function normalizeCalendarDate(value: string): string | undefined {
  return formatCalendarDate(parseCalendarDate(value));
}

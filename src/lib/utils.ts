import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Parse `YYYY-MM-DD` (from <input type="date">) as local midnight, not UTC.
// `new Date("2026-04-27")` and `parseISO("2026-04-27")` both interpret date-only
// strings as UTC, which shifts the calendar day in negative-offset timezones.
export function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  return new Date(value)
}

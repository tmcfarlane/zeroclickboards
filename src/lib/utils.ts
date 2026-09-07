import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { parseCalendarDate } from "./calendar-date"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Due dates represent calendar days. Use the same validation and local-date
// parsing for browser controls, timeline calculations, and MCP input.
export function parseLocalDate(value: string): Date {
  return parseCalendarDate(value)
}

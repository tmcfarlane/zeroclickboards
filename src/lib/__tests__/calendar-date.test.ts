import { describe, expect, it } from 'vitest';
import { matchesDueDateFilter } from '../calendar-date';

describe('board due-date filters', () => {
  const today = new Date(2026, 5, 3, 12); // Wednesday, in the browser's local calendar.

  it('keeps today out of overdue and includes it in the current week and month', () => {
    expect(matchesDueDateFilter('2026-06-02', 'overdue', today)).toBe(true);
    expect(matchesDueDateFilter('2026-06-03', 'overdue', today)).toBe(false);
    expect(matchesDueDateFilter('2026-06-04', 'overdue', today)).toBe(false);
    expect(matchesDueDateFilter('2026-06-03', 'this-week', today)).toBe(true);
    expect(matchesDueDateFilter('2026-06-03', 'this-month', today)).toBe(true);
  });

  it('uses the entire Monday-through-Sunday week, including earlier days', () => {
    expect(matchesDueDateFilter('2026-06-01', 'this-week', today)).toBe(true);
    expect(matchesDueDateFilter('2026-06-07', 'this-week', today)).toBe(true);
    expect(matchesDueDateFilter('2026-05-31', 'this-week', today)).toBe(false);
    expect(matchesDueDateFilter('2026-06-08', 'this-week', today)).toBe(false);
    expect(matchesDueDateFilter('2026-06-01', 'this-week', new Date(2026, 5, 7, 23))).toBe(true);
  });

  it('uses the full calendar month, including its first and last days', () => {
    expect(matchesDueDateFilter('2026-06-01', 'this-month', today)).toBe(true);
    expect(matchesDueDateFilter('2026-06-30', 'this-month', today)).toBe(true);
    expect(matchesDueDateFilter('2026-05-31', 'this-month', today)).toBe(false);
    expect(matchesDueDateFilter('2026-07-01', 'this-month', today)).toBe(false);
  });

  it('uses the written day for legacy ISO timestamps across a timezone boundary', () => {
    expect(matchesDueDateFilter('2026-06-03T00:30:00+14:00', 'overdue', today)).toBe(false);
    expect(matchesDueDateFilter('2026-06-07T23:30:00-08:00', 'this-week', today)).toBe(true);
    expect(matchesDueDateFilter('2026-06-30T23:30:00-08:00', 'this-month', today)).toBe(true);
  });

  it('keeps malformed dates visible unfiltered but excludes them from dated filters', () => {
    for (const value of ['not-a-date', '2026-02-31', '2026-06-03garbage']) {
      expect(matchesDueDateFilter(value, null, today)).toBe(true);
      for (const filter of ['overdue', 'this-week', 'this-month', 'no-date'] as const) {
        expect(matchesDueDateFilter(value, filter, today)).toBe(false);
      }
    }
    expect(matchesDueDateFilter(undefined, 'no-date', today)).toBe(true);
    expect(matchesDueDateFilter(undefined, 'this-week', today)).toBe(false);
  });

  it('keeps the whole week around a daylight-saving transition', () => {
    const afterTransition = new Date(2026, 2, 8, 12);
    expect(matchesDueDateFilter('2026-03-02', 'this-week', afterTransition)).toBe(true);
    expect(matchesDueDateFilter('2026-03-08', 'this-week', afterTransition)).toBe(true);
    expect(matchesDueDateFilter('2026-03-09', 'this-week', afterTransition)).toBe(false);
  });
});

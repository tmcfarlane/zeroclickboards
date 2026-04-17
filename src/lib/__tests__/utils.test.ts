import { describe, it, expect } from 'vitest';
import { cn, parseLocalDate } from '../utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    const hide = false;
    expect(cn('base', hide && 'hidden', 'extra')).toBe('base extra');
  });

  it('deduplicates tailwind conflicts', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2');
  });

  it('returns empty string for no input', () => {
    expect(cn()).toBe('');
  });
});

describe('parseLocalDate', () => {
  it('parses YYYY-MM-DD as local midnight', () => {
    const d = parseLocalDate('2026-04-15');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April = 3
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it('handles leap year date', () => {
    const d = parseLocalDate('2024-02-29');
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(29);
  });

  it('handles January 1st', () => {
    const d = parseLocalDate('2026-01-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  it('handles December 31st', () => {
    const d = parseLocalDate('2025-12-31');
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(11);
    expect(d.getDate()).toBe(31);
  });

  it('falls back to Date constructor for non-matching formats', () => {
    const d = parseLocalDate('2026-04-15T10:30:00Z');
    expect(d instanceof Date).toBe(true);
    expect(d.getFullYear()).toBe(2026);
  });
});

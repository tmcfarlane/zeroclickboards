import { describe, it, expect, vi } from 'vitest';
import {
  getOccurrencesInRange,
  calculateNextTargetDate,
  createRecurringCardCopy,
  formatRecurrence,
} from '../recurrence';
import type { Card, RecurrenceConfig } from '@/types';

// Mock uuid for deterministic IDs
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid'),
}));


const weeklyDateCases: [string, number, number[], string][] = [
  ['2026-04-06', 2, [1], '2026-04-20'],
  ['2026-04-06', 2, [1, 3, 5], '2026-04-08'],
  ['2026-04-10', 2, [1, 3, 5], '2026-04-20'],
  ['2026-04-12', 2, [0, 1], '2026-04-20'],
  ['2026-04-06', 2, [0, 1], '2026-04-12'],
  ['2026-04-10', 3, [1, 5], '2026-04-27'],
  ['2026-04-07', 2, [1, 3], '2026-04-08'],
  ['2026-04-09', 2, [1, 3], '2026-04-20'],
  ['2026-04-05', 2, [1, 3], '2026-04-13'],
  ['2026-12-31', 2, [1, 3], '2027-01-11'],
  ['2026-03-06', 2, [0, 5], '2026-03-08'],
  ['2026-03-08', 2, [0, 5], '2026-03-20'],
  ['2026-10-30', 2, [0, 5], '2026-11-01'],
  ['2026-11-01', 2, [0, 5], '2026-11-13'],
];

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('getOccurrencesInRange', () => {
  it('uses Monday–Sunday active weeks for every-two-week selected days', () => {
    const config: RecurrenceConfig = { frequency: 'weekly', interval: 2, daysOfWeek: [5, 1, 3, 1] };
    expect(getOccurrencesInRange('2026-04-06', config, new Date(2026, 3, 1), new Date(2026, 4, 5))).toEqual([
      '2026-04-06', '2026-04-08', '2026-04-10', '2026-04-20', '2026-04-22', '2026-04-24', '2026-05-04',
    ]);
    expect(config.daysOfWeek).toEqual([5, 1, 3, 1]);
  });

  it('shows an off-selected original target before future selected weekdays', () => {
    expect(getOccurrencesInRange('2026-04-07', { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] },
      new Date(2026, 3, 1), new Date(2026, 3, 23))).toEqual(['2026-04-07', '2026-04-08', '2026-04-20', '2026-04-22']);
    expect(getOccurrencesInRange('2026-04-09', { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] },
      new Date(2026, 3, 1), new Date(2026, 3, 23))).toEqual(['2026-04-09', '2026-04-20', '2026-04-22']);
  });

  it('keeps Sunday at the end of the same active week as Monday', () => {
    expect(getOccurrencesInRange('2026-04-06', { frequency: 'weekly', interval: 2, daysOfWeek: [0, 1] },
      new Date(2026, 3, 1), new Date(2026, 3, 30))).toEqual(['2026-04-06', '2026-04-12', '2026-04-20', '2026-04-26']);
  });

  it('keeps inclusive local dates across spring and fall DST boundaries', () => {
    for (const [first, start, end, expected] of [
      ['2026-03-06', new Date(2026, 2, 6), new Date(2026, 2, 22), ['2026-03-06', '2026-03-08', '2026-03-20', '2026-03-22']],
      ['2026-10-30', new Date(2026, 9, 30), new Date(2026, 10, 15), ['2026-10-30', '2026-11-01', '2026-11-13', '2026-11-15']],
    ] as const) {
      expect(getOccurrencesInRange(first, { frequency: 'weekly', interval: 2, daysOfWeek: [0, 5] }, start, end)).toEqual(expected);
    }
  });

  it('seeks to daily dates years after the series began without a 500-occurrence cutoff', () => {
    expect(getOccurrencesInRange('2020-01-01', { frequency: 'daily', interval: 1 },
      new Date(2026, 2, 7), new Date(2026, 2, 9))).toEqual(['2026-03-07', '2026-03-08', '2026-03-09']);
    expect(getOccurrencesInRange('2020-01-01', { frequency: 'daily', interval: 3 },
      new Date(2026, 2, 7), new Date(2026, 2, 9))).toEqual(['2026-03-09']);
  });

  it('does not silently truncate a requested range containing more than 500 dates', () => {
    const occurrences = getOccurrencesInRange('2026-01-01', { frequency: 'daily', interval: 1 },
      new Date(2026, 0, 1), new Date(2027, 7, 23));
    expect(occurrences).toHaveLength(600);
    expect(occurrences.at(-1)).toBe('2027-08-23');
  });

  it.each([undefined, [1, 3]])('seeks past 500 active weeks with selected days %s', (daysOfWeek) => {
    const start = new Date(2026, 0, 5);
    start.setDate(start.getDate() + 14 * 600);
    const end = new Date(start);
    end.setDate(end.getDate() + 3);
    const expected = [localDateString(start)];
    if (daysOfWeek) {
      const wednesday = new Date(start);
      wednesday.setDate(wednesday.getDate() + 2);
      expected.push(localDateString(wednesday));
    }
    expect(getOccurrencesInRange('2026-01-05', { frequency: 'weekly', interval: 2, daysOfWeek }, start, end)).toEqual(expected);
  });

  it('seeks directly to distant monthly dates while preserving month-end anchoring', () => {
    expect(getOccurrencesInRange('2000-01-31', { frequency: 'monthly', interval: 1, dayOfMonth: 31 },
      new Date(2070, 1, 1), new Date(2070, 3, 1))).toEqual(['2070-02-28', '2070-03-31']);
  });

  it('returns no selected occurrences when the visible range falls entirely in an inactive week', () => {
    expect(getOccurrencesInRange('2026-04-06', { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3, 5] },
      new Date(2026, 3, 13), new Date(2026, 3, 19))).toEqual([]);
  });

  it('matches repeated next dates for every weekday subset, including off-selected initial dates', () => {
    for (let mask = 1; mask < 128; mask++) {
      const daysOfWeek = Array.from({ length: 7 }, (_, day) => day).filter((day) => mask & (1 << day));
      for (const interval of [1, 2, 3]) {
        for (let weekday = 0; weekday < 7; weekday++) {
          const base = new Date(2026, 2, 2 + weekday);
          const end = new Date(2026, 3, 15);
          const config: RecurrenceConfig = { frequency: 'weekly', interval, daysOfWeek };
          const chain: string[] = [];
          let date = localDateString(base);
          while (date <= localDateString(end)) {
            chain.push(date);
            const next = calculateNextTargetDate(date, config);
            expect(next > date).toBe(true);
            date = next;
          }
          expect(getOccurrencesInRange(localDateString(base), config, base, end)).toEqual(chain);
        }
      }
    }
  });

  it('returns single date when no recurrence config', () => {
    const result = getOccurrencesInRange(
      '2026-04-15',
      undefined,
      new Date(2026, 3, 1),
      new Date(2026, 3, 30)
    );
    expect(result).toEqual(['2026-04-15']);
  });

  it('returns empty when base date is outside range and no recurrence', () => {
    const result = getOccurrencesInRange(
      '2026-05-15',
      undefined,
      new Date(2026, 3, 1),
      new Date(2026, 3, 30)
    );
    expect(result).toEqual([]);
  });

  it('generates daily occurrences', () => {
    const config: RecurrenceConfig = { frequency: 'daily', interval: 1 };
    const result = getOccurrencesInRange(
      '2026-04-10',
      config,
      new Date(2026, 3, 10),
      new Date(2026, 3, 13)
    );
    expect(result).toEqual(['2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13']);
  });

  it('generates daily occurrences with interval > 1', () => {
    const config: RecurrenceConfig = { frequency: 'daily', interval: 3 };
    const result = getOccurrencesInRange(
      '2026-04-01',
      config,
      new Date(2026, 3, 1),
      new Date(2026, 3, 10)
    );
    expect(result).toEqual(['2026-04-01', '2026-04-04', '2026-04-07', '2026-04-10']);
  });

  it('generates weekly occurrences', () => {
    const config: RecurrenceConfig = { frequency: 'weekly', interval: 1 };
    const result = getOccurrencesInRange(
      '2026-04-01',
      config,
      new Date(2026, 3, 1),
      new Date(2026, 3, 30)
    );
    expect(result).toEqual(['2026-04-01', '2026-04-08', '2026-04-15', '2026-04-22', '2026-04-29']);
  });

  it('generates weekly occurrences with specific days of week', () => {
    const config: RecurrenceConfig = { frequency: 'weekly', interval: 1, daysOfWeek: [1, 3] }; // Mon, Wed
    const result = getOccurrencesInRange(
      '2026-04-06', // Monday
      config,
      new Date(2026, 3, 6),
      new Date(2026, 3, 12)
    );
    // Apr 6 (Mon), Apr 8 (Wed)
    expect(result).toContain('2026-04-06');
    expect(result).toContain('2026-04-08');
  });

  it('generates monthly occurrences', () => {
    const config: RecurrenceConfig = { frequency: 'monthly', interval: 1 };
    const result = getOccurrencesInRange(
      '2026-01-15',
      config,
      new Date(2026, 0, 1),
      new Date(2026, 3, 30)
    );
    expect(result).toEqual(['2026-01-15', '2026-02-15', '2026-03-15', '2026-04-15']);
  });

  it('clamps monthly occurrences to last day of month', () => {
    const config: RecurrenceConfig = { frequency: 'monthly', interval: 1, dayOfMonth: 31 };
    const result = getOccurrencesInRange(
      '2026-01-31',
      config,
      new Date(2026, 0, 1),
      new Date(2026, 2, 31)
    );
    expect(result).toContain('2026-01-31');
    expect(result).toContain('2026-02-28');
    expect(result).toContain('2026-03-31');
  });

  it('returns empty for range before base date', () => {
    const config: RecurrenceConfig = { frequency: 'daily', interval: 1 };
    const result = getOccurrencesInRange(
      '2026-05-01',
      config,
      new Date(2026, 3, 1),
      new Date(2026, 3, 30)
    );
    expect(result).toEqual([]);
  });
});

describe('calculateNextTargetDate', () => {
  it.each(weeklyDateCases)('advances %s with interval %s and weekdays %s to %s', (date, interval, daysOfWeek, expected) => {
    expect(calculateNextTargetDate(date, { frequency: 'weekly', interval, daysOfWeek })).toBe(expected);
  });

  it('advances daily by 1', () => {
    const result = calculateNextTargetDate('2026-04-15', { frequency: 'daily', interval: 1 });
    expect(result).toBe('2026-04-16');
  });

  it('advances daily by interval', () => {
    const result = calculateNextTargetDate('2026-04-15', { frequency: 'daily', interval: 3 });
    expect(result).toBe('2026-04-18');
  });

  it('advances weekly by 1', () => {
    const result = calculateNextTargetDate('2026-04-15', { frequency: 'weekly', interval: 1 });
    expect(result).toBe('2026-04-22');
  });

  it('advances weekly with daysOfWeek', () => {
    // Apr 15, 2026 is Wednesday (day 3). If daysOfWeek=[5] (Fri), next should be Apr 17
    const result = calculateNextTargetDate('2026-04-15', {
      frequency: 'weekly',
      interval: 1,
      daysOfWeek: [5],
    });
    expect(result).toBe('2026-04-17');
  });

  it('advances monthly by 1', () => {
    const result = calculateNextTargetDate('2026-04-15', { frequency: 'monthly', interval: 1 });
    expect(result).toBe('2026-05-15');
  });

  it.each([
    ['2026-01-31', 1, undefined, '2026-02-28'],
    ['2026-01-31', 1, 31, '2026-02-28'],
    ['2028-01-31', 1, 31, '2028-02-29'],
    ['2026-01-31', 3, 31, '2026-04-30'],
    ['2026-12-31', 2, 31, '2027-02-28'],
    ['2026-02-28', 1, 31, '2026-03-31'],
  ])('clamps monthly %s + %s month(s) to the intended month', (date, interval, dayOfMonth, expected) => {
    expect(calculateNextTargetDate(date, { frequency: 'monthly', interval, dayOfMonth })).toBe(expected);
  });

  it('advances monthly by interval > 1', () => {
    const result = calculateNextTargetDate('2026-01-15', { frequency: 'monthly', interval: 3 });
    expect(result).toBe('2026-04-15');
  });
});

describe('createRecurringCardCopy', () => {
  it.each([
    ['2026-01-31', 1, ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']],
    ['2028-01-31', 1, ['2028-01-31', '2028-02-29', '2028-03-31', '2028-04-30', '2028-05-31']],
    ['2026-01-30', 1, ['2026-01-30', '2026-02-28', '2026-03-30', '2026-04-30', '2026-05-30']],
    ['2026-01-31', 3, ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31', '2027-01-31']],
  ] as const)('keeps monthly copy chains from %s at interval %s aligned with the timeline', (targetDate, interval, expected) => {
    const original: Card = { id: 'monthly', title: 'Monthly', content: { type: 'text', text: '' }, targetDate,
      recurrence: { frequency: 'monthly', interval }, createdAt: '', updatedAt: '' };
    let card = original;
    const chain = [targetDate as string];
    for (let index = 1; index < expected.length; index++) {
      card = createRecurringCardCopy(card);
      chain.push(card.targetDate!);
      expect(card.recurrence?.dayOfMonth).toBe(Number(targetDate.slice(8, 10)));
    }
    expect(original.recurrence).toEqual({ frequency: 'monthly', interval });
    expect(chain).toEqual(expected);
    const [startYear, startMonth, startDay] = targetDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = expected.at(-1)!.split('-').map(Number);
    expect(getOccurrencesInRange(targetDate, original.recurrence, new Date(startYear, startMonth - 1, startDay),
      new Date(endYear, endMonth - 1, endDay))).toEqual(chain);
  });

  it('retains the current-date fallback for a monthly card without an initial target', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 12));
    try {
      const card: Card = { id: 'undated', title: 'Undated', content: { type: 'text', text: '' },
        recurrence: { frequency: 'monthly', interval: 1 }, createdAt: '', updatedAt: '' };
      const copy = createRecurringCardCopy(card);
      expect(copy.targetDate).toBe('2026-02-28');
      expect(copy.recurrence?.dayOfMonth).toBeUndefined();
      expect(card.targetDate).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps archived-copy dates and timeline projections in the same active weeks', () => {
    let card: Card = {
      id: 'series', title: 'Twice per active week', content: { type: 'text', text: '' }, targetDate: '2026-04-07',
      recurrence: { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] }, createdAt: '', updatedAt: '',
    };
    const chain = [card.targetDate!];
    for (let i = 0; i < 5; i++) {
      card = createRecurringCardCopy({ ...card, isArchived: true });
      chain.push(card.targetDate!);
      expect(card.isArchived).toBe(false);
    }
    expect(chain).toEqual(['2026-04-07', '2026-04-08', '2026-04-20', '2026-04-22', '2026-05-04', '2026-05-06']);
    expect(getOccurrencesInRange(chain[0], card.recurrence, new Date(2026, 3, 1), new Date(2026, 4, 6))).toEqual(chain);
    expect(getOccurrencesInRange(chain[2], card.recurrence, new Date(2026, 3, 1), new Date(2026, 4, 6))).toEqual(chain.slice(2));
  });

  it('does not share the selected-weekdays array between recurring copies', () => {
    const card: Card = { id: 'series', title: 'Weekly', content: { type: 'text', text: '' }, targetDate: '2026-04-06',
      recurrence: { frequency: 'weekly', interval: 2, daysOfWeek: [1, 3] }, createdAt: '', updatedAt: '' };
    const copy = createRecurringCardCopy(card);
    copy.recurrence!.daysOfWeek!.push(5);
    expect(card.recurrence!.daysOfWeek).toEqual([1, 3]);
  });

  it('creates a copy with new ID and advanced date', () => {
    const card: Card = {
      id: 'original-id',
      title: 'Test Card',
      content: { type: 'text', text: 'hello' },
      targetDate: '2026-04-15',
      recurrence: { frequency: 'daily', interval: 1 },
      createdAt: '2026-04-14T00:00:00Z',
      updatedAt: '2026-04-14T00:00:00Z',
    };

    const copy = createRecurringCardCopy(card);

    expect(copy.id).toBe('test-uuid');
    expect(copy.id).not.toBe(card.id);
    expect(copy.title).toBe('Test Card');
    expect(copy.targetDate).toBe('2026-04-16');
    expect(copy.isArchived).toBe(false);
  });

  it('resets checklist items to uncompleted', () => {
    const card: Card = {
      id: 'original-id',
      title: 'Checklist Card',
      content: {
        type: 'checklist',
        checklist: [
          { id: '1', text: 'Item 1', completed: true },
          { id: '2', text: 'Item 2', completed: true },
        ],
      },
      recurrence: { frequency: 'daily', interval: 1 },
      createdAt: '2026-04-14T00:00:00Z',
      updatedAt: '2026-04-14T00:00:00Z',
    };

    const copy = createRecurringCardCopy(card);

    expect(copy.content.checklist).toBeDefined();
    expect(copy.content.checklist!.every(item => item.completed === false)).toBe(true);
  });

  it('preserves labels', () => {
    const card: Card = {
      id: 'original-id',
      title: 'Labeled Card',
      content: { type: 'text', text: '' },
      labels: ['red', 'blue'],
      recurrence: { frequency: 'weekly', interval: 1 },
      createdAt: '2026-04-14T00:00:00Z',
      updatedAt: '2026-04-14T00:00:00Z',
    };

    const copy = createRecurringCardCopy(card);
    expect(copy.labels).toEqual(['red', 'blue']);
    // Ensure it's a new array, not same reference
    expect(copy.labels).not.toBe(card.labels);
  });
});

describe('formatRecurrence', () => {
  it('formats selected weekdays without mutating their stored order', () => {
    const config: RecurrenceConfig = { frequency: 'weekly', interval: 2, daysOfWeek: [5, 1, 3] };
    expect(formatRecurrence(config)).toBe('Every 2 weeks (Mon, Wed, Fri)');
    expect(config.daysOfWeek).toEqual([5, 1, 3]);
  });

  it('formats daily interval 1', () => {
    expect(formatRecurrence({ frequency: 'daily', interval: 1 })).toBe('Daily');
  });

  it('formats daily interval > 1', () => {
    expect(formatRecurrence({ frequency: 'daily', interval: 3 })).toBe('Every 3 days');
  });

  it('formats weekly interval 1', () => {
    expect(formatRecurrence({ frequency: 'weekly', interval: 1 })).toBe('Weekly');
  });

  it('formats weekly with days of week', () => {
    const result = formatRecurrence({ frequency: 'weekly', interval: 1, daysOfWeek: [1, 3, 5] });
    expect(result).toBe('Weekly (Mon, Wed, Fri)');
  });

  it('formats weekly interval > 1', () => {
    expect(formatRecurrence({ frequency: 'weekly', interval: 2 })).toBe('Every 2 weeks');
  });

  it('formats monthly interval 1', () => {
    expect(formatRecurrence({ frequency: 'monthly', interval: 1 })).toBe('Monthly');
  });

  it('formats monthly with day of month', () => {
    expect(formatRecurrence({ frequency: 'monthly', interval: 1, dayOfMonth: 15 })).toBe('Monthly on the 15th');
  });

  it('formats monthly with 1st suffix', () => {
    expect(formatRecurrence({ frequency: 'monthly', interval: 1, dayOfMonth: 1 })).toBe('Monthly on the 1st');
  });

  it('formats monthly with 2nd suffix', () => {
    expect(formatRecurrence({ frequency: 'monthly', interval: 1, dayOfMonth: 2 })).toBe('Monthly on the 2nd');
  });

  it('formats monthly with 3rd suffix', () => {
    expect(formatRecurrence({ frequency: 'monthly', interval: 1, dayOfMonth: 3 })).toBe('Monthly on the 3rd');
  });

  it('formats monthly interval > 1', () => {
    expect(formatRecurrence({ frequency: 'monthly', interval: 2 })).toBe('Every 2 months');
  });
});

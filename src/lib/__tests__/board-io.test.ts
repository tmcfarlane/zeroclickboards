import { describe, it, expect, vi } from 'vitest';
import {
  exportBoardToJSON,
  validateBoardJSON,
  importBoardFromJSON,
  type ZeroBoardExport,
} from '../board-io';
import type { Board } from '@/types';
import { v4 as uuidv4 } from 'uuid';

vi.mock('uuid', () => {
  let counter = 0;
  return {
    v4: vi.fn(() => `uuid-${++counter}`),
  };
});

function makeSampleBoard(): Board {
  return {
    id: 'board-1',
    name: 'Test Board',
    description: 'A test board',
    columns: [
      {
        id: 'col-1',
        title: 'To Do',
        order: 0,
        cards: [
          {
            id: 'card-1',
            title: 'Test Card',
            description: 'Card desc',
            content: {
              type: 'checklist',
              checklist: [
                { id: 'cl-1', text: 'Item 1', completed: true },
                { id: 'cl-2', text: 'Item 2', completed: false },
              ],
            },
            targetDate: '2026-04-15',
            labels: ['red', 'blue'],
            coverImage: 'https://example.com/img.png',
            attachments: [
              { id: 'att-1', name: 'file.pdf', url: 'https://example.com/file.pdf', addedAt: '2026-04-14T00:00:00Z' },
            ],
            recurrence: { frequency: 'daily', interval: 1 },
            isArchived: false,
            createdAt: '2026-04-14T00:00:00Z',
            updatedAt: '2026-04-14T00:00:00Z',
          },
        ],
      },
      {
        id: 'col-2',
        title: 'Done',
        order: 1,
        cards: [],
      },
    ],
    createdAt: '2026-04-14T00:00:00Z',
    updatedAt: '2026-04-14T00:00:00Z',
  };
}

describe('exportBoardToJSON', () => {
  it('produces valid JSON with format and version', () => {
    const board = makeSampleBoard();
    const json = exportBoardToJSON(board);
    const parsed = JSON.parse(json);

    expect(parsed.format).toBe('zeroboard');
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toBeDefined();
    expect(parsed.board.name).toBe('Test Board');
    expect(parsed.board.description).toBe('A test board');
  });

  it('strips internal IDs from checklist items', () => {
    const board = makeSampleBoard();
    const json = exportBoardToJSON(board);
    const parsed = JSON.parse(json);
    const checklist = parsed.board.columns[0].cards[0].content.checklist;

    expect(checklist[0].id).toBe('');
    expect(checklist[0].text).toBe('Item 1');
    expect(checklist[0].completed).toBe(true);
  });

  it('includes attachments without internal IDs', () => {
    const board = makeSampleBoard();
    const json = exportBoardToJSON(board);
    const parsed = JSON.parse(json);
    const att = parsed.board.columns[0].cards[0].attachments[0];

    expect(att.name).toBe('file.pdf');
    expect(att.url).toBe('https://example.com/file.pdf');
    expect(att.id).toBeUndefined();
  });

  it('includes recurrence config', () => {
    const board = makeSampleBoard();
    const json = exportBoardToJSON(board);
    const parsed = JSON.parse(json);
    expect(parsed.board.columns[0].cards[0].recurrence).toEqual({ frequency: 'daily', interval: 1 });
  });
});

describe('validateBoardJSON', () => {
  function makeValidExport(): ZeroBoardExport {
    return {
      format: 'zeroboard',
      version: 1,
      exportedAt: '2026-04-14T00:00:00Z',
      board: {
        name: 'Test',
        columns: [
          {
            title: 'Col 1',
            order: 0,
            cards: [
              {
                title: 'Card 1',
                content: { type: 'text', text: 'hello' },
              },
            ],
          },
        ],
      },
    };
  }

  it('accepts valid export data', () => {
    const result = validateBoardJSON(makeValidExport());
    expect(result.valid).toBe(true);
  });

  it('rejects non-object', () => {
    const result = validateBoardJSON('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects wrong format', () => {
    const data = { ...makeValidExport(), format: 'other' };
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('Not a ZeroBoard');
  });

  it('rejects unsupported version', () => {
    const data = { ...makeValidExport(), version: 99 };
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('newer than supported');
  });

  it('rejects missing board name', () => {
    const data = makeValidExport();
    (data.board as Record<string, unknown>).name = '';
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
  });

  it('rejects invalid content type', () => {
    const data = makeValidExport();
    (data.board.columns[0].cards[0].content as unknown as Record<string, unknown>).type = 'invalid';
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('invalid content type');
  });

  it('rejects invalid label', () => {
    const data = makeValidExport();
    data.board.columns[0].cards[0].labels = ['red', 'neon' as never];
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain('invalid label');
  });

  it('rejects missing columns array', () => {
    const data = makeValidExport();
    (data.board as Record<string, unknown>).columns = 'not-array';
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
  });

  it('rejects card without title', () => {
    const data = makeValidExport();
    (data.board.columns[0].cards[0] as unknown as Record<string, unknown>).title = 123;
    const result = validateBoardJSON(data);
    expect(result.valid).toBe(false);
  });
});

describe('importBoardFromJSON', () => {
  it('rejects a recurrence that would create a backwards occurrence before generating any imported cards', () => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    payload.board.columns[1].cards.push({
      title: 'Backwards schedule', content: { type: 'text', text: 'Keep this body' }, targetDate: '2026-01-31',
      recurrence: { frequency: 'monthly', interval: 1, dayOfMonth: -1 },
    });
    const before = structuredClone(payload);
    const idsBefore = vi.mocked(uuidv4).mock.calls.length;
    expect(validateBoardJSON(payload)).toEqual({
      valid: false,
      error: 'Column "Done", card "Backwards schedule": invalid recurrence. Use a daily, weekly, or monthly schedule with an interval from 1 to 99 and valid day selections.',
    });
    expect(() => importBoardFromJSON(payload)).toThrow('invalid recurrence');
    expect(vi.mocked(uuidv4).mock.calls).toHaveLength(idsBefore);
    expect(payload).toEqual(before);
  });

  it.each([
    {}, { frequency: 'yearly', interval: 1 },
    { frequency: 'daily', interval: 0 }, { frequency: 'daily', interval: 100 }, { frequency: 'daily', interval: 1.5 },
    { frequency: 'daily', interval: 1, daysOfWeek: [] },
    { frequency: 'weekly', interval: 1, dayOfMonth: 1 },
    { frequency: 'weekly', interval: 1, daysOfWeek: [1, 1] },
    { frequency: 'weekly', interval: 1, daysOfWeek: [7] },
    { frequency: 'monthly', interval: 1, daysOfWeek: [1] },
    { frequency: 'monthly', interval: 1, dayOfMonth: 32 },
    { frequency: 'monthly', interval: 1, dayOfMonth: 1.5 },
    { frequency: 'monthly', interval: 1, dayOfMonth: '1' },
    { frequency: 'daily', interval: 1, unsupported: true },
    'daily', false,
  ])('rejects imported schedules outside the shared recurrence contract: %j', (recurrence) => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    payload.board.columns[0].cards[0].recurrence = recurrence;
    const validation = validateBoardJSON(payload);
    expect(validation.valid).toBe(false);
    if (!validation.valid) expect(validation.error).toContain('Column "To Do", card "Test Card": invalid recurrence');
    expect(() => importBoardFromJSON(payload)).toThrow('invalid recurrence');
  });

  it('normalizes valid imported weekdays without mutating the source schedule or other fields', () => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    payload.board.columns[0].cards[0].recurrence = { frequency: 'weekly', interval: 2, daysOfWeek: [5, 0, 3] };
    const before = structuredClone(payload);
    expect(validateBoardJSON(payload).valid).toBe(true);
    const imported = importBoardFromJSON(payload).columns[0].cards[0];
    expect(imported.recurrence).toEqual({ frequency: 'weekly', interval: 2, daysOfWeek: [0, 3, 5] });
    expect(imported.description).toBe('Card desc');
    expect(imported.targetDate).toBe('2026-04-15');
    expect(imported.content.checklist?.map((item) => item.completed)).toEqual([true, false]);
    expect(payload).toEqual(before);
  });

  it.each([
    { frequency: 'daily', interval: 99 },
    { frequency: 'weekly', interval: 1 },
    { frequency: 'weekly', interval: 1, daysOfWeek: [] },
    { frequency: 'monthly', interval: 1 },
    { frequency: 'monthly', interval: 1, dayOfMonth: 31 },
  ])('preserves valid optional recurrence selections: %j', (recurrence) => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    payload.board.columns[0].cards[0].recurrence = recurrence;
    expect(importBoardFromJSON(payload).columns[0].cards[0].recurrence).toEqual(recurrence);
  });

  it.each([undefined, null])('treats omitted or null imported recurrence as no schedule: %s', (recurrence) => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    if (recurrence === undefined) delete payload.board.columns[0].cards[0].recurrence;
    else payload.board.columns[0].cards[0].recurrence = null;
    expect(validateBoardJSON(payload).valid).toBe(true);
    expect(importBoardFromJSON(payload).columns[0].cards[0]).not.toHaveProperty('recurrence');
  });

  it.each(['not-a-date', '2026-02-31', '2026-13-01', '2026-04-15garbage', '2026-04-15T25:00:00Z', 123])('rejects an invalid imported due date before creating cards: %s', (date) => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    payload.board.columns[0].cards[0].targetDate = date;
    const validation = validateBoardJSON(payload);
    expect(validation).toEqual({ valid: false, error: 'Column "To Do", card "Test Card": invalid due date. Use a real calendar date such as 2026-06-03.' });
    expect(() => importBoardFromJSON(payload)).toThrow('invalid due date');
  });

  it.each(['2024-02-29T23:30:00-08:00', '0099-12-31'])('normalizes a valid imported calendar date without changing its day: %s', (date) => {
    const payload = JSON.parse(exportBoardToJSON(makeSampleBoard()));
    payload.board.columns[0].cards[0].targetDate = date;
    expect(validateBoardJSON(payload).valid).toBe(true);
    const imported = importBoardFromJSON(payload);
    expect(imported.columns[0].cards[0].targetDate).toBe(date.split('T')[0]);
    expect(payload.board.columns[0].cards[0].targetDate).toBe(date);
  });

  it('generates new IDs for columns and cards', () => {
    const payload: ZeroBoardExport = {
      format: 'zeroboard',
      version: 1,
      exportedAt: '2026-04-14T00:00:00Z',
      board: {
        name: 'Imported',
        description: 'desc',
        columns: [
          {
            title: 'Col',
            order: 0,
            cards: [
              { title: 'Card', content: { type: 'text', text: 'hi' } },
            ],
          },
        ],
      },
    };

    const result = importBoardFromJSON(payload);

    expect(result.name).toBe('Imported');
    expect(result.description).toBe('desc');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].id).toMatch(/^uuid-/);
    expect(result.columns[0].cards[0].id).toMatch(/^uuid-/);
  });

  it('rebuilds checklist item IDs', () => {
    const payload: ZeroBoardExport = {
      format: 'zeroboard',
      version: 1,
      exportedAt: '2026-04-14T00:00:00Z',
      board: {
        name: 'Test',
        columns: [
          {
            title: 'Col',
            order: 0,
            cards: [
              {
                title: 'Card',
                content: {
                  type: 'checklist',
                  checklist: [
                    { id: '', text: 'Item 1', completed: false },
                    { id: '', text: 'Item 2', completed: true },
                  ],
                },
              },
            ],
          },
        ],
      },
    };

    const result = importBoardFromJSON(payload);
    const checklist = result.columns[0].cards[0].content.checklist!;

    expect(checklist).toHaveLength(2);
    expect(checklist[0].id).toMatch(/^uuid-/);
    expect(checklist[0].text).toBe('Item 1');
    expect(checklist[1].completed).toBe(true);
  });

  it('preserves optional fields (labels, targetDate, recurrence)', () => {
    const payload: ZeroBoardExport = {
      format: 'zeroboard',
      version: 1,
      exportedAt: '2026-04-14T00:00:00Z',
      board: {
        name: 'Test',
        columns: [
          {
            title: 'Col',
            order: 0,
            cards: [
              {
                title: 'Card',
                content: { type: 'text', text: '' },
                labels: ['red'],
                targetDate: '2026-05-01',
                recurrence: { frequency: 'weekly', interval: 2 },
              },
            ],
          },
        ],
      },
    };

    const result = importBoardFromJSON(payload);
    const card = result.columns[0].cards[0];

    expect(card.labels).toEqual(['red']);
    expect(card.targetDate).toBe('2026-05-01');
    expect(card.recurrence).toEqual({ frequency: 'weekly', interval: 2 });
  });
});

describe('round-trip export → validate → import', () => {
  it('preserves board data through export and re-import', () => {
    const board = makeSampleBoard();
    const json = exportBoardToJSON(board);
    const parsed = JSON.parse(json);

    const validation = validateBoardJSON(parsed);
    expect(validation.valid).toBe(true);
    if (!validation.valid) return;

    const imported = importBoardFromJSON(validation.payload);

    expect(imported.name).toBe(board.name);
    expect(imported.description).toBe(board.description);
    expect(imported.columns).toHaveLength(board.columns.length);
    expect(imported.columns[0].title).toBe(board.columns[0].title);
    expect(imported.columns[0].cards).toHaveLength(board.columns[0].cards.length);
    expect(imported.columns[0].cards[0].title).toBe(board.columns[0].cards[0].title);
    expect(imported.columns[0].cards[0].content.checklist).toHaveLength(2);
    expect(imported.columns[0].cards[0].labels).toEqual(['red', 'blue']);
  });
});

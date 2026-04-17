import { describe, it, expect, vi } from 'vitest';
import {
  exportBoardToJSON,
  validateBoardJSON,
  importBoardFromJSON,
  type ZeroBoardExport,
} from '../board-io';
import type { Board } from '@/types';

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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatCardAsInstructions, formatColumnAsInstructions, sendToClaude } from '../claude';
import type { Card, Column } from '@/types';

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: '1',
    title: 'Test Card',
    content: { type: 'text', text: '' },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('formatCardAsInstructions', () => {
  it('formats a minimal card with title only', () => {
    const result = formatCardAsInstructions(makeCard());
    expect(result).toBe('## Test Card\n');
  });

  it('includes description when present', () => {
    const result = formatCardAsInstructions(makeCard({ description: 'A description' }));
    expect(result).toContain('A description');
  });

  it('includes text content', () => {
    const result = formatCardAsInstructions(makeCard({ content: { type: 'text', text: 'Some notes' } }));
    expect(result).toContain('Some notes');
  });

  it('formats checklist content with completion status', () => {
    const card = makeCard({
      content: {
        type: 'checklist',
        checklist: [
          { id: '1', text: 'Done item', completed: true },
          { id: '2', text: 'Open item', completed: false },
        ],
      },
    });
    const result = formatCardAsInstructions(card);
    expect(result).toContain('- [x] Done item');
    expect(result).toContain('- [ ] Open item');
    expect(result).toContain('Checklist:');
  });

  it('includes target date', () => {
    const result = formatCardAsInstructions(makeCard({ targetDate: '2026-04-15' }));
    expect(result).toContain('Due: 2026-04-15');
  });

  it('includes labels', () => {
    const result = formatCardAsInstructions(makeCard({ labels: ['red', 'blue'] }));
    expect(result).toContain('Labels: red, blue');
  });

  it('handles a fully populated card', () => {
    const card = makeCard({
      title: 'Full Card',
      description: 'Desc',
      content: { type: 'text', text: 'Body' },
      targetDate: '2026-05-01',
      labels: ['green'],
    });
    const result = formatCardAsInstructions(card);
    expect(result).toContain('## Full Card');
    expect(result).toContain('Desc');
    expect(result).toContain('Body');
    expect(result).toContain('Due: 2026-05-01');
    expect(result).toContain('Labels: green');
  });
});

describe('formatColumnAsInstructions', () => {
  it('formats column with cards', () => {
    const column: Column = {
      id: 'col1',
      title: 'To Do',
      cards: [makeCard({ title: 'Card A' }), makeCard({ title: 'Card B' })],
    };
    const result = formatColumnAsInstructions(column);
    expect(result).toContain('# Column: To Do');
    expect(result).toContain('2 cards:');
    expect(result).toContain('## Card A');
    expect(result).toContain('## Card B');
  });

  it('excludes archived cards from count and output', () => {
    const column: Column = {
      id: 'col1',
      title: 'Done',
      cards: [
        makeCard({ title: 'Active' }),
        makeCard({ title: 'Archived', isArchived: true }),
      ],
    };
    const result = formatColumnAsInstructions(column);
    expect(result).toContain('1 cards:');
    expect(result).toContain('## Active');
    expect(result).not.toContain('## Archived');
  });

  it('handles empty column', () => {
    const column: Column = { id: 'col1', title: 'Empty', cards: [] };
    const result = formatColumnAsInstructions(column);
    expect(result).toContain('0 cards:');
  });
});

describe('sendToClaude', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends instructions and returns response on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ response: 'AI reply' }),
    }));

    const result = await sendToClaude('Do something');
    expect(result).toEqual({ response: 'AI reply' });
    expect(fetch).toHaveBeenCalledWith('/api/local/claude', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instructions: 'Do something' }),
    });
  });

  it('returns error message on non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Rate limited' }),
    }));

    const result = await sendToClaude('Do something');
    expect(result).toEqual({ error: 'Rate limited' });
  });

  it('returns connection error on fetch failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

    const result = await sendToClaude('Do something');
    expect(result.error).toContain('Could not connect');
  });
});

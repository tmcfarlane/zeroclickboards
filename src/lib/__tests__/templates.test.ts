import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BUILT_IN_BOARD_TEMPLATES,
  BUILT_IN_CARD_TEMPLATES,
  templateToColumns,
  templateCardToCard,
  boardToTemplate,
  cardToTemplate,
  getUserBoardTemplates,
  saveUserBoardTemplate,
  deleteUserBoardTemplate,
  getUserCardTemplates,
  saveUserCardTemplate,
  deleteUserCardTemplate,
  getAllBoardTemplates,
  getAllCardTemplates,
} from '../templates';
import type { Card, Column } from '@/types';

vi.mock('uuid', () => {
  let counter = 0;
  return {
    v4: vi.fn(() => `tmpl-uuid-${++counter}`),
  };
});

beforeEach(() => {
  localStorage.clear();
});

describe('built-in templates', () => {
  it('has at least one board template', () => {
    expect(BUILT_IN_BOARD_TEMPLATES.length).toBeGreaterThanOrEqual(1);
  });

  it('has at least one card template', () => {
    expect(BUILT_IN_CARD_TEMPLATES.length).toBeGreaterThanOrEqual(1);
  });

  it('all board templates have required fields', () => {
    for (const t of BUILT_IN_BOARD_TEMPLATES) {
      expect(t.id).toBeDefined();
      expect(t.name).toBeTruthy();
      expect(t.category).toBe('built-in');
      expect(t.columns.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('all card templates have required fields', () => {
    for (const t of BUILT_IN_CARD_TEMPLATES) {
      expect(t.id).toBeDefined();
      expect(t.name).toBeTruthy();
      expect(t.category).toBe('built-in');
      expect(t.card.title).toBeTruthy();
      expect(t.card.content).toBeDefined();
    }
  });
});

describe('templateToColumns', () => {
  it('generates columns with UUIDs and correct order', () => {
    const template = BUILT_IN_BOARD_TEMPLATES[0]; // Simple Kanban
    const columns = templateToColumns(template);

    expect(columns.length).toBe(template.columns.length);
    columns.forEach((col, i) => {
      expect(col.id).toMatch(/^tmpl-uuid-/);
      expect(col.order).toBe(i);
      expect(col.title).toBe(template.columns[i].title);
      expect(Array.isArray(col.cards)).toBe(true);
    });
  });

  it('includes sample cards when template has them', () => {
    const bugTracker = BUILT_IN_BOARD_TEMPLATES.find(t => t.id === 'builtin-bug-tracker')!;
    const columns = templateToColumns(bugTracker);
    const newCol = columns.find(c => c.title === 'New')!;
    expect(newCol.cards.length).toBeGreaterThanOrEqual(1);
    expect(newCol.cards[0].title).toContain('Example');
  });
});

describe('templateCardToCard', () => {
  it('generates a card with new ID', () => {
    const templateCard = BUILT_IN_CARD_TEMPLATES[0].card;
    const card = templateCardToCard(templateCard);

    expect(card.id).toMatch(/^tmpl-uuid-/);
    expect(card.title).toBe(templateCard.title);
    expect(card.isArchived).toBe(false);
    expect(card.createdAt).toBeDefined();
    expect(card.updatedAt).toBeDefined();
  });

  it('deep clones content', () => {
    const templateCard = BUILT_IN_CARD_TEMPLATES[0].card;
    const card = templateCardToCard(templateCard);

    expect(card.content).not.toBe(templateCard.content);
    expect(card.content).toEqual(templateCard.content);
  });

  it('copies labels as new array', () => {
    const templateCard = BUILT_IN_CARD_TEMPLATES[0].card;
    const card = templateCardToCard(templateCard);

    if (templateCard.labels) {
      expect(card.labels).toEqual(templateCard.labels);
      expect(card.labels).not.toBe(templateCard.labels);
    }
  });
});

describe('boardToTemplate', () => {
  it('strips runtime fields', () => {
    const board = {
      name: 'My Board',
      description: 'desc',
      columns: [
        { id: 'col-1', title: 'Col A', order: 0, cards: [] } as Column,
      ],
    };

    const result = boardToTemplate(board);

    expect(result.name).toBe('My Board');
    expect(result.description).toBe('desc');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].title).toBe('Col A');
    // Should not include cards by default
    expect(result.columns[0].sampleCards).toBeUndefined();
  });
});

describe('cardToTemplate', () => {
  it('creates a template from a card', () => {
    const card: Card = {
      id: 'card-1',
      title: 'My Card',
      description: 'card desc',
      content: { type: 'text', text: 'content' },
      labels: ['green'],
      createdAt: '2026-04-14T00:00:00Z',
      updatedAt: '2026-04-14T00:00:00Z',
    };

    const result = cardToTemplate(card, 'Template Name');

    expect(result.name).toBe('Template Name');
    expect(result.card.title).toBe('My Card');
    expect(result.card.description).toBe('card desc');
    expect(result.card.content).toEqual({ type: 'text', text: 'content' });
    expect(result.card.labels).toEqual(['green']);
  });
});

describe('user template localStorage CRUD', () => {
  describe('board templates', () => {
    it('returns empty array when none saved', () => {
      expect(getUserBoardTemplates()).toEqual([]);
    });

    it('saves and retrieves a board template', () => {
      const saved = saveUserBoardTemplate({
        name: 'Custom',
        description: 'My template',
        columns: [{ title: 'Col' }],
      });

      expect(saved.id).toBeDefined();
      expect(saved.category).toBe('user');
      expect(saved.name).toBe('Custom');

      const stored = getUserBoardTemplates();
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Custom');
    });

    it('deletes a board template', () => {
      const saved = saveUserBoardTemplate({
        name: 'To Delete',
        description: '',
        columns: [],
      });

      deleteUserBoardTemplate(saved.id);
      expect(getUserBoardTemplates()).toHaveLength(0);
    });
  });

  describe('card templates', () => {
    it('returns empty array when none saved', () => {
      expect(getUserCardTemplates()).toEqual([]);
    });

    it('saves and retrieves a card template', () => {
      const saved = saveUserCardTemplate({
        name: 'Custom Card',
        card: { title: 'Template', content: { type: 'text', text: '' } },
      });

      expect(saved.id).toBeDefined();
      expect(saved.category).toBe('user');

      const stored = getUserCardTemplates();
      expect(stored).toHaveLength(1);
      expect(stored[0].name).toBe('Custom Card');
    });

    it('deletes a card template', () => {
      const saved = saveUserCardTemplate({
        name: 'Delete Me',
        card: { title: 'T', content: { type: 'text', text: '' } },
      });

      deleteUserCardTemplate(saved.id);
      expect(getUserCardTemplates()).toHaveLength(0);
    });
  });
});

describe('getAllBoardTemplates / getAllCardTemplates', () => {
  it('merges built-in and user board templates', () => {
    saveUserBoardTemplate({ name: 'User Board', description: '', columns: [] });
    const all = getAllBoardTemplates();
    expect(all.length).toBe(BUILT_IN_BOARD_TEMPLATES.length + 1);
    expect(all[all.length - 1].name).toBe('User Board');
  });

  it('merges built-in and user card templates', () => {
    saveUserCardTemplate({ name: 'User Card', card: { title: 'T', content: { type: 'text', text: '' } } });
    const all = getAllCardTemplates();
    expect(all.length).toBe(BUILT_IN_CARD_TEMPLATES.length + 1);
    expect(all[all.length - 1].name).toBe('User Card');
  });
});

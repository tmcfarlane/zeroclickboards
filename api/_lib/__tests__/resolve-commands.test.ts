import { describe, it, expect } from 'vitest';
import { resolveCommandIds, type PlanCommand } from '../resolve-commands.js';
import type { FullBoard } from '../board-core.js';

const card = (id: string, title: string, archived = false) => ({
  id,
  title,
  content: { type: 'text' as const, text: '' },
  isArchived: archived,
  createdAt: '',
  updatedAt: '',
});

const board: FullBoard = {
  id: 'board-1',
  name: 'Test',
  columns: [
    { id: 'col-todo', title: 'To Do', order: 0, cards: [card('c1', 'Fix login bug'), card('c2', 'Write docs')] },
    { id: 'col-doing', title: 'In Progress', order: 1, cards: [card('c3', 'Fix login bug')] }, // duplicate title
    { id: 'col-done', title: 'Done', order: 2, cards: [card('c4', 'Old task', true)] },
  ],
  hiddenColumnIds: [],
  isPublic: false,
  embedEnabled: false,
  createdAt: '',
  updatedAt: '',
};

const cmd = (type: string, params: Record<string, unknown>): PlanCommand => ({ type, params, originalText: '' });

describe('resolveCommandIds', () => {
  it('resolves columnId for add_card from columnTitle', () => {
    const [r] = resolveCommandIds(board, [cmd('add_card', { title: 'New', columnTitle: 'In Progress' })]);
    expect(r.params.columnId).toBe('col-doing');
    expect(r.params.columnTitle).toBe('In Progress'); // title preserved for fallback
  });

  it('matches columns case-insensitively and by substring', () => {
    const [r] = resolveCommandIds(board, [cmd('clear_column', { columnTitle: 'done' })]);
    expect(r.params.columnId).toBe('col-done');
  });

  it('resolves cardId + columnId for move_card and its target column', () => {
    const [r] = resolveCommandIds(board, [cmd('move_card', { cardTitle: 'Write docs', toColumnTitle: 'Done' })]);
    expect(r.params.cardId).toBe('c2');
    expect(r.params.columnId).toBe('col-todo');
    expect(r.params.toColumnId).toBe('col-done');
  });

  it('prefers an exact title match over a substring match', () => {
    // "Write docs" exact should win even though other cards contain words
    const [r] = resolveCommandIds(board, [cmd('archive_card', { cardTitle: 'Write docs' })]);
    expect(r.params.cardId).toBe('c2');
  });

  it('resolves cardId + columnId for edit_card', () => {
    const [r] = resolveCommandIds(board, [cmd('edit_card', { cardTitle: 'Write docs', title: 'Write the docs' })]);
    expect(r.params.cardId).toBe('c2');
    expect(r.params.columnId).toBe('col-todo');
    expect(r.params.title).toBe('Write the docs'); // untouched
  });

  it('remove_card resolves the card under the `title` param', () => {
    const [r] = resolveCommandIds(board, [cmd('remove_card', { title: 'Write docs' })]);
    expect(r.params.cardId).toBe('c2');
  });

  it('restore_card prefers the archived card', () => {
    const [r] = resolveCommandIds(board, [cmd('restore_card', { cardTitle: 'Old task' })]);
    expect(r.params.cardId).toBe('c4');
  });

  it('does not attach a cardId for bulk (allCards) operations', () => {
    const [r] = resolveCommandIds(board, [cmd('add_label', { label: 'green', allCards: true })]);
    expect(r.params.cardId).toBeUndefined();
  });

  it('never overwrites an id the model already supplied', () => {
    const [r] = resolveCommandIds(board, [cmd('archive_card', { cardTitle: 'Fix login bug', cardId: 'c3' })]);
    expect(r.params.cardId).toBe('c3'); // kept, not replaced by the first 'Fix login bug' (c1)
  });

  it('leaves params untouched when the title cannot be resolved', () => {
    const [r] = resolveCommandIds(board, [cmd('move_card', { cardTitle: 'Nonexistent', toColumnTitle: 'Nope' })]);
    expect(r.params.cardId).toBeUndefined();
    expect(r.params.toColumnId).toBeUndefined();
  });

  it('does not mutate the input command params', () => {
    const input = cmd('add_card', { columnTitle: 'To Do' });
    resolveCommandIds(board, [input]);
    expect(input.params.columnId).toBeUndefined();
  });
});

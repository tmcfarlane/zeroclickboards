import { v4 as uuidv4 } from 'uuid';
import type { Card, CardContent, CardLabel, Column } from '@/types';

export interface TemplateColumn {
  title: string;
  sampleCards?: TemplateCard[];
}

export interface TemplateCard {
  title: string;
  description?: string;
  content: CardContent;
  labels?: CardLabel[];
}

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  category: 'built-in' | 'user';
  columns: TemplateColumn[];
}

export interface CardTemplate {
  id: string;
  name: string;
  category: 'built-in' | 'user';
  card: TemplateCard;
}

// ---- Built-in Board Templates ----

export const BUILT_IN_BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'builtin-simple-kanban',
    name: 'Simple Kanban',
    description: 'Minimal three-column board',
    category: 'built-in',
    columns: [
      { title: 'To Do' },
      { title: 'Doing' },
      { title: 'Done' },
    ],
  },
  {
    id: 'builtin-sprint',
    name: 'Sprint Board',
    description: 'Agile sprint tracking with review stage',
    category: 'built-in',
    columns: [
      { title: 'Backlog' },
      { title: 'To Do' },
      { title: 'In Progress' },
      { title: 'In Review' },
      { title: 'Done' },
    ],
  },
  {
    id: 'builtin-bug-tracker',
    name: 'Bug Tracker',
    description: 'Track and triage bugs through resolution',
    category: 'built-in',
    columns: [
      { title: 'New', sampleCards: [{ title: 'Example: Login page error', content: { type: 'text', text: 'Steps to reproduce...' }, labels: ['red'] }] },
      { title: 'Triaging' },
      { title: 'In Progress' },
      { title: 'Resolved' },
      { title: 'Closed' },
    ],
  },
  {
    id: 'builtin-content-calendar',
    name: 'Content Calendar',
    description: 'Plan and track content from idea to published',
    category: 'built-in',
    columns: [
      { title: 'Ideas' },
      { title: 'Drafting' },
      { title: 'Review' },
      { title: 'Scheduled' },
      { title: 'Published' },
    ],
  },
  {
    id: 'builtin-product-roadmap',
    name: 'Product Roadmap',
    description: 'Track features from backlog to shipped',
    category: 'built-in',
    columns: [
      { title: 'Backlog' },
      { title: 'Next Up' },
      { title: 'In Progress' },
      { title: 'Shipped' },
    ],
  },
];

// ---- Built-in Card Templates ----

export const BUILT_IN_CARD_TEMPLATES: CardTemplate[] = [
  {
    id: 'builtin-bug-report',
    name: 'Bug Report',
    category: 'built-in',
    card: {
      title: 'Bug: [description]',
      content: {
        type: 'checklist',
        checklist: [
          { id: '1', text: 'Steps to reproduce', completed: false },
          { id: '2', text: 'Expected behavior', completed: false },
          { id: '3', text: 'Actual behavior', completed: false },
          { id: '4', text: 'Screenshots/logs', completed: false },
        ],
      },
      labels: ['red'],
    },
  },
  {
    id: 'builtin-feature-request',
    name: 'Feature Request',
    category: 'built-in',
    card: {
      title: 'Feature: [description]',
      content: {
        type: 'checklist',
        checklist: [
          { id: '1', text: 'Define requirements', completed: false },
          { id: '2', text: 'Design mockup', completed: false },
          { id: '3', text: 'Implementation', completed: false },
          { id: '4', text: 'Testing', completed: false },
          { id: '5', text: 'Documentation', completed: false },
        ],
      },
      labels: ['blue'],
    },
  },
  {
    id: 'builtin-meeting-notes',
    name: 'Meeting Notes',
    category: 'built-in',
    card: {
      title: 'Meeting: [topic]',
      description: 'Date: \nAttendees: \n\nAgenda:\n1. \n\nAction Items:\n- ',
      content: { type: 'text', text: '' },
      labels: ['purple'],
    },
  },
];

// ---- Template instantiation helpers ----

export function templateToColumns(template: BoardTemplate): Column[] {
  return template.columns.map((tc, index) => ({
    id: uuidv4(),
    title: tc.title,
    order: index,
    cards: (tc.sampleCards || []).map((sc) => templateCardToCard(sc)),
  }));
}

export function templateCardToCard(tc: TemplateCard): Card {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    title: tc.title,
    description: tc.description,
    content: structuredClone(tc.content),
    labels: tc.labels ? [...tc.labels] : undefined,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
}

// ---- User template storage (localStorage) ----

const BOARD_TEMPLATES_KEY = 'zcb-board-templates';
const CARD_TEMPLATES_KEY = 'zcb-card-templates';

export function getUserBoardTemplates(): BoardTemplate[] {
  try {
    const stored = localStorage.getItem(BOARD_TEMPLATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveUserBoardTemplate(template: Omit<BoardTemplate, 'id' | 'category'>): BoardTemplate {
  const newTemplate: BoardTemplate = { ...template, id: uuidv4(), category: 'user' };
  const existing = getUserBoardTemplates();
  localStorage.setItem(BOARD_TEMPLATES_KEY, JSON.stringify([...existing, newTemplate]));
  return newTemplate;
}

export function deleteUserBoardTemplate(id: string): void {
  const existing = getUserBoardTemplates();
  localStorage.setItem(BOARD_TEMPLATES_KEY, JSON.stringify(existing.filter((t) => t.id !== id)));
}

export function getUserCardTemplates(): CardTemplate[] {
  try {
    const stored = localStorage.getItem(CARD_TEMPLATES_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveUserCardTemplate(template: Omit<CardTemplate, 'id' | 'category'>): CardTemplate {
  const newTemplate: CardTemplate = { ...template, id: uuidv4(), category: 'user' };
  const existing = getUserCardTemplates();
  localStorage.setItem(CARD_TEMPLATES_KEY, JSON.stringify([...existing, newTemplate]));
  return newTemplate;
}

export function deleteUserCardTemplate(id: string): void {
  const existing = getUserCardTemplates();
  localStorage.setItem(CARD_TEMPLATES_KEY, JSON.stringify(existing.filter((t) => t.id !== id)));
}

export function getAllBoardTemplates(): BoardTemplate[] {
  return [...BUILT_IN_BOARD_TEMPLATES, ...getUserBoardTemplates()];
}

export function getAllCardTemplates(): CardTemplate[] {
  return [...BUILT_IN_CARD_TEMPLATES, ...getUserCardTemplates()];
}

export function boardToTemplate(board: { name: string; description?: string; columns: Column[] }): Omit<BoardTemplate, 'id' | 'category'> {
  return {
    name: board.name,
    description: board.description || '',
    columns: board.columns.map((col) => ({
      title: col.title,
      // Don't include cards in template by default (keep it clean)
    })),
  };
}

export function cardToTemplate(card: Card, name: string): Omit<CardTemplate, 'id' | 'category'> {
  return {
    name,
    card: {
      title: card.title,
      description: card.description,
      content: structuredClone(card.content),
      labels: card.labels ? [...card.labels] : undefined,
    },
  };
}

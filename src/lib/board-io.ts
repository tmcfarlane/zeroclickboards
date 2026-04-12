import { v4 as uuidv4 } from 'uuid';
import type { Board, Column, Card, CardContent, CardLabel, ChecklistItem, Attachment, RecurrenceConfig } from '@/types';

// ---- Export Format ----

export interface ExportCard {
  title: string;
  description?: string;
  content: CardContent;
  targetDate?: string;
  labels?: CardLabel[];
  coverImage?: string;
  attachments?: Omit<Attachment, 'id'>[];
  recurrence?: RecurrenceConfig;
  isArchived?: boolean;
  archivedAt?: string;
}

export interface ExportColumn {
  title: string;
  order: number;
  cards: ExportCard[];
}

export interface ZeroBoardExport {
  format: 'zeroboard';
  version: number;
  exportedAt: string;
  board: {
    name: string;
    description?: string;
    columns: ExportColumn[];
  };
}

// ---- Export ----

function stripCard(card: Card): ExportCard {
  const exported: ExportCard = {
    title: card.title,
    content: structuredClone(card.content),
  };
  if (card.description) exported.description = card.description;
  if (card.targetDate) exported.targetDate = card.targetDate;
  if (card.labels?.length) exported.labels = [...card.labels];
  if (card.coverImage) exported.coverImage = card.coverImage;
  if (card.attachments?.length) {
    exported.attachments = card.attachments.map(({ name, url, addedAt, isCover }) => ({
      name, url, addedAt, ...(isCover ? { isCover } : {}),
    }));
  }
  if (card.recurrence) exported.recurrence = structuredClone(card.recurrence);
  if (card.isArchived) {
    exported.isArchived = true;
    if (card.archivedAt) exported.archivedAt = card.archivedAt;
  }
  // Strip checklist item IDs
  if (exported.content.checklist) {
    exported.content.checklist = exported.content.checklist.map(({ text, completed }) => ({
      id: '', text, completed,
    }));
  }
  return exported;
}

export function exportBoardToJSON(board: Board): string {
  const envelope: ZeroBoardExport = {
    format: 'zeroboard',
    version: 1,
    exportedAt: new Date().toISOString(),
    board: {
      name: board.name,
      ...(board.description ? { description: board.description } : {}),
      columns: board.columns.map((col) => ({
        title: col.title,
        order: col.order,
        cards: col.cards.map(stripCard),
      })),
    },
  };
  return JSON.stringify(envelope, null, 2);
}

function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'board';
}

export function downloadBoardJSON(board: Board): void {
  const json = exportBoardToJSON(board);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${sanitizeFilename(board.name)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---- Import ----

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const VALID_LABELS: CardLabel[] = ['red', 'yellow', 'green', 'blue', 'purple', 'gray'];
const VALID_CONTENT_TYPES = ['text', 'checklist', 'image'];

export function readFileAsJSON(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error('File too large (max 10MB)'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string));
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function validateBoardJSON(
  data: unknown
): { valid: true; payload: ZeroBoardExport } | { valid: false; error: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Not a valid export file' };
  }
  const obj = data as Record<string, unknown>;

  if (obj.format !== 'zeroboard') {
    return { valid: false, error: 'Not a ZeroBoard export file' };
  }
  if (typeof obj.version !== 'number' || obj.version > 1) {
    return { valid: false, error: `Export version ${obj.version} is newer than supported. Please update ZeroBoard.` };
  }

  const board = obj.board as Record<string, unknown> | undefined;
  if (!board || typeof board !== 'object') {
    return { valid: false, error: 'Missing board data' };
  }
  if (typeof board.name !== 'string' || !board.name.trim()) {
    return { valid: false, error: 'Board name is required' };
  }
  if (!Array.isArray(board.columns)) {
    return { valid: false, error: 'Board columns must be an array' };
  }

  for (let ci = 0; ci < board.columns.length; ci++) {
    const col = board.columns[ci] as Record<string, unknown>;
    if (typeof col.title !== 'string') {
      return { valid: false, error: `Column ${ci + 1}: title is required` };
    }
    if (!Array.isArray(col.cards)) {
      return { valid: false, error: `Column "${col.title}": cards must be an array` };
    }
    for (let ki = 0; ki < col.cards.length; ki++) {
      const card = col.cards[ki] as Record<string, unknown>;
      if (typeof card.title !== 'string') {
        return { valid: false, error: `Column "${col.title}", card ${ki + 1}: title is required` };
      }
      const content = card.content as Record<string, unknown> | undefined;
      if (!content || typeof content !== 'object' || !VALID_CONTENT_TYPES.includes(content.type as string)) {
        return { valid: false, error: `Column "${col.title}", card "${card.title}": invalid content type` };
      }
      if (card.labels && Array.isArray(card.labels)) {
        for (const label of card.labels) {
          if (!VALID_LABELS.includes(label as CardLabel)) {
            return { valid: false, error: `Column "${col.title}", card "${card.title}": invalid label "${label}"` };
          }
        }
      }
    }
  }

  return { valid: true, payload: data as ZeroBoardExport };
}

export function importBoardFromJSON(payload: ZeroBoardExport): {
  name: string;
  description?: string;
  columns: Column[];
} {
  const now = new Date().toISOString();
  const { board } = payload;

  const columns: Column[] = board.columns.map((col, index) => ({
    id: uuidv4(),
    title: col.title,
    order: index,
    cards: col.cards.map((ec): Card => {
      const content: CardContent = structuredClone(ec.content);
      if (content.checklist) {
        content.checklist = content.checklist.map((item): ChecklistItem => ({
          id: uuidv4(),
          text: item.text,
          completed: item.completed ?? false,
        }));
      }
      const card: Card = {
        id: uuidv4(),
        title: ec.title,
        content,
        createdAt: now,
        updatedAt: now,
      };
      if (ec.description) card.description = ec.description;
      if (ec.targetDate) card.targetDate = ec.targetDate;
      if (ec.labels?.length) card.labels = [...ec.labels];
      if (ec.coverImage) card.coverImage = ec.coverImage;
      if (ec.attachments?.length) {
        card.attachments = ec.attachments.map((att) => ({
          id: uuidv4(),
          name: att.name,
          url: att.url,
          addedAt: att.addedAt || now,
          ...(att.isCover ? { isCover: true } : {}),
        }));
      }
      if (ec.recurrence) card.recurrence = structuredClone(ec.recurrence);
      if (ec.isArchived) {
        card.isArchived = true;
        if (ec.archivedAt) card.archivedAt = ec.archivedAt;
      }
      return card;
    }),
  }));

  return {
    name: board.name,
    ...(board.description ? { description: board.description } : {}),
    columns,
  };
}

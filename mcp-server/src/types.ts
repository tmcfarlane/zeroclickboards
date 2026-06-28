// Types mirrored from the web app (src/types/index.ts). The MCP server reads and
// writes the SAME boards.data JSONB the app uses, so these shapes MUST stay in
// sync with the app's Card / Column / CardContent definitions.

export type CardContentType = 'text' | 'checklist' | 'image';
export type CardLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

export const CARD_LABELS: CardLabel[] = ['red', 'yellow', 'green', 'blue', 'purple', 'gray'];

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface CardContent {
  type: CardContentType;
  text?: string;
  checklist?: ChecklistItem[];
  imageUrl?: string;
}

export interface RecurrenceConfig {
  frequency: 'daily' | 'weekly' | 'monthly';
  interval: number;
  daysOfWeek?: number[];
  dayOfMonth?: number;
}

export interface Card {
  id: string;
  title: string;
  description?: string;
  content: CardContent;
  targetDate?: string;
  labels?: CardLabel[];
  coverImage?: string;
  recurrence?: RecurrenceConfig;
  isArchived?: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Column {
  id: string;
  title: string;
  cards: Card[];
  order: number;
}

/** The shape stored in the `boards.data` JSONB column. */
export interface BoardData {
  columns: Column[];
  background?: string;
  hiddenColumnIds?: string[];
}

/** A board row as returned from Supabase. */
export interface BoardRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  data: unknown;
  created_at: string;
  updated_at: string;
  is_public: boolean;
  embed_enabled: boolean;
}

/** Lightweight board listing (no card payload). */
export interface BoardSummary {
  id: string;
  name: string;
  description?: string;
  columnCount: number;
  cardCount: number;
  updatedAt: string;
  createdAt: string;
}

/** A fully-decoded board with columns and cards. */
export interface FullBoard {
  id: string;
  name: string;
  description?: string;
  columns: Column[];
  background?: string;
  hiddenColumnIds: string[];
  isPublic: boolean;
  embedEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Shape returned by the web app's /api/ai/board-template endpoint (the AI board
// generator the web UI uses). Mirrors that endpoint's response schema.
export interface TemplateCard {
  title: string;
  description?: string;
  content?: { type: 'text' | 'checklist'; text?: string; checklist?: { text: string }[] };
  labels?: CardLabel[];
}

export interface TemplateColumn {
  title: string;
  sampleCards?: TemplateCard[];
}

export interface BoardTemplate {
  name: string;
  description?: string;
  columns: TemplateColumn[];
}

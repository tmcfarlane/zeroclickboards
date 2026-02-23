// Card content types
export type CardContentType = 'text' | 'checklist' | 'image';

// Card label colors - Trello-style
export type CardLabel = 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'gray';

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

export interface Card {
  id: string;
  title: string;
  content: CardContent;
  targetDate?: string;
  labels?: CardLabel[];
  coverImage?: string;
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

export interface Board {
  id: string;
  name: string;
  description?: string;
  columns: Column[];
  createdAt: string;
  updatedAt: string;
  userId?: string; // Optional for backward compatibility
}

export interface AppState {
  boards: Board[];
  activeBoardId: string | null;
  viewMode: 'board' | 'timeline';
}

// AI Assistant types
export interface AICommand {
  type: 'create_board' | 'delete_board' | 'rename_board' | 'add_column' | 'remove_column' | 'rename_column' | 'add_card' | 'remove_card' | 'edit_card' | 'move_card' | 'set_target_date' | 'switch_view' | 'unknown';
  params: Record<string, unknown>;
  originalText: string;
}

export interface AIMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  command?: AICommand;
}

// Timeline types
export interface TimelineItem {
  card: Card;
  columnName: string;
  columnId: string;
}

export interface TimelineLane {
  name: string;
  items: TimelineItem[];
}

// Database types - exported from database.ts for convenience
export type {
  Database,
  Profile,
  BoardRow,
  ColumnRow,
  CardRow,
  CardActivity,
  InsertProfile,
  InsertBoard,
  InsertColumn,
  InsertCard,
  InsertCardActivity,
  UpdateProfile,
  UpdateBoard,
  UpdateColumn,
  UpdateCard,
  UpdateCardActivity,
  Json,
} from './database';

// Database-specific Card type with labels and archive support
export interface DatabaseCard {
  id: string;
  boardId: string;
  columnId: string;
  userId: string;
  title: string;
  content: CardContent;
  targetDate?: string;
  labels: string[];
  coverImage?: string;
  order: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Database-specific Column type with order
export interface DatabaseColumn {
  id: string;
  boardId: string;
  userId: string;
  title: string;
  order: number;
  createdAt: string;
}

// Database-specific Board type
export interface DatabaseBoard {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

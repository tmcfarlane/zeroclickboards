import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRecurringCardCopy } from './recurrence.js';
import { parseRecurrence } from './recurrence-schema.js';
import { parseTargetDate } from './target-date-schema.js';
import {
  type BoardData,
  type BoardRow,
  type BoardSummary,
  type Card,
  type CardContent,
  type CardLabel,
  type Column,
  type FullBoard,
  type BoardTemplate,
  type RecurrenceConfig,
} from './types.js';

// ---------------------------------------------------------------------------
// Helpers — these intentionally mirror src/store/useBoardStore.ts so the MCP
// server and the web UI read/write the boards.data JSONB identically.
// ---------------------------------------------------------------------------

const nowIso = (): string => new Date().toISOString();
const newId = (): string => randomUUID();

function createDefaultColumns(): Column[] {
  return [
    { id: newId(), title: 'To Do', cards: [], order: 0 },
    { id: newId(), title: 'Blocked', cards: [], order: 1 },
    { id: newId(), title: 'In Progress', cards: [], order: 2 },
    { id: newId(), title: 'Resolved', cards: [], order: 3 },
    { id: newId(), title: 'Closed', cards: [], order: 4 },
  ];
}

function asRecord(data: unknown): Record<string, unknown> | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

export function decodeData(data: unknown): BoardData {
  const rec = asRecord(data);
  const columns = rec && Array.isArray(rec.columns) ? (rec.columns as unknown as Column[]) : createDefaultColumns();
  const background = rec && typeof rec.background === 'string' ? rec.background : undefined;
  const hiddenColumnIds =
    rec && Array.isArray(rec.hiddenColumnIds)
      ? (rec.hiddenColumnIds.filter((v) => typeof v === 'string') as string[])
      : [];
  return { columns, background, hiddenColumnIds };
}

/** Change only columns; other JSONB fields may be owned by newer web clients. */
function encodeData(columns: Column[], base: unknown): BoardData {
  return {
    ...(asRecord(base) ?? {}),
    columns,
  };
}

const SELECT_COLS = 'id,user_id,name,description,data,created_at,updated_at,is_public,embed_enabled';

function rowToFullBoard(row: BoardRow): FullBoard {
  const decoded = decodeData(row.data);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    columns: decoded.columns,
    background: decoded.background,
    hiddenColumnIds: decoded.hiddenColumnIds ?? [],
    isPublic: row.is_public,
    embedEnabled: row.embed_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: BoardRow): BoardSummary {
  const { columns } = decodeData(row.data);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    columnCount: columns.length,
    cardCount: columns.reduce((n, c) => n + c.cards.length, 0),
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

class BoardError extends Error {}
const notFound = (what: string, id: string): never => {
  throw new BoardError(`${what} ${id} not found`);
};

async function getRow(client: SupabaseClient, boardId: string): Promise<BoardRow> {
  const { data, error } = await client.from('boards').select(SELECT_COLS).eq('id', boardId).maybeSingle();
  if (error) throw new BoardError(error.message);
  if (!data) return notFound('Board', boardId);
  return data as unknown as BoardRow;
}

/**
 * Update only the version we read, then reapply the operation to fresh data on
 * a version conflict. The database trigger advances updated_at on every write.
 * Web clients still write without a version check and can overwrite a later MCP
 * change with stale state; this guard protects writes made by this server.
 */
async function mutateColumns(
  client: SupabaseClient,
  boardId: string,
  mutator: (columns: Column[]) => Column[],
): Promise<FullBoard> {
  let previousVersion: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await getRow(client, boardId);
    // RLS can reject an update by returning zero rows without an error. If the
    // row's version did not change, another write did not cause the rejection.
    if (row.updated_at === previousVersion) {
      throw new BoardError(`Board ${boardId} could not be updated. Check your edit access.`);
    }
    const base = decodeData(row.data);
    const nextColumns = mutator(structuredClone(base.columns));
    const nextData = encodeData(nextColumns, row.data);
    const { data, error } = await client
      .from('boards')
      .update({ data: nextData, updated_at: nowIso() })
      .eq('id', boardId)
      .eq('updated_at', row.updated_at)
      .select(SELECT_COLS)
      .maybeSingle();
    // Never replay a write after an ambiguous network failure or API error.
    if (error) throw new BoardError(error.message);
    if (data) return rowToFullBoard(data as unknown as BoardRow);
    previousVersion = row.updated_at;
  }
  throw new BoardError(`Board ${boardId} changed during all 3 update attempts. Please try again.`);
}

function findColumn(columns: Column[], columnId: string): Column {
  const col = columns.find((c) => c.id === columnId);
  if (!col) notFound('Column', columnId);
  return col!;
}

function locateCard(columns: Column[], cardId: string): { column: Column; card: Card; index: number } {
  for (const column of columns) {
    const index = column.cards.findIndex((c) => c.id === cardId);
    if (index !== -1) return { column, card: column.cards[index], index };
  }
  return notFound('Card', cardId);
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export async function listBoards(client: SupabaseClient): Promise<BoardSummary[]> {
  const { data, error } = await client
    .from('boards')
    .select(SELECT_COLS)
    .order('created_at', { ascending: true });
  if (error) throw new BoardError(error.message);
  return (data as unknown as BoardRow[]).map(rowToSummary);
}

export async function getBoard(client: SupabaseClient, boardId: string): Promise<FullBoard> {
  return rowToFullBoard(await getRow(client, boardId));
}

export async function createBoard(
  client: SupabaseClient,
  userId: string,
  name: string,
  description?: string,
  columns?: Column[],
): Promise<FullBoard> {
  const id = newId();
  const now = nowIso();
  const data: BoardData = { columns: columns ?? createDefaultColumns() };
  const { data: row, error } = await client
    .from('boards')
    .insert({
      id,
      user_id: userId,
      name,
      description: description ?? null,
      data,
      created_at: now,
      updated_at: now,
    })
    .select(SELECT_COLS)
    .single();
  if (error || !row) throw new BoardError(error?.message ?? 'Insert failed');
  return rowToFullBoard(row as unknown as BoardRow);
}

/** Create a board from an AI-generated template (maps template cards to Cards). */
export function createBoardFromTemplate(
  client: SupabaseClient,
  userId: string,
  template: BoardTemplate,
): Promise<FullBoard> {
  const now = nowIso();
  const columns: Column[] = template.columns.map((col, i) => ({
    id: newId(),
    title: col.title,
    order: i,
    cards: (col.sampleCards ?? []).map((c): Card => {
      const content: CardContent =
        c.content?.type === 'checklist'
          ? {
              type: 'checklist',
              checklist: (c.content.checklist ?? []).map((it) => ({ id: newId(), text: it.text, completed: false })),
            }
          : { type: 'text', text: c.content?.text ?? '' };
      return {
        id: newId(),
        title: c.title,
        description: c.description,
        content,
        labels: c.labels ?? [],
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      };
    }),
  }));
  return createBoard(client, userId, template.name, template.description, columns);
}

export async function updateBoardMeta(
  client: SupabaseClient,
  boardId: string,
  patch: { name?: string; description?: string },
): Promise<FullBoard> {
  const update: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  const { data, error } = await client
    .from('boards')
    .update(update)
    .eq('id', boardId)
    .select(SELECT_COLS)
    .single();
  if (error || !data) throw new BoardError(error?.message ?? 'Update failed');
  return rowToFullBoard(data as unknown as BoardRow);
}

export async function deleteBoard(client: SupabaseClient, boardId: string): Promise<{ id: string }> {
  const { data, error } = await client.from('boards').delete().eq('id', boardId).select('id').maybeSingle();
  if (error) throw new BoardError(error.message);
  if (!data) throw new BoardError(`Board ${boardId} was not deleted. It may not exist or you may not have delete access.`);
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export function addColumn(client: SupabaseClient, boardId: string, title: string): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const maxOrder = columns.reduce((m, c) => Math.max(m, c.order), -1);
    return [...columns, { id: newId(), title, cards: [], order: maxOrder + 1 }];
  });
}

export function updateColumn(
  client: SupabaseClient,
  boardId: string,
  columnId: string,
  title: string,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    findColumn(columns, columnId).title = title;
    return columns;
  });
}

export function removeColumn(client: SupabaseClient, boardId: string, columnId: string): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    findColumn(columns, columnId);
    return columns.filter((c) => c.id !== columnId);
  });
}

export function reorderColumns(
  client: SupabaseClient,
  boardId: string,
  orderedColumnIds: string[],
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const map = new Map(columns.map((c) => [c.id, c]));
    if (
      orderedColumnIds.length !== columns.length ||
      new Set(orderedColumnIds).size !== columns.length ||
      orderedColumnIds.some((id) => !map.has(id))
    ) {
      throw new BoardError('orderedColumnIds must list every existing column id exactly once');
    }
    return orderedColumnIds.map((id, index) => ({ ...map.get(id)!, order: index }));
  });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface NewCardInput {
  title: string;
  description?: string;
  content?: CardContent;
  targetDate?: string;
  labels?: CardLabel[];
  coverImage?: string;
  recurrence?: RecurrenceConfig;
}

/** coverImage is the selected URL; attachment flags mirror that selection. */
function applyCoverImage(card: Card, coverImage: string | undefined): void {
  card.coverImage = coverImage;
  let selected = false;
  if (card.attachments) {
    card.attachments = card.attachments.map((attachment) => {
      const isCover = !selected && !!coverImage && attachment.url === coverImage;
      if (isCover) selected = true;
      return { ...attachment, isCover };
    });
  }
}

export async function addCard(
  client: SupabaseClient,
  boardId: string,
  columnId: string,
  input: NewCardInput,
): Promise<FullBoard> {
  const recurrence = input.recurrence === undefined ? undefined : parseRecurrence(input.recurrence);
  const targetDate = input.targetDate === undefined ? undefined : parseTargetDate(input.targetDate);
  const draft = structuredClone({ ...input, recurrence, targetDate });
  return mutateColumns(client, boardId, (columns) => {
    const column = findColumn(columns, columnId);
    const now = nowIso();
    const card: Card = {
      id: newId(),
      title: draft.title,
      description: draft.description,
      content: draft.content ?? { type: 'text', text: '' },
      targetDate: draft.targetDate,
      labels: draft.labels ?? [],
      coverImage: draft.coverImage,
      recurrence: draft.recurrence,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
    column.cards.push(card);
    return columns;
  });
}

export async function updateCard(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  patch: Partial<Pick<Card, 'title' | 'description' | 'content' | 'targetDate' | 'labels' | 'coverImage'>>,
): Promise<FullBoard> {
  const draft = { ...patch };
  if (draft.targetDate === undefined) delete draft.targetDate;
  else draft.targetDate = parseTargetDate(draft.targetDate);
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    Object.assign(card, draft, { updatedAt: nowIso() });
    if (Object.prototype.hasOwnProperty.call(draft, 'coverImage')) applyCoverImage(card, draft.coverImage);
    return columns;
  });
}

export function moveCard(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  targetColumnId: string,
  targetIndex?: number,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { column: sourceColumn, card, index } = locateCard(columns, cardId);
    const target = findColumn(columns, targetColumnId);
    sourceColumn.cards.splice(index, 1);
    const insertAt = targetIndex === undefined ? target.cards.length : Math.max(0, Math.min(targetIndex, target.cards.length));
    target.cards.splice(insertAt, 0, card);
    card.updatedAt = nowIso();
    return columns;
  });
}

export function removeCard(client: SupabaseClient, boardId: string, cardId: string): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { column } = locateCard(columns, cardId);
    column.cards = column.cards.filter((c) => c.id !== cardId);
    return columns;
  });
}

export function setCardArchived(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  archived: boolean,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { column, card } = locateCard(columns, cardId);
    const recurringCopy = archived && !card.isArchived && card.recurrence
      ? createRecurringCardCopy(card)
      : undefined;
    card.isArchived = archived;
    card.archivedAt = archived ? nowIso() : undefined;
    card.updatedAt = nowIso();
    if (recurringCopy) column.cards.push(recurringCopy);
    return columns;
  });
}

export function duplicateCard(client: SupabaseClient, boardId: string, cardId: string): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { column, card } = locateCard(columns, cardId);
    const now = nowIso();
    column.cards.push({ ...structuredClone(card), id: newId(), title: `${card.title} (copy)`, createdAt: now, updatedAt: now });
    return columns;
  });
}

// ---------------------------------------------------------------------------
// Card detail mutations
// ---------------------------------------------------------------------------

export function addChecklistItem(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  text: string,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    const checklist = card.content.type === 'checklist' && card.content.checklist ? card.content.checklist : [];
    card.content = { ...card.content, type: 'checklist', checklist: [...checklist, { id: newId(), text, completed: false }] };
    card.updatedAt = nowIso();
    return columns;
  });
}

export function toggleChecklistItem(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  itemId: string,
  completed?: boolean,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    const items = card.content.checklist;
    if (!items) throw new BoardError(`Card ${cardId} has no checklist`);
    const item = items.find((i) => i.id === itemId);
    if (!item) notFound('Checklist item', itemId);
    item!.completed = completed ?? !item!.completed;
    card.updatedAt = nowIso();
    return columns;
  });
}

export function setLabel(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  label: CardLabel,
  present: boolean,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    const labels = new Set(card.labels ?? []);
    if (present) labels.add(label);
    else labels.delete(label);
    card.labels = [...labels];
    card.updatedAt = nowIso();
    return columns;
  });
}

export async function setTargetDate(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  targetDate: string | null,
): Promise<FullBoard> {
  const next = targetDate === null ? undefined : parseTargetDate(targetDate);
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    card.targetDate = next;
    card.updatedAt = nowIso();
    return columns;
  });
}

export function setCoverImage(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  coverImage: string | null,
): Promise<FullBoard> {
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    applyCoverImage(card, coverImage ?? undefined);
    card.updatedAt = nowIso();
    return columns;
  });
}

export async function setRecurrence(
  client: SupabaseClient,
  boardId: string,
  cardId: string,
  recurrence: RecurrenceConfig | null,
): Promise<FullBoard> {
  const next = recurrence === null ? undefined : parseRecurrence(recurrence);
  return mutateColumns(client, boardId, (columns) => {
    const { card } = locateCard(columns, cardId);
    card.recurrence = structuredClone(next);
    card.updatedAt = nowIso();
    return columns;
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  boardId: string;
  boardName: string;
  columnId: string;
  columnName: string;
  cardId: string;
  cardTitle: string;
  snippet?: string;
}

function cardText(card: Card): string {
  const parts = [card.title, card.description ?? '', card.content.text ?? ''];
  if (card.content.checklist) parts.push(...card.content.checklist.map((i) => i.text));
  return parts.join('\n');
}

export async function search(
  client: SupabaseClient,
  query: string,
  includeArchived = false,
): Promise<SearchHit[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { data, error } = await client.from('boards').select(SELECT_COLS);
  if (error) throw new BoardError(error.message);
  const hits: SearchHit[] = [];
  for (const row of data as unknown as BoardRow[]) {
    const { columns } = decodeData(row.data);
    for (const column of columns) {
      for (const card of column.cards) {
        if (card.isArchived && !includeArchived) continue;
        const text = cardText(card);
        if (text.toLowerCase().includes(q)) {
          hits.push({
            boardId: row.id,
            boardName: row.name,
            columnId: column.id,
            columnName: column.title,
            cardId: card.id,
            cardTitle: card.title,
            snippet: card.description || card.content.text || undefined,
          });
        }
      }
    }
  }
  return hits;
}

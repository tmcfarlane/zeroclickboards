// Phase 1b: resolve the model's title-based commands to real ids.
//
// The AI endpoint grounds the model in the user's real board, but the model
// still emits human-friendly title references (cardTitle / columnTitle). Here we
// resolve those against the authoritative board (fetched from the DB) and attach
// the concrete ids (cardId / columnId / toColumnId). The client prefers these
// ids when present, which removes the duplicate-title ambiguity of fuzzy
// title-only matching. Title params are preserved as a fallback.
import type { Card, Column, FullBoard } from './board-core.js';

export interface PlanCommand {
  type: string;
  params: Record<string, unknown>;
  originalText: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Match a column by title: exact (case-insensitive) first, then substring. */
function findColumn(board: FullBoard, title?: string): Column | undefined {
  const t = title?.toLowerCase();
  if (!t) return undefined;
  return (
    board.columns.find((c) => c.title.toLowerCase() === t) ??
    board.columns.find((c) => c.title.toLowerCase().includes(t))
  );
}

/**
 * Match a card by title across the whole board. Mirrors the client's matching
 * (case-insensitive exact, then substring) and prefers the requested archive
 * state — restore targets archived cards, everything else targets active ones.
 */
function findCard(
  board: FullBoard,
  title: string | undefined,
  opts: { archived: boolean },
): { card: Card; column: Column } | undefined {
  const t = title?.toLowerCase();
  if (!t) return undefined;
  const pairs = board.columns.flatMap((column) => column.cards.map((card) => ({ card, column })));
  const preferred = pairs.filter((p) => !!p.card.isArchived === opts.archived);
  const pools = [preferred, pairs];
  for (const pool of pools) {
    const exact = pool.find((p) => p.card.title.toLowerCase() === t);
    if (exact) return exact;
    const partial = pool.find((p) => p.card.title.toLowerCase().includes(t));
    if (partial) return partial;
  }
  return undefined;
}

/**
 * Return a copy of `commands` with concrete ids attached where they can be
 * resolved against `board`. Never overwrites an id the model already provided,
 * and never removes the title params (the client falls back to them).
 */
export function resolveCommandIds(board: FullBoard, commands: PlanCommand[]): PlanCommand[] {
  return commands.map((cmd) => {
    const p: Record<string, unknown> = { ...cmd.params };
    const setIf = (key: string, value?: string) => {
      if (value !== undefined && p[key] === undefined) p[key] = value;
    };
    const resolveColumn = (titleKey: string, idKey: string) => {
      const col = findColumn(board, str(p[titleKey]));
      if (col) setIf(idKey, col.id);
    };
    const resolveCard = (titleKey: string, archived = false) => {
      const hit = findCard(board, str(p[titleKey]), { archived });
      if (hit) {
        setIf('cardId', hit.card.id);
        setIf('columnId', hit.column.id);
      }
    };

    switch (cmd.type) {
      case 'add_card':
        resolveColumn('columnTitle', 'columnId');
        break;
      case 'move_card':
        resolveCard('cardTitle');
        resolveColumn('toColumnTitle', 'toColumnId');
        break;
      case 'remove_column':
        resolveColumn('title', 'columnId');
        break;
      case 'rename_column':
        resolveColumn('fromTitle', 'columnId');
        break;
      case 'clear_column':
      case 'extract_column_json':
      case 'count_cards':
        resolveColumn('columnTitle', 'columnId');
        break;
      case 'set_target_date':
        if (p.allCards !== true) resolveCard('cardTitle');
        resolveColumn('columnTitle', 'columnId');
        break;
      case 'add_label':
      case 'remove_label':
      case 'add_checklist':
        if (p.allCards !== true) resolveCard('cardTitle');
        break;
      case 'rename_card':
      case 'archive_card':
      case 'duplicate_card':
      case 'set_description':
      case 'extract_card_json':
        resolveCard('cardTitle');
        break;
      case 'restore_card':
        resolveCard('cardTitle', true);
        break;
      case 'remove_card':
        // remove_card carries the card under `title`, not `cardTitle`.
        resolveCard('title');
        break;
      default:
        break;
    }
    return { ...cmd, params: p };
  });
}

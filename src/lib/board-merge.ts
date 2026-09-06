/** The editable, persisted portion of a board. Transport revisions live outside it. */
export interface BoardDocument {
  name: string;
  description: string | null;
  data: Record<string, unknown>;
}

export interface BoardMergeConflict {
  path: string;
  local: unknown;
  remote: unknown;
}

type Resolution = 'local' | 'remote';
type Value = Record<string, unknown>;
type Entity = Value & { id: string };
type CardEntry = { columnId: string; card: Entity };
type Snapshot = {
  columns: Map<string, Entity>;
  cards: Map<string, CardEntry>;
  columnOrder: string[];
  cardOrder: Map<string, string[]>;
};
type MergeContext = {
  resolution?: Resolution;
  conflicts: BoardMergeConflict[];
  conflict: (path: string, local: unknown, remote: unknown) => unknown;
};

const isObject = (value: unknown): value is Value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const field = (value: Value, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;

function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copy) as T;
  if (isObject(value)) {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, copy(entry)])) as T;
  }
  return value;
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, i) => equal(entry, right[i]));
  }
  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every((key) => equal(field(left, key), field(right, key)));
  }
  return false;
}

function without(value: Value, keys: string[]): Value {
  return Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
}

function comparableDocument(document: BoardDocument): BoardDocument {
  const columns = document.data.columns;
  return {
    ...document,
    data: {
      ...document.data,
      ...(Array.isArray(columns) ? {
        columns: columns.map((column: unknown) => !isObject(column) ? column : {
          ...column,
          ...(Array.isArray(column.cards) ? {
            cards: column.cards.map((card: unknown) => isObject(card) ? without(card, ['updatedAt']) : card),
          } : {}),
        }),
      } : {}),
    },
  };
}

/** Object key order and absent/undefined object fields are equivalent. Only actual
 * card updatedAt fields are incidental; list order and other timestamps matter. */
export function documentsEqual(left: BoardDocument, right: BoardDocument): boolean {
  return equal(comparableDocument(left), comparableDocument(right));
}

function entities(value: unknown, path: string): Entity[] {
  if (!Array.isArray(value)) throw new Error(`Invalid board data at ${path}: expected an array`);
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id || seen.has(entry.id)) {
      throw new Error(`Invalid board data at ${path}: missing or duplicate id`);
    }
    seen.add(entry.id);
    return entry as Entity;
  });
}

function snapshot(document: BoardDocument): Snapshot {
  const columns = entities(document.data.columns === undefined ? [] : document.data.columns, 'data.columns');
  const result: Snapshot = {
    columns: new Map(), cards: new Map(), columnOrder: [], cardOrder: new Map(),
  };
  for (const column of columns) {
    result.columns.set(column.id, column);
    result.columnOrder.push(column.id);
    const cards = entities(column.cards, `data.columns[${column.id}].cards`);
    result.cardOrder.set(column.id, cards.map((card) => card.id));
    for (const card of cards) {
      if (result.cards.has(card.id)) throw new Error(`Invalid board data: duplicate card id ${card.id}`);
      result.cards.set(card.id, { columnId: column.id, card });
    }
  }
  return result;
}

/** Validate identity and collection structure before a remote document enters
 * the local store. This performs no reconciliation or quadratic order work. */
export function validateBoardDocument(document: BoardDocument): void {
  if (!document || typeof document.name !== 'string' ||
    (document.description !== null && typeof document.description !== 'string') || !isObject(document.data)) {
    throw new Error('Invalid board document');
  }
  snapshot(document);
}

function unique(...lists: string[][]): string[] {
  return [...new Set(lists.flat())];
}

function sortedByConstraints(ids: string[], edges: [string, string][]): string[] | undefined {
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  const incoming = new Map(ids.map((id) => [id, 0]));
  for (const [before, after] of edges) {
    if (before === after || !outgoing.has(before) || !outgoing.has(after) || outgoing.get(before)!.has(after)) continue;
    outgoing.get(before)!.add(after);
    incoming.set(after, incoming.get(after)! + 1);
  }
  const result: string[] = [];
  const remaining = new Set(ids);
  while (remaining.size) {
    const next = ids.find((id) => remaining.has(id) && incoming.get(id) === 0);
    if (next === undefined) return undefined;
    remaining.delete(next);
    result.push(next);
    for (const after of outgoing.get(next)!) incoming.set(after, incoming.get(after)! - 1);
  }
  return result;
}

/** Merge existing relative order first, then anchor insertions to their preceding
 * surviving item. An insertion after A stays after A when A is concurrently moved. */
function mergeOrder(base: string[], local: string[], remote: string[], alive: string[], path: string, context: MergeContext): string[] {
  const allowed = new Set(alive);
  base = base.filter((id) => allowed.has(id));
  local = local.filter((id) => allowed.has(id));
  remote = remote.filter((id) => allowed.has(id));
  // Field edits and one-sided order changes are overwhelmingly common. Avoid
  // allocating a pairwise ordering graph when one sequence already proves the
  // complete result, including every surviving addition.
  if (equal(local, remote) && local.length === alive.length) return local;
  if (equal(base, local) && remote.length === alive.length) return remote;
  if (equal(base, remote) && local.length === alive.length) return local;
  const baseIds = new Set(base);
  const corePriority = unique(local, remote, base).filter((id) => baseIds.has(id));
  const positions = [base, local, remote].map((list) => new Map(list.map((id, index) => [id, index])));
  const relation = (side: number, a: string, b: string): boolean | undefined => {
    const positionsForSide = positions[side];
    return positionsForSide.has(a) && positionsForSide.has(b)
      ? positionsForSide.get(a)! < positionsForSide.get(b)!
      : undefined;
  };
  const orderConflict = () => context.conflict(path, local, remote);
  const edges: [string, string][] = [];
  for (let i = 0; i < base.length; i++) {
    for (let j = i + 1; j < base.length; j++) {
      const a = base[i], b = base[j];
      const l = relation(1, a, b), r = relation(2, a, b);
      // A changed relation wins over its unchanged counterpart.
      const before = l === false || r === false ? false : true;
      edges.push(before ? [a, b] : [b, a]);
    }
  }
  let core = sortedByConstraints(corePriority, edges);
  if (!core) {
    orderConflict();
    core = unique(context.resolution === 'remote' ? remote : local, base).filter((id) => baseIds.has(id));
  }
  const additions = unique(local, remote, alive).filter((id) => !baseIds.has(id));
  const anchorFor = (list: string[], id: string): string | null | undefined => {
    const index = list.indexOf(id);
    if (index < 0) return undefined;
    for (let i = index - 1; i >= 0; i--) if (baseIds.has(list[i])) return list[i];
    return null;
  };
  const groups = new Map<string | null, string[]>();
  for (const id of additions) {
    const l = anchorFor(local, id), r = anchorFor(remote, id);
    let anchor = l === undefined ? r : l;
    if (l !== undefined && r !== undefined && l !== r) {
      orderConflict();
      anchor = context.resolution === 'remote' ? r : l;
    }
    const key = anchor ?? null;
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  const groupOrder = (anchor: string | null): string[] => {
    const group = groups.get(anchor) ?? [];
    const groupSet = new Set(group);
    const groupEdges: [string, string][] = [];
    for (const list of [local, remote]) {
      const selected = list.filter((id) => groupSet.has(id));
      for (let i = 1; i < selected.length; i++) groupEdges.push([selected[i - 1], selected[i]]);
    }
    const sorted = sortedByConstraints(group, groupEdges);
    if (sorted) return sorted;
    orderConflict();
    return unique(context.resolution === 'remote' ? remote : local, group).filter((id) => groupSet.has(id));
  };
  return [...groupOrder(null), ...core.flatMap((id) => [id, ...groupOrder(id)])];
}

function mergeKeyedList(base: Entity[], local: Entity[], remote: Entity[], path: string, context: MergeContext): Entity[] {
  const maps = [base, local, remote].map((list) => new Map(list.map((entry) => [entry.id, entry])));
  const merged = new Map<string, Entity>();
  for (const id of unique(...[base, local, remote].map((list) => list.map((entry) => entry.id)))) {
    const value = mergeValue(maps[0].get(id), maps[1].get(id), maps[2].get(id), `${path}[${id}]`, context);
    if (value !== undefined) merged.set(id, value as Entity);
  }
  return mergeOrder(base.map((entry) => entry.id), local.map((entry) => entry.id), remote.map((entry) => entry.id),
    [...merged.keys()], `${path}.order`, context).map((id) => merged.get(id)!);
}

function mergeValue(base: unknown, local: unknown, remote: unknown, path: string, context: MergeContext): unknown {
  if (equal(local, remote)) return copy(local);
  if (equal(base, local)) return copy(remote);
  if (equal(base, remote)) return copy(local);
  if (local === undefined || remote === undefined) return copy(context.conflict(path, local, remote));
  if (isObject(local) && isObject(remote) && (base === undefined || isObject(base))) {
    const before = isObject(base) ? base : {};
    // Switching the visible content variant conflicts with an edit to the old
    // variant as a whole. Resolving only its hidden body field would retain the
    // new type and make the explicitly selected old-variant edit invisible.
    if (path.endsWith('.card.content') && local.type !== remote.type) {
      return copy(context.conflict(path, local, remote));
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(local), ...Object.keys(remote)]);
    return Object.fromEntries([...keys].map((key) => [key, mergeValue(field(before, key), field(local, key), field(remote, key), `${path}.${key}`, context)])
      .filter(([, value]) => value !== undefined));
  }
  if (Array.isArray(local) && Array.isArray(remote) && (base === undefined || Array.isArray(base))) {
    const lists = [base ?? [], local, remote] as unknown[][];
    if (lists.flat().every((entry) => isObject(entry) && typeof entry.id === 'string')) {
      return mergeKeyedList(entities(lists[0], path), entities(local, path), entities(remote, path), path, context);
    }
    if (/(?:^|\.)(labels|hiddenColumnIds)$/.test(path) && lists.flat().every((entry) => typeof entry === 'string')) {
      const [b, l, r] = lists as string[][];
      return unique(l, r).filter((id) => !b.includes(id) || (l.includes(id) && r.includes(id)));
    }
  }
  return copy(context.conflict(path, local, remote));
}

function comparableCard(entry: CardEntry | undefined): unknown {
  return entry && { columnId: entry.columnId, card: without(entry.card, ['updatedAt']) };
}

function comparableColumn(column: Entity): unknown {
  return { ...without(column, ['order', 'cards']), cards: (column.cards as Entity[]).map((card) => without(card, ['updatedAt'])) };
}

function wasReordered(id: string, base: Snapshot, side: Snapshot): boolean {
  const before = base.cards.get(id), after = side.cards.get(id);
  if (!before || !after || before.columnId !== after.columnId) return !!before && !!after;
  const b = base.cardOrder.get(before.columnId) ?? [], s = side.cardOrder.get(after.columnId) ?? [];
  return b.some((other) => s.includes(other) && (b.indexOf(other) < b.indexOf(id)) !== (s.indexOf(other) < s.indexOf(id)));
}

function latestTimestamp(...values: unknown[]): unknown {
  const defined = values.filter((value) => value !== undefined);
  const valid = defined.filter((value): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return valid.length ? valid.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest) : defined.at(-1);
}

/** Three-way merge with board-wide card identity. A resolution changes only
 * conflicting choices; independent edits from either side are always retained.
 * Unresolved conflicts return a local-choice draft and must not be persisted. */
export function mergeBoardDocuments(base: BoardDocument, local: BoardDocument, remote: BoardDocument, resolution?: Resolution): {
  document: BoardDocument;
  conflicts: BoardMergeConflict[];
} {
  const conflicts: BoardMergeConflict[] = [];
  const context: MergeContext = {
    resolution, conflicts,
    conflict: (path, l, r) => {
      if (!conflicts.some((conflict) => conflict.path === path)) conflicts.push({ path, local: copy(l), remote: copy(r) });
      return resolution === 'remote' ? r : l;
    },
  };
  const [b, l, r] = [base, local, remote].map(snapshot);
  const columns = new Map<string, Entity>();
  // A column deletion is atomic with deletion of its children. Keeping a column
  // after a delete/edit conflict must also keep its otherwise unchanged children.
  for (const id of unique(b.columnOrder, l.columnOrder, r.columnOrder)) {
    const bc = b.columns.get(id), lc = l.columns.get(id), rc = r.columns.get(id);
    let value: unknown;
    if (bc && (!lc || !rc) && (lc || rc)) {
      const kept = (lc ?? rc)!;
      if (!equal(comparableColumn(bc), comparableColumn(kept))) {
        value = context.conflict(`data.columns[${id}]`, lc, rc);
        if (value !== undefined) {
          const deletedSide = !lc ? l : r;
          for (const cardId of b.cardOrder.get(id) ?? []) {
            if (!deletedSide.cards.has(cardId)) deletedSide.cards.set(cardId, b.cards.get(cardId)!);
          }
        }
      } // Otherwise the unopposed deletion wins.
    } else {
      value = mergeValue(bc && without(bc, ['cards', 'order']), lc && without(lc, ['cards', 'order']),
        rc && without(rc, ['cards', 'order']), `data.columns[${id}]`, context);
    }
    if (value !== undefined) columns.set(id, copy(without(value as Value, ['cards', 'order'])) as Entity);
  }
  const cards = new Map<string, CardEntry>();
  for (const id of unique([...b.cards.keys()], [...l.cards.keys()], [...r.cards.keys()])) {
    const bc = b.cards.get(id), lc = l.cards.get(id), rc = r.cards.get(id);
    let merged: unknown;
    if (bc && (!lc || !rc) && (lc || rc) &&
      (!equal(comparableCard(bc), comparableCard(lc ?? rc)) || wasReordered(id, b, lc ? l : r))) {
      merged = context.conflict(`data.cards[${id}]`, comparableCard(lc), comparableCard(rc));
    } else {
      merged = mergeValue(comparableCard(bc), comparableCard(lc), comparableCard(rc), `data.cards[${id}]`, context);
    }
    if (merged !== undefined) {
      const entry = copy(merged) as CardEntry;
      // Rejecting a move into a deleted column leaves an existing card in its
      // surviving source. A newly added card has no source to return to and is
      // part of the rejected column addition, so it must not become an orphan.
      if (!columns.has(entry.columnId)) {
        const surviving = [lc, rc].find((candidate) => candidate && columns.has(candidate.columnId));
        if (!surviving) continue;
        entry.columnId = surviving.columnId;
      }
      const timestamp = latestTimestamp(bc?.card.updatedAt, lc?.card.updatedAt, rc?.card.updatedAt);
      if (timestamp !== undefined) entry.card.updatedAt = timestamp;
      cards.set(id, entry);
    }
  }
  const columnOrder = mergeOrder(b.columnOrder, l.columnOrder, r.columnOrder, [...columns.keys()], 'data.columns.order', context);
  const mergedColumns = columnOrder.map((id, order) => {
    const alive = [...cards].filter(([, entry]) => entry.columnId === id).map(([cardId]) => cardId);
    const cardOrder = mergeOrder(b.cardOrder.get(id) ?? [], l.cardOrder.get(id) ?? [], r.cardOrder.get(id) ?? [], alive,
      `data.columns[${id}].cards.order`, context);
    return { ...columns.get(id)!, order, cards: cardOrder.map((cardId) => cards.get(cardId)!.card) };
  });
  const data = mergeValue(without(base.data, ['columns']), without(local.data, ['columns']), without(remote.data, ['columns']), 'data', context) as Value;
  return {
    document: {
      name: mergeValue(base.name, local.name, remote.name, 'name', context) as string,
      description: mergeValue(base.description, local.description, remote.description, 'description', context) as string | null,
      data: { ...data, columns: mergedColumns },
    },
    conflicts,
  };
}

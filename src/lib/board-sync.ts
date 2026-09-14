import type { Board } from '@/types';
import { documentsEqual, mergeBoardDocuments, type BoardDocument, type BoardMergeConflict } from './board-merge';

export interface BoardSyncState {
  status: 'saved' | 'pending' | 'saving' | 'error' | 'conflict' | 'deleted';
  message?: string;
  conflicts?: BoardMergeConflict[];
}

export interface BoardSnapshot {
  board: Board;
  document: BoardDocument;
  revision: string;
}

interface SyncHooks {
  read: (id: string) => Promise<BoardSnapshot | null>;
  write: (id: string, revision: string, document: BoardDocument) => Promise<BoardSnapshot | null>;
  local: (id: string) => BoardDocument | undefined;
  apply: (snapshot: BoardSnapshot, document: BoardDocument) => void;
  remove: (id: string) => void;
  state: (id: string, state: BoardSyncState) => void;
}

interface Entry {
  base: BoardSnapshot;
  ready: boolean;
  deleted: boolean;
  forgotten?: boolean;
  timer?: ReturnType<typeof setTimeout>;
  flight?: Promise<void>;
  incoming?: BoardSnapshot;
  status: BoardSyncState['status'];
  conflictRevision?: string;
  resolution?: { revision: string; choice: 'local' | 'remote' };
}

// Preserve PostgreSQL's microseconds: Date alone rounds different revisions to
// the same millisecond, which can cause a new realtime event to be discarded.
function revisionTime(value: string): bigint {
  const fraction = /\.(\d+)/.exec(value)?.[1] ?? '';
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new Error('Board has an invalid saved revision');
  return BigInt(millis) * 1000n + BigInt(fraction.padEnd(6, '0').slice(3, 6));
}

/** Coordinates one serialized writer per board, preserving optimistic drafts. */
export class BoardSyncCoordinator {
  private entries = new Map<string, Entry>();
  private disposed = false;
  private hooks: SyncHooks;
  private delay: number;
  constructor(hooks: SyncHooks, delay = 400) { this.hooks = hooks; this.delay = delay; }

  private active(id: string, entry: Entry) {
    return !this.disposed && this.entries.get(id) === entry && !entry.deleted;
  }

  private setState(id: string, entry: Entry, state: BoardSyncState) {
    if (this.disposed || this.entries.get(id) !== entry) return;
    entry.status = state.status;
    this.hooks.state(id, state);
  }

  private hasEdits(id: string, entry: Entry) {
    const local = this.hooks.local(id);
    return !!local && !documentsEqual(local, entry.base.document);
  }

  register(snapshot: BoardSnapshot, creating = false) {
    if (this.disposed) return;
    const id = snapshot.board.id;
    this.entries.set(id, { base: structuredClone(snapshot), ready: !creating, deleted: false, status: creating ? 'saving' : 'saved' });
    this.hooks.state(id, { status: creating ? 'saving' : 'saved' });
  }

  isCreating(id: string) { return this.entries.get(id)?.ready === false; }

  getBaseline(id: string): BoardDocument | undefined {
    if (this.disposed) return undefined;
    const document = this.entries.get(id)?.base.document;
    return document && structuredClone(document);
  }

  created(snapshot: BoardSnapshot) {
    const entry = this.entries.get(snapshot.board.id);
    if (!entry || this.disposed) return;
    entry.ready = true;
    // The optimistic creation time came from this device; only the server
    // acknowledgement establishes a comparable database revision.
    entry.base.revision = snapshot.revision;
    if (entry.deleted) return;
    this.observe(snapshot);
    const incoming = entry.incoming;
    entry.incoming = undefined;
    if (incoming) this.observe(incoming);
    if (this.hasEdits(snapshot.board.id, entry)) this.schedule(snapshot.board.id);
  }

  failed(id: string, message: string) {
    const entry = this.entries.get(id);
    if (entry && this.active(id, entry)) this.setState(id, entry, { status: 'error', message });
  }

  observe(snapshot: BoardSnapshot) {
    if (this.disposed) return;
    const id = snapshot.board.id;
    const entry = this.entries.get(id);
    if (!entry) {
      this.register(snapshot);
      this.hooks.apply(snapshot, snapshot.document);
      return;
    }
    if (!this.active(id, entry)) return;
    if (entry.flight || !entry.ready) {
      if (!entry.incoming || revisionTime(snapshot.revision) > revisionTime(entry.incoming.revision)) entry.incoming = snapshot;
      return;
    }
    if (revisionTime(snapshot.revision) < revisionTime(entry.base.revision)) return;
    if (entry.conflictRevision && revisionTime(snapshot.revision) < revisionTime(entry.conflictRevision)) return;
    const local = this.hooks.local(id);
    if (!local) return;
    try {
      const merged = mergeBoardDocuments(entry.base.document, local, snapshot.document);
      if (merged.conflicts.length) {
        entry.conflictRevision = snapshot.revision;
        this.setState(id, entry, { status: 'conflict', conflicts: merged.conflicts });
        return;
      }
      entry.base = structuredClone(snapshot);
      entry.conflictRevision = undefined;
      this.hooks.apply(snapshot, merged.document);
      if (!documentsEqual(merged.document, snapshot.document)) this.schedule(id);
      else this.setState(id, entry, { status: 'saved' });
    } catch (error) {
      this.failed(id, error instanceof Error ? error.message : 'Unable to reconcile board changes');
    }
  }

  schedule(id: string) {
    const entry = this.entries.get(id);
    if (!entry || !this.active(id, entry)) return;
    if (entry.timer) clearTimeout(entry.timer);
    this.setState(id, entry, { status: entry.flight || !entry.ready ? 'saving' : 'pending' });
    entry.timer = setTimeout(() => { entry.timer = undefined; void this.flush(id); }, this.delay);
  }

  /** Reconcile a form with the board version at opening and the current draft.
   * Wait for dispatched saves before changing its baseline: their finalizers
   * must never clear a conflict discovered by the newly submitted form. */
  async stage(id: string, ancestor: BoardDocument, draft: BoardDocument, acknowledgedAtOpening?: BoardDocument): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || this.disposed || entry.forgotten) return;
    const opening = structuredClone(ancestor);
    const submitted = structuredClone(draft);
    const acknowledged = structuredClone(acknowledgedAtOpening ?? ancestor);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    while (entry.flight) {
      await entry.flight;
      if (this.disposed || this.entries.get(id) !== entry || entry.forgotten) return;
    }
    // A flight finalizer can schedule another save while stage awaits it.
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    const current = this.hooks.local(id) ?? (entry.deleted ? entry.base.document : undefined);
    if (!current) return;
    const merged = mergeBoardDocuments(opening, submitted, current);
    this.hooks.apply(entry.base, merged.document);
    entry.resolution = undefined;
    if (entry.deleted) {
      this.setState(id, entry, { status: 'deleted', message: 'This board was deleted or is no longer available. Your unsaved edits are kept in this tab.' });
      return;
    }
    if (merged.conflicts.length) {
      // Reverse only the form's changes onto the acknowledged ancestor. An
      // opening document may contain older unsaved changes, while the form may
      // explicitly restore a value from before those changes were saved. This
      // baseline preserves both without treating either as an unchanged value.
      const conflictBase = mergeBoardDocuments(submitted, opening, acknowledged, 'local').document;
      entry.base = { ...entry.base, document: conflictBase };
      entry.conflictRevision = entry.base.revision;
      this.setState(id, entry, { status: 'conflict', conflicts: merged.conflicts });
      return;
    }
    this.schedule(id);
  }

  resolve(id: string, choice: 'local' | 'remote') {
    const entry = this.entries.get(id);
    if (!entry?.conflictRevision || !this.active(id, entry)) return;
    entry.resolution = { revision: entry.conflictRevision, choice };
    void this.flush(id);
  }

  async flush(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry || !this.active(id, entry) || !entry.ready) return;
    if (entry.flight) return entry.flight;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = undefined;
    const current = this.hooks.local(id);
    if (!current) return;
    const local = structuredClone(current);
    const base = entry.base;
    const resolution = entry.resolution;
    entry.resolution = undefined;
    this.setState(id, entry, { status: 'saving' });
    const run = async () => {
      let rejectedRevision: string | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        const latest = await this.hooks.read(id);
        if (!this.active(id, entry)) return;
        if (!latest) { this.remoteDeleted(id); return; }
        if (latest.revision === rejectedRevision) throw new Error('Your edits could not be saved. Check your access and retry.');
        const choice = resolution?.revision === latest.revision ? resolution.choice : undefined;
        const merged = mergeBoardDocuments(base.document, local, latest.document, choice);
        if (merged.conflicts.length && !choice) {
          entry.conflictRevision = latest.revision;
          this.setState(id, entry, { status: 'conflict', conflicts: merged.conflicts });
          return;
        }
        const saved = documentsEqual(merged.document, latest.document)
          ? latest
          : await this.hooks.write(id, latest.revision, merged.document);
        if (!this.active(id, entry)) return;
        if (!saved) { rejectedRevision = latest.revision; continue; }
        const now = this.hooks.local(id);
        if (!now) return;
        // Edits made while the request was running are based on the sent local
        // draft, not on the earlier remote baseline or the response snapshot.
        const remaining = mergeBoardDocuments(local, now, saved.document);
        if (remaining.conflicts.length) {
          entry.base = { ...structuredClone(saved), document: local };
          entry.conflictRevision = saved.revision;
          this.setState(id, entry, { status: 'conflict', conflicts: remaining.conflicts });
          return;
        }
        entry.base = structuredClone(saved);
        entry.conflictRevision = undefined;
        this.hooks.apply(saved, remaining.document);
        this.setState(id, entry, { status: documentsEqual(remaining.document, saved.document) ? 'saved' : 'pending' });
        return;
      }
      throw new Error('The board keeps changing elsewhere. Your edits are kept; retry when it settles.');
    };
    entry.flight = run().catch((error: unknown) => {
      if (this.active(id, entry)) this.failed(id, error instanceof Error ? error.message : 'Unable to save changes. Your edits are kept.');
    }).finally(() => {
      entry.flight = undefined;
      if (!this.active(id, entry)) return;
      const incoming = entry.incoming;
      entry.incoming = undefined;
      if (incoming) this.observe(incoming);
      if (entry.status === 'pending') this.schedule(id);
    });
    return entry.flight;
  }

  remoteDeleted(id: string) {
    const entry = this.entries.get(id);
    if (!entry || !this.active(id, entry)) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.deleted = true;
    if (this.hasEdits(id, entry) || entry.flight || !entry.ready) {
      this.setState(id, entry, { status: 'deleted', message: 'This board was deleted or is no longer available. Your unsaved edits are kept in this tab.' });
    } else {
      this.hooks.remove(id);
    }
  }

  forget(id: string) {
    const entry = this.entries.get(id);
    if (entry) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.deleted = true; // Tombstone rejects delayed events and responses.
      entry.forgotten = true;
      return entry.flight;
    }
  }

  resume(id: string) {
    const entry = this.entries.get(id);
    if (!entry || this.disposed) return;
    entry.deleted = false;
    entry.forgotten = false;
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) if (entry.timer) clearTimeout(entry.timer);
    this.entries.clear();
  }
}

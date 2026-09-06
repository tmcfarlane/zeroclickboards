import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, Column } from '@/types';
import type { BoardDocument } from '../board-merge';
import { BoardSyncCoordinator, type BoardSnapshot, type BoardSyncState } from '../board-sync';

const BOARD_ID = 'board-1';
const revisions = {
  first: '2026-09-06T12:00:00.123001+00:00',
  second: '2026-09-06T12:00:00.123002+00:00',
  third: '2026-09-06T12:00:00.123003+00:00',
  fourth: '2026-09-06T12:00:00.123004+00:00',
};

function card(id = 'card-1', title = 'Original card'): Card {
  return { id, title, content: { type: 'text', text: '' }, createdAt: revisions.first, updatedAt: revisions.first };
}

function document(): BoardDocument {
  return {
    name: 'Original board',
    description: null,
    data: { columns: [{ id: 'column-1', title: 'To Do', order: 0, cards: [card()] }] },
  };
}

function columns(value: BoardDocument): Column[] {
  return value.data.columns as Column[];
}

function snapshot(value = document(), revision = revisions.first): BoardSnapshot {
  return {
    board: {
      id: BOARD_ID, name: value.name, description: value.description ?? undefined,
      columns: structuredClone(columns(value)), userId: 'user-1', createdAt: revisions.first, updatedAt: revision,
    },
    document: structuredClone(value),
    revision,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function harness(options: { creating?: boolean } = {}) {
  const initial = snapshot();
  let remote: BoardSnapshot | null = structuredClone(initial);
  let local: BoardDocument | undefined = structuredClone(initial.document);
  let status: BoardSyncState = { status: 'saved' };
  let serial = 10;
  const hooks = {
    read: vi.fn(async (): Promise<BoardSnapshot | null> => structuredClone(remote)),
    write: vi.fn(async (_id: string, expectedRevision: string, value: BoardDocument): Promise<BoardSnapshot | null> => {
      if (!remote || remote.revision !== expectedRevision) return null;
      remote = snapshot(value, `2026-09-06T12:00:00.123${String(serial++).padStart(3, '0')}+00:00`);
      return structuredClone(remote);
    }),
    local: vi.fn(() => local),
    apply: vi.fn((_snapshot: BoardSnapshot, value: BoardDocument) => { local = structuredClone(value); }),
    remove: vi.fn(() => { local = undefined; }),
    state: vi.fn((_id: string, value: BoardSyncState) => { status = value; }),
  };
  const coordinator = new BoardSyncCoordinator(hooks);
  coordinator.register(initial, options.creating);
  return {
    coordinator, hooks, initial,
    get local() { return local!; },
    get remote() { return remote; },
    get status() { return status; },
    edit(change: (draft: BoardDocument) => void, schedule = true) {
      const draft = structuredClone(local!);
      change(draft);
      local = draft;
      if (schedule) coordinator.schedule(BOARD_ID);
    },
    setRemote(change: (draft: BoardDocument) => void, revision = revisions.second) {
      const draft = structuredClone(remote!.document);
      change(draft);
      remote = snapshot(draft, revision);
      return structuredClone(remote);
    },
    clearRemote() { remote = null; },
  };
}

describe('BoardSyncCoordinator', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

  it.each(['local', 'remote'] as const)('retains a board rename that was pending before a form conflict resolved to %s', async (choice) => {
    const h = harness();
    const acknowledged = h.coordinator.getBaseline(BOARD_ID)!;
    h.edit((value) => { value.name = 'Pending rename before opening'; });
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Form title';
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards[0].title = 'Remote title'; }));
    await h.coordinator.stage(BOARD_ID, ancestor, draft, acknowledged);
    expect(h.status.status).toBe('conflict');
    h.coordinator.resolve(BOARD_ID, choice);
    await h.coordinator.flush(BOARD_ID);
    expect(h.remote!.document.name).toBe('Pending rename before opening');
    expect(columns(h.remote!.document)[0].cards[0].title).toBe(choice === 'local' ? 'Form title' : 'Remote title');
    expect(h.status.status).toBe('saved');
  });

  it.each(['local', 'remote'] as const)('retains a card deletion that was pending before a form conflict resolved to %s', async (choice) => {
    const h = harness();
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards.push(card('delete-me', 'Existing card')); }));
    const acknowledged = h.coordinator.getBaseline(BOARD_ID)!;
    h.edit((value) => { columns(value)[0].cards.pop(); });
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Form title';
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards[0].title = 'Remote title'; }, revisions.third));
    await h.coordinator.stage(BOARD_ID, ancestor, draft, acknowledged);
    expect(h.status.status).toBe('conflict');
    h.coordinator.resolve(BOARD_ID, choice);
    await h.coordinator.flush(BOARD_ID);
    expect(columns(h.remote!.document)[0].cards.map((value) => value.id)).toEqual(['card-1']);
    expect(columns(h.remote!.document)[0].cards[0].title).toBe(choice === 'local' ? 'Form title' : 'Remote title');
    expect(h.status.status).toBe('saved');
  });

  it('keeps an explicit form revert conflict after its opening pending value was saved', async () => {
    const h = harness();
    const acknowledged = h.coordinator.getBaseline(BOARD_ID)!;
    h.edit((value) => { columns(value)[0].cards[0].title = 'Pending before opening'; });
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Original card';
    await h.coordinator.flush(BOARD_ID);
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards[0].title = 'Later remote title'; }, '2026-09-06T12:00:01.000001Z'));
    await h.coordinator.stage(BOARD_ID, ancestor, draft, acknowledged);
    expect(h.status.status).toBe('conflict');
    await h.coordinator.flush(BOARD_ID);
    expect(h.status.status).toBe('conflict');
    expect(columns(h.local)[0].cards[0].title).toBe('Original card');
    h.coordinator.resolve(BOARD_ID, 'local');
    await h.coordinator.flush(BOARD_ID);
    expect(columns(h.remote!.document)[0].cards[0].title).toBe('Original card');
  });

  it.each(['local', 'remote'] as const)('preserves a pending checklist completion when its form text conflict resolves to %s', async (choice) => {
    const h = harness();
    h.coordinator.observe(h.setRemote((value) => {
      columns(value)[0].cards[0].content = { type: 'checklist', checklist: [{ id: 'item', text: 'Original item', completed: false }] };
    }));
    const acknowledged = h.coordinator.getBaseline(BOARD_ID)!;
    h.edit((value) => { columns(value)[0].cards[0].content.checklist![0].completed = true; });
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].content.checklist![0].text = 'Form item';
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards[0].content.checklist![0].text = 'Remote item'; }, revisions.third));
    await h.coordinator.stage(BOARD_ID, ancestor, draft, acknowledged);
    expect(h.status.status).toBe('conflict');
    h.coordinator.resolve(BOARD_ID, choice);
    await h.coordinator.flush(BOARD_ID);
    expect(columns(h.remote!.document)[0].cards[0].content.checklist).toEqual([
      { id: 'item', text: choice === 'local' ? 'Form item' : 'Remote item', completed: true },
    ]);
    expect(h.status.status).toBe('saved');
  });

  it('preserves pending label removal and addition alongside form and remote additions through conflict resolution', async () => {
    const h = harness();
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards[0].labels = ['red']; }));
    const acknowledged = h.coordinator.getBaseline(BOARD_ID)!;
    h.edit((value) => { columns(value)[0].cards[0].labels = ['blue']; });
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].labels!.push('green');
    columns(draft)[0].cards[0].title = 'Form title';
    h.coordinator.observe(h.setRemote((value) => {
      columns(value)[0].cards[0].title = 'Remote title';
      columns(value)[0].cards[0].labels!.push('yellow');
    }, revisions.third));
    await h.coordinator.stage(BOARD_ID, ancestor, draft, acknowledged);
    expect(h.status.status).toBe('conflict');
    h.coordinator.resolve(BOARD_ID, 'remote');
    await h.coordinator.flush(BOARD_ID);
    expect(columns(h.remote!.document)[0].cards[0].title).toBe('Remote title');
    expect(columns(h.remote!.document)[0].cards[0].labels).toEqual(['blue', 'green', 'yellow']);
    expect(h.status.status).toBe('saved');
  });

  it('returns an isolated baseline snapshot for an editor session', () => {
    const h = harness();
    const baseline = h.coordinator.getBaseline(BOARD_ID)!;
    baseline.name = 'Changed copy';
    expect(h.coordinator.getBaseline(BOARD_ID)!.name).toBe('Original board');
    h.coordinator.dispose();
    expect(h.coordinator.getBaseline(BOARD_ID)).toBeUndefined();
  });

  it('stages an open form edit while retaining remote label changes', async () => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Form title';
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards[0].labels = ['blue']; }));
    await h.coordinator.stage(BOARD_ID, ancestor, draft);
    expect(columns(h.local)[0].cards[0]).toMatchObject({ title: 'Form title', labels: ['blue'] });
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(h.remote!.document)[0].cards[0]).toMatchObject({ title: 'Form title', labels: ['blue'] });
    expect(h.status.status).toBe('saved');
  });

  it.each(['local', 'remote'] as const)('keeps an editor conflict after the realtime baseline advanced and resolves to %s', async (choice) => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Form title';
    draft.description = 'Independent form description';
    h.coordinator.observe(h.setRemote((value) => {
      columns(value)[0].cards[0].title = 'Remote title';
      columns(value)[0].cards[0].labels = ['green'];
    }));
    await h.coordinator.stage(BOARD_ID, ancestor, draft);
    expect(h.status.status).toBe('conflict');
    await vi.advanceTimersByTimeAsync(800);
    expect(h.hooks.write).not.toHaveBeenCalled();
    await h.coordinator.flush(BOARD_ID);
    expect(h.status.status).toBe('conflict');
    expect(h.hooks.write).not.toHaveBeenCalled();
    h.coordinator.resolve(BOARD_ID, choice);
    await h.coordinator.flush(BOARD_ID);
    expect(columns(h.remote!.document)[0].cards[0]).toMatchObject({ title: choice === 'local' ? 'Form title' : 'Remote title', labels: ['green'] });
    expect(h.remote!.document.description).toBe('Independent form description');
    expect(h.status.status).toBe('saved');
  });

  it('waits for an in-flight save before staging an editor conflict', async () => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Submitted form title';
    h.edit((value) => { columns(value)[0].cards[0].title = 'Already dispatched title'; });
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    const staging = h.coordinator.stage(BOARD_ID, ancestor, draft);
    expect(columns(h.local)[0].cards[0].title).toBe('Already dispatched title');
    pending.resolve(h.setRemote((value) => { columns(value)[0].cards[0].title = 'Already dispatched title'; }));
    await Promise.all([flight, staging]);
    expect(h.status.status).toBe('conflict');
    expect(columns(h.local)[0].cards[0].title).toBe('Submitted form title');
    await vi.advanceTimersByTimeAsync(800);
    expect(h.status.status).toBe('conflict');
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
  });

  it('stages a form onto the card current location after a remote move', async () => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].description = 'Open form edit';
    h.coordinator.observe(h.setRemote((value) => {
      const moved = columns(value)[0].cards.pop()!;
      columns(value).push({ id: 'destination', title: 'Moved', cards: [moved], order: 1 });
    }));
    await h.coordinator.stage(BOARD_ID, ancestor, draft);
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(h.remote!.document)[0].cards).toHaveLength(0);
    expect(columns(h.remote!.document)[1].cards[0]).toMatchObject({ id: 'card-1', description: 'Open form edit' });
  });

  it('keeps a deleted card form as a reviewable conflict instead of silently dropping it', async () => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Recoverable form';
    h.coordinator.observe(h.setRemote((value) => { columns(value)[0].cards = []; }));
    await h.coordinator.stage(BOARD_ID, ancestor, draft);
    expect(h.status.status).toBe('conflict');
    expect(columns(h.local)[0].cards[0].title).toBe('Recoverable form');
    await h.coordinator.flush(BOARD_ID);
    expect(h.status.status).toBe('conflict');
    expect(h.hooks.write).not.toHaveBeenCalled();
    h.coordinator.resolve(BOARD_ID, 'local');
    await h.coordinator.flush(BOARD_ID);
    expect(columns(h.remote!.document)[0].cards[0].title).toBe('Recoverable form');
  });

  it('keeps submitted form edits for recovery after an unchanged board was deleted remotely', async () => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Deleted board form draft';
    h.coordinator.remoteDeleted(BOARD_ID);
    expect(h.hooks.remove).toHaveBeenCalledOnce();
    await h.coordinator.stage(BOARD_ID, ancestor, draft);
    expect(h.status.status).toBe('deleted');
    expect(columns(h.local)[0].cards[0].title).toBe('Deleted board form draft');
    await h.coordinator.flush(BOARD_ID);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.hooks.write).not.toHaveBeenCalled();
  });

  it('preserves other pending edits when an open form is staged on a deleted board', async () => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    columns(draft)[0].cards[0].title = 'Form title';
    h.edit((value) => { value.description = 'Other unsaved edit'; });
    h.coordinator.remoteDeleted(BOARD_ID);
    await h.coordinator.stage(BOARD_ID, ancestor, draft);
    expect(h.local.description).toBe('Other unsaved edit');
    expect(columns(h.local)[0].cards[0].title).toBe('Form title');
    expect(h.status.status).toBe('deleted');
  });

  it.each(['forget', 'dispose'] as const)('does not resurrect a board after %s while staging waits for a save', async (action) => {
    const h = harness();
    const ancestor = structuredClone(h.local), draft = structuredClone(ancestor);
    draft.name = 'Late form';
    const pending = deferred<BoardSnapshot | null>();
    h.edit((value) => { value.description = 'Saving'; });
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    const staging = h.coordinator.stage(BOARD_ID, ancestor, draft);
    if (action === 'forget') h.coordinator.forget(BOARD_ID);
    else h.coordinator.dispose();
    const applications = h.hooks.apply.mock.calls.length;
    pending.resolve(h.setRemote((value) => { value.description = 'Saving'; }));
    await Promise.all([flight, staging]);
    expect(h.hooks.apply).toHaveBeenCalledTimes(applications);
  });

  it('debounces the latest draft into one save', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'First name'; });
    await vi.advanceTimersByTimeAsync(200);
    h.edit((draft) => { draft.name = 'Final name'; draft.description = 'Local description'; });
    await vi.advanceTimersByTimeAsync(399);
    expect(h.hooks.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
    expect(h.remote?.document).toMatchObject({ name: 'Final name', description: 'Local description' });
    expect(h.status.status).toBe('saved');
  });

  it('preserves a pending edit when a realtime update adds a card and unknown data', async () => {
    const h = harness();
    h.edit((draft) => { columns(draft)[0].cards[0].title = 'Browser title'; });
    const incoming = h.setRemote((draft) => {
      columns(draft)[0].cards.push(card('mcp-card', 'From MCP'));
      draft.data.futureSetting = { enabled: true };
    });
    h.coordinator.observe(incoming);
    expect(columns(h.local)[0].cards.map((item) => item.title)).toEqual(['Browser title', 'From MCP']);
    await vi.advanceTimersByTimeAsync(400);
    expect(columns(h.remote!.document)[0].cards.map((item) => item.title)).toEqual(['Browser title', 'From MCP']);
    expect(h.remote?.document.data.futureSetting).toEqual({ enabled: true });
    expect(h.hooks.write.mock.calls[0][1]).toBe(revisions.second);
    expect(h.status.status).toBe('saved');
  });

  it('accepts microsecond-newer events and rejects older events within the same millisecond', () => {
    const h = harness();
    const newer = h.setRemote((draft) => { draft.name = 'Newest'; }, revisions.third);
    h.coordinator.observe(newer);
    h.coordinator.observe(snapshot({ ...document(), name: 'Stale' }, revisions.second));
    expect(h.local.name).toBe('Newest');
    expect(h.hooks.apply).toHaveBeenCalledTimes(1);
  });

  it('recognizes equivalent revisions written with UTC Z or an offset', () => {
    const h = harness();
    h.coordinator.observe(snapshot({ ...document(), name: 'Newest' }, '2026-09-06T05:00:00.123003-07:00'));
    h.coordinator.observe(snapshot({ ...document(), name: 'Stale' }, '2026-09-06T12:00:00.123002Z'));
    expect(h.local.name).toBe('Newest');
  });

  it('keeps edits made during a write after its own realtime echo and response', async () => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Sent name'; });
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
    const saved = h.setRemote((draft) => { draft.name = 'Sent name'; });
    h.edit((draft) => { draft.name = 'Newer local name'; });
    h.coordinator.observe(saved);
    pending.resolve(saved);
    await flight;
    expect(h.local.name).toBe('Newer local name');
    expect(h.status.status).toBe('pending');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.write).toHaveBeenCalledTimes(2);
    expect(h.remote?.document.name).toBe('Newer local name');
    expect(h.status.status).toBe('saved');
  });

  it('serializes repeated flushes and timer firings while a save is in flight', async () => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Saved name'; });
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    const duplicate = h.coordinator.flush(BOARD_ID);
    h.edit((draft) => { draft.description = 'Second save'; });
    await vi.advanceTimersByTimeAsync(500);
    expect(h.hooks.read).toHaveBeenCalledTimes(1);
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
    pending.resolve(h.setRemote((draft) => { draft.name = 'Saved name'; }));
    await Promise.all([flight, duplicate]);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.write).toHaveBeenCalledTimes(2);
    expect(h.remote?.document.description).toBe('Second save');
  });

  it('uses the newest queued realtime snapshot after an in-flight request', async () => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Browser name'; });
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    const saved = h.setRemote((draft) => { draft.name = 'Browser name'; });
    const newest = h.setRemote((draft) => { columns(draft)[0].cards[0].title = 'Newest remote title'; }, revisions.fourth);
    h.coordinator.observe(newest);
    h.coordinator.observe(snapshot({ ...saved.document, description: 'Stale event' }, revisions.third));
    pending.resolve(saved);
    await flight;
    expect(columns(h.local)[0].cards[0].title).toBe('Newest remote title');
    expect(h.local.description).toBeNull();
    expect(h.status.status).toBe('saved');
  });

  it('rereads after a compare-and-swap miss and retains concurrent MCP additions', async () => {
    const h = harness();
    h.hooks.write.mockImplementationOnce(async () => {
      h.setRemote((draft) => { columns(draft)[0].cards.push(card('remote-card', 'Remote addition')); });
      return null;
    });
    h.edit((draft) => { draft.name = 'Browser name'; });
    await h.coordinator.flush(BOARD_ID);
    expect(h.hooks.read).toHaveBeenCalledTimes(2);
    expect(h.hooks.write).toHaveBeenCalledTimes(2);
    expect(h.hooks.write.mock.calls.map((call) => call[1])).toEqual([revisions.first, revisions.second]);
    expect(h.remote?.document.name).toBe('Browser name');
    expect(columns(h.remote!.document)[0].cards.map((item) => item.id)).toEqual(['card-1', 'remote-card']);
  });

  it('treats a repeated unchanged revision after zero updated rows as an access error', async () => {
    const h = harness();
    h.hooks.write.mockResolvedValue(null);
    h.edit((draft) => { draft.name = 'Unsaved name'; });
    await h.coordinator.flush(BOARD_ID);
    expect(h.hooks.read).toHaveBeenCalledTimes(2);
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
    expect(h.status).toMatchObject({ status: 'error', message: expect.stringContaining('access') });
    expect(h.local.name).toBe('Unsaved name');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
  });

  it.each(['local', 'remote'] as const)('resolves only conflicting fields with the %s choice', async (choice) => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Browser name'; draft.description = 'Browser description'; });
    const incoming = h.setRemote((draft) => {
      draft.name = 'Remote name';
      columns(draft)[0].cards.push(card('remote-card', 'Remote addition'));
    });
    h.coordinator.observe(incoming);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.status.status).toBe('conflict');
    expect(h.status.conflicts?.some((item) => item.path === 'name')).toBe(true);
    expect(h.hooks.write).not.toHaveBeenCalled();
    expect(h.local.name).toBe('Browser name');
    h.coordinator.resolve(BOARD_ID, choice);
    await h.coordinator.flush(BOARD_ID);
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
    expect(h.remote?.document.name).toBe(choice === 'local' ? 'Browser name' : 'Remote name');
    expect(h.remote?.document.description).toBe('Browser description');
    expect(columns(h.remote!.document)[0].cards.map((item) => item.id)).toContain('remote-card');
    expect(h.status.status).toBe('saved');
  });

  it('asks again instead of applying an old conflict choice to a changed remote revision', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Browser name'; });
    h.coordinator.observe(h.setRemote((draft) => { draft.name = 'First remote name'; }));
    h.setRemote((draft) => { draft.name = 'Second remote name'; }, revisions.third);
    h.coordinator.resolve(BOARD_ID, 'local');
    await h.coordinator.flush(BOARD_ID);
    expect(h.hooks.write).not.toHaveBeenCalled();
    expect(h.status.status).toBe('conflict');
    expect(h.status.conflicts).toContainEqual({ path: 'name', local: 'Browser name', remote: 'Second remote name' });
    h.coordinator.resolve(BOARD_ID, 'local');
    await h.coordinator.flush(BOARD_ID);
    expect(h.remote?.document.name).toBe('Browser name');
    expect(h.hooks.write.mock.calls[0][1]).toBe(revisions.third);
  });

  it('accepts the remote choice without an unnecessary write when no independent local edits remain', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Browser name'; });
    h.coordinator.observe(h.setRemote((draft) => { draft.name = 'Remote name'; }));
    h.coordinator.resolve(BOARD_ID, 'remote');
    await h.coordinator.flush(BOARD_ID);
    expect(h.hooks.write).not.toHaveBeenCalled();
    expect(h.local.name).toBe('Remote name');
    expect(h.status.status).toBe('saved');
  });

  it('reads the latest remote value when an unresolved local conflict is undone to the original baseline', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Browser name'; });
    h.coordinator.observe(h.setRemote((draft) => { draft.name = 'Remote name'; }));
    expect(h.status.status).toBe('conflict');
    h.edit((draft) => { draft.name = h.initial.document.name; });
    await h.coordinator.flush(BOARD_ID);
    expect(h.hooks.read).toHaveBeenCalledOnce();
    expect(h.local.name).toBe('Remote name');
    expect(h.hooks.write).not.toHaveBeenCalled();
    expect(h.status.status).toBe('saved');
  });

  it('reconciles a later undo to the baseline after an in-flight save discovers a remote conflict', async () => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.read.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Sent name'; });
    const flight = h.coordinator.flush(BOARD_ID);
    h.edit((draft) => { draft.name = h.initial.document.name; });
    const incoming = h.setRemote((draft) => { draft.name = 'Concurrent remote name'; });
    pending.resolve(incoming);
    await flight;
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.read).toHaveBeenCalledTimes(2);
    expect(h.local.name).toBe('Concurrent remote name');
    expect(h.hooks.write).not.toHaveBeenCalled();
    expect(h.status.status).toBe('saved');
  });

  it('keeps an undo performed during conflict resolution as a new explicit choice', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Browser name'; draft.description = 'Independent local description'; });
    h.coordinator.observe(h.setRemote((draft) => {
      draft.name = 'Remote name';
      columns(draft)[0].cards[0].title = 'Remote card title';
    }));
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    h.coordinator.resolve(BOARD_ID, 'remote');
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    h.edit((draft) => { draft.name = h.initial.document.name; });
    const saved = h.setRemote((draft) => { draft.description = 'Independent local description'; }, revisions.third);
    pending.resolve(saved);
    await flight;
    expect(h.status.status).toBe('conflict');
    expect(h.local.name).toBe('Original board');
    await h.coordinator.flush(BOARD_ID);
    expect(h.status.status).toBe('conflict');
    expect(h.hooks.write).toHaveBeenCalledOnce();
    h.coordinator.resolve(BOARD_ID, 'local');
    await h.coordinator.flush(BOARD_ID);
    expect(h.status.status).toBe('saved');
    expect(h.remote?.document).toMatchObject({ name: 'Original board', description: 'Independent local description' });
    expect(columns(h.remote!.document)[0].cards[0].title).toBe('Remote card title');
  });

  it.each(['read', 'write'] as const)('keeps the draft after a %s error and saves it on explicit retry', async (operation) => {
    const h = harness();
    h.hooks[operation].mockRejectedValueOnce(new Error('Connection interrupted'));
    h.edit((draft) => { draft.name = 'Recoverable draft'; });
    await h.coordinator.flush(BOARD_ID);
    expect(h.status).toMatchObject({ status: 'error', message: 'Connection interrupted' });
    expect(h.local.name).toBe('Recoverable draft');
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.hooks[operation]).toHaveBeenCalledTimes(1);
    await h.coordinator.flush(BOARD_ID);
    expect(h.remote?.document.name).toBe('Recoverable draft');
    expect(h.status.status).toBe('saved');
  });

  it('removes an unchanged remotely deleted board and rejects a delayed update', async () => {
    const h = harness();
    h.coordinator.remoteDeleted(BOARD_ID);
    h.coordinator.observe(snapshot({ ...document(), name: 'Delayed update' }, revisions.second));
    h.coordinator.schedule(BOARD_ID);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.remove).toHaveBeenCalledOnce();
    expect(h.hooks.apply).not.toHaveBeenCalled();
    expect(h.hooks.read).not.toHaveBeenCalled();
  });

  it('keeps an unsaved draft after remote deletion but stops saving or resurrecting it', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Last local draft'; });
    h.coordinator.remoteDeleted(BOARD_ID);
    h.coordinator.observe(snapshot({ ...document(), name: 'Delayed update' }, revisions.second));
    await vi.advanceTimersByTimeAsync(400);
    await h.coordinator.flush(BOARD_ID);
    expect(h.local.name).toBe('Last local draft');
    expect(h.status.status).toBe('deleted');
    expect(h.hooks.remove).not.toHaveBeenCalled();
    expect(h.hooks.write).not.toHaveBeenCalled();
  });

  it('treats a missing row during a save as deletion while retaining the draft', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Missing board draft'; });
    h.clearRemote();
    await h.coordinator.flush(BOARD_ID);
    expect(h.status.status).toBe('deleted');
    expect(h.local.name).toBe('Missing board draft');
    expect(h.hooks.write).not.toHaveBeenCalled();
  });

  it.each(['forget', 'remoteDeleted'] as const)('ignores an in-flight write response after %s', async (remove) => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Sent draft'; });
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    h.coordinator[remove](BOARD_ID);
    const stateCount = h.hooks.state.mock.calls.length;
    const saved = h.setRemote((draft) => { draft.name = 'Sent draft'; });
    h.coordinator.observe(saved);
    pending.resolve(saved);
    await flight;
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.hooks.apply).not.toHaveBeenCalled();
    expect(h.hooks.state).toHaveBeenCalledTimes(stateCount);
    expect(h.hooks.write).toHaveBeenCalledTimes(1);
  });

  it('queues edits during creation and saves them after the create acknowledgement', async () => {
    const h = harness({ creating: true });
    h.edit((draft) => { columns(draft)[0].cards.push(card('animated-card', 'Generated card')); });
    await vi.advanceTimersByTimeAsync(400);
    expect(h.coordinator.isCreating(BOARD_ID)).toBe(true);
    expect(h.hooks.read).not.toHaveBeenCalled();
    h.coordinator.created(h.setRemote(() => {}, revisions.second));
    expect(h.coordinator.isCreating(BOARD_ID)).toBe(false);
    expect(columns(h.local)[0].cards.map((item) => item.id)).toContain('animated-card');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.write).toHaveBeenCalledOnce();
    expect(columns(h.remote!.document)[0].cards.map((item) => item.id)).toContain('animated-card');
    expect(h.status.status).toBe('saved');
  });

  it('acknowledges creation when the server clock is behind the optimistic local timestamp', () => {
    const h = harness({ creating: true });
    const acknowledged = h.setRemote(() => {}, '2026-09-06T11:59:58.123001+00:00');
    h.coordinator.created(acknowledged);
    expect(h.coordinator.isCreating(BOARD_ID)).toBe(false);
    expect(h.status.status).toBe('saved');
    expect(h.hooks.apply).toHaveBeenCalledWith(acknowledged, acknowledged.document);
    h.coordinator.observe(snapshot({ ...document(), name: 'After creation' }, '2026-09-06T11:59:59.123001+00:00'));
    expect(h.local.name).toBe('After creation');
  });

  it('applies remote updates queued during creation without losing generated local cards', async () => {
    const h = harness({ creating: true });
    h.edit((draft) => { columns(draft)[0].cards.push(card('generated-card', 'Generated')); });
    const acknowledgement = snapshot(document(), revisions.second);
    const incoming = h.setRemote((draft) => { draft.description = 'Remote description'; }, revisions.third);
    h.coordinator.observe(incoming);
    h.coordinator.created(acknowledgement);
    expect(h.local.description).toBe('Remote description');
    expect(columns(h.local)[0].cards.map((item) => item.id)).toContain('generated-card');
    await vi.advanceTimersByTimeAsync(400);
    expect(h.remote?.document.description).toBe('Remote description');
    expect(h.status.status).toBe('saved');
  });

  it('rejects a create acknowledgement after local deletion', async () => {
    const h = harness({ creating: true });
    h.edit((draft) => { draft.name = 'Created then deleted'; });
    h.coordinator.forget(BOARD_ID);
    const stateCount = h.hooks.state.mock.calls.length;
    h.coordinator.created(snapshot({ ...document(), name: 'Created then deleted' }, revisions.second));
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.apply).not.toHaveBeenCalled();
    expect(h.hooks.state).toHaveBeenCalledTimes(stateCount);
    expect(h.hooks.read).not.toHaveBeenCalled();
  });

  it('cancels queued saves and ignores stale session events when disposed', async () => {
    const h = harness();
    h.edit((draft) => { draft.name = 'Old account draft'; });
    h.coordinator.dispose();
    const stateCount = h.hooks.state.mock.calls.length;
    h.coordinator.observe(snapshot({ ...document(), name: 'Old account event' }, revisions.second));
    h.coordinator.created(snapshot(document(), revisions.third));
    await vi.advanceTimersByTimeAsync(400);
    expect(h.hooks.read).not.toHaveBeenCalled();
    expect(h.hooks.apply).not.toHaveBeenCalled();
    expect(h.hooks.state).toHaveBeenCalledTimes(stateCount);
  });

  it('does not start a write after an old session read resolves', async () => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.read.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Old session draft'; });
    const flight = h.coordinator.flush(BOARD_ID);
    h.coordinator.dispose();
    pending.resolve(h.initial);
    await flight;
    expect(h.hooks.write).not.toHaveBeenCalled();
    expect(h.hooks.apply).not.toHaveBeenCalled();
  });

  it('does not apply a write response or error after the auth session is disposed', async () => {
    const h = harness();
    const pending = deferred<BoardSnapshot | null>();
    h.hooks.write.mockImplementationOnce(() => pending.promise);
    h.edit((draft) => { draft.name = 'Old session draft'; });
    const flight = h.coordinator.flush(BOARD_ID);
    await Promise.resolve();
    h.coordinator.dispose();
    const stateCount = h.hooks.state.mock.calls.length;
    pending.reject(new Error('Old account network error'));
    await flight;
    expect(h.hooks.apply).not.toHaveBeenCalled();
    expect(h.hooks.state).toHaveBeenCalledTimes(stateCount);
  });
});

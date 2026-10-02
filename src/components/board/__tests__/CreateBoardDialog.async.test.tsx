import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Column } from '@/types';
import { CreateBoardDialog } from '../CreateBoardDialog';

const mocks = vi.hoisted(() => ({
  auth: { session: { access_token: 'fixture-token', user: { id: 'account-1' } } as { access_token: string; user: { id: string } } | null, isSignedIn: true },
  state: { currentUserId: 'account-1' as string | null, boards: [] as Array<{ id: string; userId: string | null; columns: Column[] | undefined }> },
  createBoard: vi.fn(), setActiveBoard: vi.fn(),
  updateUsage: vi.fn(), success: vi.fn(), error: vi.fn(), readFile: vi.fn(),
}));
vi.mock('@/components/auth/AuthProvider', () => ({ useAuthContext: () => mocks.auth }));
vi.mock('@/hooks/useAIUsage', () => ({ useAIUsage: () => ({ used: 0, limit: 10, isLimitReached: false, isPaid: false, resetsAt: null, updateUsage: mocks.updateUsage }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('@/lib/templates', () => ({ getAllBoardTemplates: () => [], templateToColumns: vi.fn() }));
vi.mock('@/lib/board-io', () => ({ readFileAsJSON: mocks.readFile, validateBoardJSON: () => ({ valid: true, payload: {} }), importBoardFromJSON: () => ({ name: 'Imported old private board', columns: [] }) }));
vi.mock('@/store/useBoardStore', () => ({ useBoardStore: Object.assign(
  () => ({ createBoard: mocks.createBoard, setActiveBoard: mocks.setActiveBoard }),
  { getState: () => mocks.state },
) }));

const completeTemplate = [
  { title: 'First column', sampleCards: [{ title: 'Detailed task', description: 'Task description', content: { type: 'text', text: 'All accepted details' }, labels: ['green', 'blue'] }] },
  { title: 'Remaining column', sampleCards: [{ title: 'Accepted checklist', content: { type: 'checklist', checklist: [{ text: 'First step' }, { text: 'Second step' }] }, labels: ['yellow'] }] },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function response(name = 'Generated private board', columns: unknown[] = [], description?: string) {
  return { ok: true, status: 200, json: async () => ({ template: { name, description, columns }, usage: { used: 1, limit: 10, charged: true, warning: false } }) } as Response;
}
function Harness() {
  const [open, setOpen] = useState(true);
  return <><button onClick={() => setOpen(true)}>Reopen board dialog</button><CreateBoardDialog isOpen={open} onOpenChange={setOpen} onOpenSignIn={vi.fn()} onUpgrade={vi.fn()} /></>;
}
function generate(prompt = 'Private old prompt') {
  fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to build?' }), { target: { value: prompt } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate with AI' }));
}
async function settle(request: ReturnType<typeof deferred<Response>>, value = response()) {
  await act(async () => { request.resolve(value); await request.promise; });
}
function changeAccount() {
  mocks.auth = { session: { access_token: 'second-token', user: { id: 'account-2' } }, isSignedIn: true };
  mocks.state.currentUserId = 'account-2';
}
function expectCompleteSnapshot() {
  expect(mocks.state.boards[0]).toMatchObject({ userId: 'account-1', columns: [
    { id: expect.any(String), title: 'First column', order: 0, cards: [{ id: expect.any(String), title: 'Detailed task', description: 'Task description', content: { type: 'text', text: 'All accepted details' }, labels: ['green', 'blue'], isArchived: false, createdAt: expect.any(String), updatedAt: expect.any(String) }] },
    { id: expect.any(String), title: 'Remaining column', order: 1, cards: [{ id: expect.any(String), title: 'Accepted checklist', content: { type: 'checklist', checklist: [{ id: expect.any(String), text: 'First step', completed: false }, { id: expect.any(String), text: 'Second step', completed: false }] }, labels: ['yellow'] }] },
  ] });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = { session: { access_token: 'fixture-token', user: { id: 'account-1' } }, isSignedIn: true };
  mocks.state = { currentUserId: 'account-1', boards: [] };
  mocks.createBoard.mockImplementation((_name, _description, columns) => {
    const id = mocks.state.boards.length ? `generated-board-${mocks.state.boards.length + 1}` : 'generated-board';
    mocks.state.boards.push({ id, userId: mocks.state.currentUserId, columns }); return id;
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('board creation async lifecycle', () => {
  it('aborts cancellation and preserves a reopened prompt even if the transport still succeeds', async () => {
    const request = deferred<Response>(); const fetch = vi.fn().mockReturnValue(request.promise); vi.stubGlobal('fetch', fetch);
    render(<Harness />); generate();
    const signal = fetch.mock.calls[0][1].signal as AbortSignal;
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen board dialog' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'What do you want to build?' }), { target: { value: 'A newer unsent prompt' } });
    await settle(request);
    expect(signal.aborted).toBe(true);
    expect(screen.getByRole('textbox', { name: 'What do you want to build?' })).toHaveValue('A newer unsent prompt');
    expect(mocks.createBoard).not.toHaveBeenCalled();
    expect(mocks.updateUsage).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('does not let a superseded response or finally reset a newer pending attempt', async () => {
    const first = deferred<Response>(); const second = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise));
    render(<Harness />); generate();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); fireEvent.click(screen.getByRole('button', { name: 'Reopen board dialog' })); generate('Newer submitted prompt');
    await settle(first);
    expect(screen.getByRole('textbox', { name: 'What do you want to build?' })).toHaveValue('Newer submitted prompt');
    expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
    expect(mocks.createBoard).not.toHaveBeenCalled();
    await settle(second, response('The correct new board'));
    expect(mocks.createBoard).toHaveBeenCalledExactlyOnceWith('The correct new board', undefined, []);
  });

  it('ignores previous-account results without closing the current form or changing usage', async () => {
    const request = deferred<Response>(); vi.stubGlobal('fetch', vi.fn().mockReturnValue(request.promise));
    const view = render(<Harness />); generate(); changeAccount(); view.rerender(<Harness />);
    await settle(request);
    expect(screen.getByRole('dialog', { name: 'Create New Board' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'What do you want to build?' })).toHaveValue('');
    expect(mocks.createBoard).not.toHaveBeenCalled(); expect(mocks.updateUsage).not.toHaveBeenCalled(); expect(mocks.success).not.toHaveBeenCalled();
  });

  it('ignores results after unmount even when another account is now in the store', async () => {
    const request = deferred<Response>(); const fetch = vi.fn().mockReturnValue(request.promise); vi.stubGlobal('fetch', fetch);
    const view = render(<Harness />); generate(); view.unmount(); changeAccount(); await settle(request);
    expect((fetch.mock.calls[0][1].signal as AbortSignal).aborted).toBe(true);
    expect(mocks.createBoard).not.toHaveBeenCalled(); expect(mocks.success).not.toHaveBeenCalled();
  });

  it('checks cancellation again after waiting for response JSON', async () => {
    const body = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body.promise }));
    render(<Harness />); generate(); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => { body.resolve(await response().json()); });
    expect(mocks.createBoard).not.toHaveBeenCalled(); expect(mocks.updateUsage).not.toHaveBeenCalled();
  });

  it('creates the complete initial snapshot before closing, with every card, checklist item, and label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('Accepted plan', completeTemplate, 'Board description')));
    render(<Harness />); generate(); await act(async () => {});
    expect(mocks.createBoard).toHaveBeenCalledExactlyOnceWith('Accepted plan', 'Board description', mocks.state.boards[0].columns);
    expectCompleteSnapshot();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Board generated — edit anything you like');
  });

  it.each(['logout', 'account change'] as const)('keeps accepted content complete across immediate %s without later creation under the successor identity', async transition => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('Accepted plan', completeTemplate)));
    const view = render(<Harness />); generate(); await act(async () => {});
    expectCompleteSnapshot();
    const snapshot = structuredClone(mocks.state.boards[0]);
    if (transition === 'logout') { mocks.auth = { session: null, isSignedIn: false }; mocks.state.currentUserId = null; }
    else changeAccount();
    view.rerender(<Harness />); await act(async () => {});
    expect(mocks.state.boards[0]).toEqual(snapshot);
    expect(mocks.createBoard).toHaveBeenCalledOnce(); expect(mocks.success).toHaveBeenCalledOnce();
  });

  it('retains composition Enter guards and generates once after composition ends', async () => {
    const request = deferred<Response>(); const fetch = vi.fn().mockReturnValue(request.promise); vi.stubGlobal('fetch', fetch);
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'What do you want to build?' });
    fireEvent.change(input, { target: { value: 'Completed composition' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input); fireEvent.keyDown(input, { key: 'Enter' });
    expect(fetch).toHaveBeenCalledOnce(); await settle(request);
    expect(mocks.createBoard).toHaveBeenCalledOnce();
  });

  it('shows a current failure and allows retry without creating a board', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    render(<Harness />); generate(); await act(async () => {});
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Could not generate board. Try a simpler prompt.');
    expect(screen.getByRole('textbox', { name: 'What do you want to build?' })).toHaveValue('Private old prompt');
    expect(screen.getByRole('button', { name: 'Generate with AI' })).toBeEnabled(); expect(mocks.createBoard).not.toHaveBeenCalled();
  });

  it('does not import a previous-account file after its asynchronous read completes', async () => {
    const read = deferred<unknown>(); mocks.readFile.mockReturnValue(read.promise);
    const view = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
    const file = document.body.querySelector('input[type="file"]')!;
    fireEvent.change(file, { target: { files: [new File(['{}'], 'private.json', { type: 'application/json' })] } });
    changeAccount(); view.rerender(<Harness />);
    await act(async () => { read.resolve({}); });
    expect(mocks.createBoard).not.toHaveBeenCalled(); expect(mocks.success).not.toHaveBeenCalled();
  });

  it('retains the complete accepted snapshot after reopening and cancelling the creation form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('Accepted plan', completeTemplate)));
    render(<Harness />); generate(); await act(async () => {});
    expectCompleteSnapshot(); const snapshot = structuredClone(mocks.state.boards[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen board dialog' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await act(async () => {});
    expect(mocks.state.boards[0]).toEqual(snapshot); expect(mocks.createBoard).toHaveBeenCalledOnce();
  });

  it.each(['generation', 'manual', 'import'] as const)('preserves an accepted board while starting a same-account %s successor', async successor => {
    const pending = deferred<Response>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('Accepted plan', completeTemplate)).mockReturnValueOnce(pending.promise));
    mocks.readFile.mockResolvedValue({});
    render(<Harness />); generate(); await act(async () => {});
    expectCompleteSnapshot(); const snapshot = structuredClone(mocks.state.boards[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Reopen board dialog' }));
    if (successor === 'generation') generate('New pending plan');
    else {
      fireEvent.click(screen.getByRole('button', { name: 'Advanced options' }));
      if (successor === 'manual') {
        fireEvent.change(screen.getByRole('textbox', { name: /^Name$/ }), { target: { value: 'Manual successor' } });
        fireEvent.click(screen.getByRole('button', { name: /^Create Board$/ }));
      } else fireEvent.change(document.body.querySelector('input[type="file"]')!, { target: { files: [new File(['{}'], 'new.json', { type: 'application/json' })] } });
    }
    await act(async () => {});
    expect(mocks.state.boards[0]).toEqual(snapshot);
    if (successor === 'generation') {
      expect(screen.getByRole('button', { name: 'Generating...' })).toBeDisabled();
      await settle(pending, response('New completed plan'));
    }
    expect(mocks.createBoard).toHaveBeenCalledTimes(2);
  });

  it('retains the full accepted snapshot when navigation immediately unmounts the form', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response('Accepted plan', completeTemplate)));
    const view = render(<Harness />); generate(); await act(async () => {});
    expectCompleteSnapshot(); const snapshot = structuredClone(mocks.state.boards[0]);
    view.unmount(); changeAccount(); await act(async () => {});
    expect(mocks.state.boards[0]).toEqual(snapshot); expect(mocks.createBoard).toHaveBeenCalledOnce(); expect(mocks.success).toHaveBeenCalledOnce();
  });
});

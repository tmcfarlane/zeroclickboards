import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

function fireKey(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  document.body.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  const callbacks = {
    onNewCard: vi.fn(),
    onSearch: vi.fn(),
    onToggleAI: vi.fn(),
    onBoardView: vi.fn(),
    onTimelineView: vi.fn(),
    onNewBoard: vi.fn(),
    onShowShortcuts: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // cleanup is handled by renderHook's unmount
  });

  it('n triggers onNewCard', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('n');
    expect(callbacks.onNewCard).toHaveBeenCalledOnce();
    unmount();
  });

  it('Shift+N triggers onNewBoard', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('n', { shiftKey: true });
    expect(callbacks.onNewBoard).toHaveBeenCalledOnce();
    expect(callbacks.onNewCard).not.toHaveBeenCalled();
    unmount();
  });

  it('/ triggers onSearch', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('/');
    expect(callbacks.onSearch).toHaveBeenCalledOnce();
    unmount();
  });

  it('? triggers onShowShortcuts', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('?');
    expect(callbacks.onShowShortcuts).toHaveBeenCalledOnce();
    unmount();
  });

  it('a triggers onToggleAI', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('a');
    expect(callbacks.onToggleAI).toHaveBeenCalledOnce();
    unmount();
  });

  it('b triggers onBoardView', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('b');
    expect(callbacks.onBoardView).toHaveBeenCalledOnce();
    unmount();
  });

  it('t triggers onTimelineView', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('t');
    expect(callbacks.onTimelineView).toHaveBeenCalledOnce();
    unmount();
  });

  it('Ctrl+Z triggers onUndo', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('z', { ctrlKey: true });
    expect(callbacks.onUndo).toHaveBeenCalledOnce();
    unmount();
  });

  it('Cmd+Z triggers onUndo', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('z', { metaKey: true });
    expect(callbacks.onUndo).toHaveBeenCalledOnce();
    unmount();
  });

  it('Ctrl+Shift+Z triggers onRedo', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('z', { ctrlKey: true, shiftKey: true });
    expect(callbacks.onRedo).toHaveBeenCalledOnce();
    expect(callbacks.onUndo).not.toHaveBeenCalled();
    unmount();
  });

  it('ignores shortcuts when target is an INPUT', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    const input = document.createElement('input');
    document.body.appendChild(input);
    const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
    input.dispatchEvent(event);
    expect(callbacks.onNewCard).not.toHaveBeenCalled();
    document.body.removeChild(input);
    unmount();
  });

  it('ignores shortcuts when target is a TEXTAREA', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
    textarea.dispatchEvent(event);
    expect(callbacks.onToggleAI).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
    unmount();
  });

  it('ignores shortcuts inside a dialog', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const child = document.createElement('div');
    dialog.appendChild(child);
    document.body.appendChild(dialog);
    const event = new KeyboardEvent('keydown', { key: 'b', bubbles: true });
    child.dispatchEvent(event);
    expect(callbacks.onBoardView).not.toHaveBeenCalled();
    document.body.removeChild(dialog);
    unmount();
  });

  it('ignores letter keys with alt modifier', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('n', { altKey: true });
    expect(callbacks.onNewCard).not.toHaveBeenCalled();
    unmount();
  });

  it('does not trigger Shift+A for onToggleAI', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    fireKey('a', { shiftKey: true });
    expect(callbacks.onToggleAI).not.toHaveBeenCalled();
    unmount();
  });

  it('cleans up event listener on unmount', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts(callbacks));
    unmount();
    fireKey('n');
    expect(callbacks.onNewCard).not.toHaveBeenCalled();
  });
});

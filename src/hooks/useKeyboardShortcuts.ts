import { useEffect, useCallback } from 'react';

interface KeyboardShortcutCallbacks {
  onNewCard?: () => void;        // n - new card (open card creator on first column)
  onSearch?: () => void;          // / - focus search input
  onToggleAI?: () => void;        // a - toggle AI assistant
  onBoardView?: () => void;       // b - switch to board view
  onTimelineView?: () => void;    // t - switch to timeline view
  onNewBoard?: () => void;        // shift+n - new board
  onShowShortcuts?: () => void;   // ? or shift+/ - show shortcuts help
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Don't trigger shortcuts when typing in inputs, textareas, or contenteditable
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.isContentEditable ||
      target.closest('[role="dialog"]')  // Don't trigger in dialogs
    ) {
      return;
    }

    // Don't trigger with modifier keys (except shift for shift combos)
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    switch (e.key) {
      case 'n':
        if (e.shiftKey) {
          e.preventDefault();
          callbacks.onNewBoard?.();
        } else {
          e.preventDefault();
          callbacks.onNewCard?.();
        }
        break;
      case '/':
        e.preventDefault();
        callbacks.onSearch?.();
        break;
      case '?':
        e.preventDefault();
        callbacks.onShowShortcuts?.();
        break;
      case 'a':
        if (!e.shiftKey) {
          e.preventDefault();
          callbacks.onToggleAI?.();
        }
        break;
      case 'b':
        if (!e.shiftKey) {
          e.preventDefault();
          callbacks.onBoardView?.();
        }
        break;
      case 't':
        if (!e.shiftKey) {
          e.preventDefault();
          callbacks.onTimelineView?.();
        }
        break;
    }
  }, [callbacks]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}

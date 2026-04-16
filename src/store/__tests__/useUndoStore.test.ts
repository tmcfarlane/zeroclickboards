import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useUndoStore } from '../useUndoStore';

beforeEach(() => {
  useUndoStore.setState({ undoStack: [], redoStack: [], _skipRecord: false });
});

describe('useUndoStore', () => {
  describe('pushAction', () => {
    it('adds an action to the undo stack', () => {
      useUndoStore.getState().pushAction({
        description: 'Test action',
        undo: vi.fn(),
        redo: vi.fn(),
      });

      expect(useUndoStore.getState().undoStack).toHaveLength(1);
      expect(useUndoStore.getState().undoStack[0].description).toBe('Test action');
    });

    it('clears redo stack on new action', () => {
      const undoFn = vi.fn();
      const redoFn = vi.fn();
      useUndoStore.getState().pushAction({ description: 'A1', undo: undoFn, redo: redoFn });
      useUndoStore.getState().undo();
      expect(useUndoStore.getState().redoStack).toHaveLength(1);

      useUndoStore.getState().pushAction({ description: 'A2', undo: vi.fn(), redo: vi.fn() });
      expect(useUndoStore.getState().redoStack).toHaveLength(0);
    });

    it('caps at MAX_HISTORY (50)', () => {
      for (let i = 0; i < 60; i++) {
        useUndoStore.getState().pushAction({
          description: `Action ${i}`,
          undo: vi.fn(),
          redo: vi.fn(),
        });
      }

      expect(useUndoStore.getState().undoStack).toHaveLength(50);
      expect(useUndoStore.getState().undoStack[49].description).toBe('Action 59');
    });

    it('skips recording when _skipRecord is true', () => {
      useUndoStore.setState({ _skipRecord: true });
      useUndoStore.getState().pushAction({
        description: 'Should not record',
        undo: vi.fn(),
        redo: vi.fn(),
      });
      expect(useUndoStore.getState().undoStack).toHaveLength(0);
    });
  });

  describe('undo', () => {
    it('calls the undo function of the last action', () => {
      const undoFn = vi.fn();
      useUndoStore.getState().pushAction({ description: 'Test', undo: undoFn, redo: vi.fn() });
      useUndoStore.getState().undo();

      expect(undoFn).toHaveBeenCalledOnce();
    });

    it('moves action from undo to redo stack', () => {
      useUndoStore.getState().pushAction({ description: 'Test', undo: vi.fn(), redo: vi.fn() });
      useUndoStore.getState().undo();

      expect(useUndoStore.getState().undoStack).toHaveLength(0);
      expect(useUndoStore.getState().redoStack).toHaveLength(1);
    });

    it('does nothing when stack is empty', () => {
      useUndoStore.getState().undo();
      expect(useUndoStore.getState().undoStack).toHaveLength(0);
      expect(useUndoStore.getState().redoStack).toHaveLength(0);
    });
  });

  describe('redo', () => {
    it('calls the redo function', () => {
      const redoFn = vi.fn();
      useUndoStore.getState().pushAction({ description: 'Test', undo: vi.fn(), redo: redoFn });
      useUndoStore.getState().undo();
      useUndoStore.getState().redo();

      expect(redoFn).toHaveBeenCalledOnce();
    });

    it('moves action from redo to undo stack', () => {
      useUndoStore.getState().pushAction({ description: 'Test', undo: vi.fn(), redo: vi.fn() });
      useUndoStore.getState().undo();
      useUndoStore.getState().redo();

      expect(useUndoStore.getState().undoStack).toHaveLength(1);
      expect(useUndoStore.getState().redoStack).toHaveLength(0);
    });

    it('does nothing when redo stack is empty', () => {
      useUndoStore.getState().redo();
      expect(useUndoStore.getState().redoStack).toHaveLength(0);
    });
  });

  describe('clearHistory', () => {
    it('empties both stacks', () => {
      useUndoStore.getState().pushAction({ description: 'A', undo: vi.fn(), redo: vi.fn() });
      useUndoStore.getState().pushAction({ description: 'B', undo: vi.fn(), redo: vi.fn() });
      useUndoStore.getState().undo();

      useUndoStore.getState().clearHistory();

      expect(useUndoStore.getState().undoStack).toHaveLength(0);
      expect(useUndoStore.getState().redoStack).toHaveLength(0);
    });
  });

  describe('canUndo / canRedo', () => {
    it('canUndo returns false when stack is empty', () => {
      expect(useUndoStore.getState().canUndo()).toBe(false);
    });

    it('canUndo returns true when stack has items', () => {
      useUndoStore.getState().pushAction({ description: 'A', undo: vi.fn(), redo: vi.fn() });
      expect(useUndoStore.getState().canUndo()).toBe(true);
    });

    it('canRedo returns false when redo stack is empty', () => {
      expect(useUndoStore.getState().canRedo()).toBe(false);
    });

    it('canRedo returns true after undo', () => {
      useUndoStore.getState().pushAction({ description: 'A', undo: vi.fn(), redo: vi.fn() });
      useUndoStore.getState().undo();
      expect(useUndoStore.getState().canRedo()).toBe(true);
    });
  });
});

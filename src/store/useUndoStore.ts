import { create } from 'zustand';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';

interface UndoableAction {
  id: string;
  description: string;
  timestamp: number;
  undo: () => void;
  redo: () => void;
}

interface UndoStore {
  undoStack: UndoableAction[];
  redoStack: UndoableAction[];
  _skipRecord: boolean;

  pushAction: (action: Pick<UndoableAction, 'description' | 'undo' | 'redo'>) => void;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const MAX_HISTORY = 50;

export const useUndoStore = create<UndoStore>()((set, get) => ({
  undoStack: [],
  redoStack: [],
  _skipRecord: false,

  pushAction: (action) => {
    if (get()._skipRecord) return;
    const full: UndoableAction = {
      ...action,
      id: uuidv4(),
      timestamp: Date.now(),
    };
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(MAX_HISTORY - 1)), full],
      redoStack: [], // new action invalidates redo
    }));
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];

    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, action],
      _skipRecord: true,
    }));

    action.undo();

    set({ _skipRecord: false });

    toast(`Undid: ${action.description}`, {
      action: {
        label: 'Redo',
        onClick: () => get().redo(),
      },
    });
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return;
    const action = redoStack[redoStack.length - 1];

    set((state) => ({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, action],
      _skipRecord: true,
    }));

    action.redo();

    set({ _skipRecord: false });

    toast(`Redid: ${action.description}`);
  },

  clearHistory: () => {
    set({ undoStack: [], redoStack: [] });
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));

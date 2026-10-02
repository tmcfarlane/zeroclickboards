import { createContext, useContext } from 'react';

export type BoardTextDialogTarget =
  | { kind: 'rename-board'; boardId: string }
  | { kind: 'rename-column'; boardId: string; columnId: string }
  | { kind: 'add-column'; boardId: string };

export type BoardTextDialogRequest = BoardTextDialogTarget & { initialTitle: string };

export const BoardDialogContext = createContext<{
  openTextDialog: (target: BoardTextDialogTarget) => void;
  openShareDialog: (boardId: string) => void;
} | null>(null);

export function useBoardDialogs() {
  const context = useContext(BoardDialogContext);
  if (!context) throw new Error('Board dialogs must be rendered inside AppShell');
  return context;
}

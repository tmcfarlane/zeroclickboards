import { useBoardStore } from '@/store/useBoardStore';
import { useActivityLogger } from '@/hooks/useActivityLogger';
import { CardEditor, type CardEditorSaveData } from './CardEditor';

/** Lives in the app shell so moving or filtering a card cannot unmount its draft. */
export function ActiveCardEditor() {
  const session = useBoardStore((state) => state.cardEditorSession);
  const close = useBoardStore((state) => state.closeCardEditor);
  const save = useBoardStore((state) => state.saveCardEditor);
  const { logActivity } = useActivityLogger();
  if (!session) return null;

  const handleSave = (data: CardEditorSaveData, initialForm?: CardEditorSaveData) => {
    const previous = initialForm ?? session.card;
    if (data.title !== previous.title) {
      logActivity(session.cardId, 'renamed', { from: previous.title, to: data.title });
    }
    const oldLabels = previous.labels ?? [];
    const added = data.labels.filter((label) => !oldLabels.includes(label));
    const removed = oldLabels.filter((label) => !data.labels.includes(label));
    if (added.length || removed.length) logActivity(session.cardId, 'label_changed', { added, removed });
    if (data.targetDate !== previous.targetDate) {
      logActivity(session.cardId, 'date_changed', { from: previous.targetDate ?? null, to: data.targetDate ?? null });
    }
    save(data, initialForm);
  };

  const handleDelete = () => {
    const store = useBoardStore.getState();
    const column = store.boards.find((board) => board.id === session.boardId)?.columns
      .find((candidate) => candidate.cards.some((card) => card.id === session.cardId));
    if (column) store.removeCard(session.boardId, column.id, session.cardId);
    close();
  };

  return (
    <CardEditor
      key={`${session.boardId}:${session.cardId}`}
      isOpen
      onClose={close}
      onSave={handleSave}
      onDelete={handleDelete}
      mode="edit"
      cardId={session.cardId}
      initialData={session.card}
    />
  );
}

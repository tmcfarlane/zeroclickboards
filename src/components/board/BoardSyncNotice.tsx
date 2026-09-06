import { useId } from 'react';
import { AlertCircle, CloudUpload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { BoardSyncState } from '@/lib/board-sync';
import type { Board, RecurrenceConfig } from '@/types';
import { formatRecurrence } from '@/lib/recurrence';
import { useBoardStore } from '@/store/useBoardStore';

interface BoardSyncNoticeProps {
  boardId: string;
}

const noticeClassName = 'flex w-full flex-wrap items-center gap-3 border-b border-white/10 bg-[#111b1a] px-4 py-3 text-sm text-[#F2F7F7]';
const secondaryButtonClassName = 'border-white/15 bg-transparent text-[#F2F7F7] hover:bg-white/10 hover:text-[#F2F7F7]';
const primaryButtonClassName = 'gradient-cyan text-[#0B0F0F] hover:opacity-90';

function readableValue(value: unknown, path: string): string {
  if (value === undefined) return 'Removed';
  if (value === null) return 'None';
  if (value === '') return '(Empty text)';
  if (typeof value === 'string') return value;
  if (/^data\.cards\[[^\]]+\]\.card\.recurrence$/.test(path) && typeof value === 'object' && !Array.isArray(value)) {
    const rule = value as Partial<RecurrenceConfig>;
    const knownFields = Object.keys(value).every((key) => ['frequency', 'interval', 'daysOfWeek', 'dayOfMonth'].includes(key));
    if (knownFields && ['daily', 'weekly', 'monthly'].includes(rule.frequency ?? '') && Number.isInteger(rule.interval) && rule.interval! > 0 &&
      (rule.daysOfWeek === undefined || (rule.frequency === 'weekly' && Array.isArray(rule.daysOfWeek) && rule.daysOfWeek.every((day) => Number.isInteger(day) && day >= 0 && day <= 6))) &&
      (rule.dayOfMonth === undefined || (rule.frequency === 'monthly' && Number.isInteger(rule.dayOfMonth) && rule.dayOfMonth >= 1 && rule.dayOfMonth <= 31))) {
      const label = formatRecurrence(rule as RecurrenceConfig);
      return rule.frequency === 'monthly' && rule.dayOfMonth === undefined ? `${label} on the target date’s day` : label;
    }
  }
  return JSON.stringify(value, null, 2) ?? String(value);
}

function conflictLabel(path: string, board: Board | undefined): string {
  const names: Record<string, string> = {
    name: 'Name', description: 'Description', 'data.background': 'Board background',
    'data.hiddenColumnIds': 'Hidden columns', 'data.columns.order': 'Column order',
    title: 'Title', content: 'Content', 'content.text': 'Body text', labels: 'Labels',
    targetDate: 'Due date', coverImage: 'Cover image', attachments: 'Attachments',
    recurrence: 'Recurrence', isArchived: 'Archived status', archivedAt: 'Archive date',
    columnId: 'Column', 'cards.order': 'Card order',
    completed: 'Completed', text: 'Text', frequency: 'Frequency', interval: 'Interval',
  };
  const cardMatch = /^data\.cards\[([^\]]+)\](?:\.card)?(?:\.(.*))?$/.exec(path);
  const columnMatch = /^data\.columns\[([^\]]+)\](?:\.(.*))?$/.exec(path);
  const humanize = (field: string) => names[field] ?? field
    .replace(/\[[^\]]+\]/g, ' item').replace(/\./g, ' · ').replace(/([a-z])([A-Z])/g, '$1 $2');
  if (cardMatch) {
    const card = board?.columns.flatMap((column) => column.cards).find((card) => card.id === cardMatch[1]);
    const checklist = /^content\.checklist\[([^\]]+)\](?:\.(.*))?$/.exec(cardMatch[2] ?? '');
    const attachment = /^attachments\[([^\]]+)\](?:\.(.*))?$/.exec(cardMatch[2] ?? '');
    let field = cardMatch[2] === 'description' ? 'Description' : humanize(cardMatch[2] ?? '');
    if (checklist) {
      const item = card?.content.checklist?.find((item) => item.id === checklist[1]);
      field = [item ? `Checklist: ${item.text}` : 'Checklist item', humanize(checklist[2] ?? '')].filter(Boolean).join(' · ');
    } else if (attachment) {
      const item = card?.attachments?.find((item) => item.id === attachment[1]);
      field = [item ? `Attachment: ${item.name}` : 'Attachment', humanize(attachment[2] ?? '')].filter(Boolean).join(' · ');
    }
    return [card ? `Card: ${card.title}` : 'Card', field].filter(Boolean).join(' · ');
  }
  if (columnMatch) {
    const column = board?.columns.find((column) => column.id === columnMatch[1]);
    return [column ? `Column: ${column.title}` : 'Column', humanize(columnMatch[2] ?? '')].filter(Boolean).join(' · ');
  }
  if (path === 'name' || path === 'description') return `Board ${path}`;
  return names[path] ?? humanize(path.replace(/^data\./, ''));
}

function ConflictNotice({ boardId, state }: BoardSyncNoticeProps & { state: BoardSyncState }) {
  const resolveBoardConflict = useBoardStore((store) => store.resolveBoardConflict);
  const board = useBoardStore((store) => store.boards.find((board) => board.id === boardId));
  const descriptionId = useId();

  return (
    <Dialog>
      <div role="alert" className={noticeClassName}>
        <AlertCircle className="size-4 shrink-0 text-[#78fcd6]" aria-hidden="true" />
        <p className="min-w-0 flex-1 break-words">
          {state.message || 'This board has incoming changes that need your review. Your edits are still here.'}
        </p>
        <DialogTrigger asChild>
          <Button type="button" size="sm" className={primaryButtonClassName}>Review changes</Button>
        </DialogTrigger>
      </div>
      <DialogContent
        aria-describedby={descriptionId}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-white/10 bg-[#111515] text-[#F2F7F7] sm:max-w-2xl"
      >
        <DialogHeader className="pr-6">
          <DialogTitle>Review board changes</DialogTitle>
          <DialogDescription id={descriptionId} className="text-sm text-[#A8B2B2]">
            Choose which edits to use for the conflicting fields below. Changes to other fields are kept.
          </DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          {state.conflicts?.map((conflict, index) => (
            <section key={`${conflict.path}-${index}`} className="min-w-0 rounded-lg border border-white/10 p-3">
              <h3 className="mb-3 text-sm font-medium [overflow-wrap:anywhere]">{conflictLabel(conflict.path, board)}</h3>
              <dl className="grid min-w-0 gap-3 sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="mb-1 text-sm text-[#78fcd6]">My edits</dt>
                  <dd className="max-h-48 overflow-auto rounded-md bg-white/5 p-3">
                    <pre className="whitespace-pre-wrap font-sans text-sm [overflow-wrap:anywhere]">{readableValue(conflict.local, conflict.path)}</pre>
                  </dd>
                </div>
                <div className="min-w-0">
                  <dt className="mb-1 text-sm text-[#A8B2B2]">Incoming edits</dt>
                  <dd className="max-h-48 overflow-auto rounded-md bg-white/5 p-3">
                    <pre className="whitespace-pre-wrap font-sans text-sm [overflow-wrap:anywhere]">{readableValue(conflict.remote, conflict.path)}</pre>
                  </dd>
                </div>
              </dl>
            </section>
          ))}
        </div>
        <DialogFooter className="flex-wrap">
          <DialogClose asChild>
            <Button type="button" variant="outline" className={secondaryButtonClassName}>Review later</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button
              type="button"
              variant="outline"
              className={secondaryButtonClassName}
              onClick={() => resolveBoardConflict(boardId, 'remote')}
            >
              Use incoming edits
            </Button>
          </DialogClose>
          <DialogClose asChild>
            <Button type="button" className={primaryButtonClassName} onClick={() => resolveBoardConflict(boardId, 'local')}>
              Keep my edits
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeletedDraftNotice({ boardId, message }: BoardSyncNoticeProps & { message?: string }) {
  const saveBoardDraftAsCopy = useBoardStore((store) => store.saveBoardDraftAsCopy);
  const discardBoardDraft = useBoardStore((store) => store.discardBoardDraft);

  return (
    <div role="alert" className={noticeClassName}>
      <AlertCircle className="size-4 shrink-0 text-[#78fcd6]" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="break-words">{message || 'This board was deleted elsewhere.'}</p>
        <p className="mt-1 text-[#A8B2B2]">Your unsaved draft is kept in this tab. Save a new board before leaving to keep it.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className={secondaryButtonClassName} onClick={() => discardBoardDraft(boardId)}>
          Discard local draft
        </Button>
        <Button type="button" size="sm" className={primaryButtonClassName} onClick={() => saveBoardDraftAsCopy(boardId)}>
          Save as a new board
        </Button>
      </div>
    </div>
  );
}

function SyncErrorNotice({ boardId, message }: BoardSyncNoticeProps & { message?: string }) {
  const retryBoardSync = useBoardStore((store) => store.retryBoardSync);

  return (
    <div role="alert" className={noticeClassName}>
      <AlertCircle className="size-4 shrink-0 text-[#78fcd6]" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">{message || 'Your changes could not be saved. Your edits are still in this tab.'}</p>
      <Button type="button" size="sm" className={primaryButtonClassName} onClick={() => retryBoardSync(boardId)}>Retry save</Button>
    </div>
  );
}

export function BoardSyncNotice({ boardId }: BoardSyncNoticeProps) {
  const state = useBoardStore((store) => store.boardSyncStates[boardId]);

  if (!state || state.status === 'saved') return null;
  if (state.status === 'conflict') return <ConflictNotice key={boardId} boardId={boardId} state={state} />;
  if (state.status === 'deleted') return <DeletedDraftNotice boardId={boardId} message={state.message} />;
  if (state.status === 'error') return <SyncErrorNotice boardId={boardId} message={state.message} />;

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={noticeClassName}>
      <CloudUpload className="size-4 shrink-0 text-[#78fcd6]" aria-hidden="true" />
      <p>{state.status === 'saving' ? 'Saving changes…' : 'Changes waiting to save…'}</p>
    </div>
  );
}

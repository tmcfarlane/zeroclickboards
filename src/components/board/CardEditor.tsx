import { useState, useEffect, useRef } from 'react';
import type { CardContent, CardLabel, ChecklistItem, Attachment, RecurrenceConfig } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Plus, X, ListTodo, Calendar, AlignLeft,
  Tag, Trash2, Paperclip, MoreHorizontal, Image as ImageIcon, Repeat,
} from 'lucide-react';
import { toast } from 'sonner';
import { LabelPicker } from './LabelPicker';
import { CardActivityFeed } from './CardActivityFeed';
import { getAllCardTemplates, deleteUserCardTemplate, type CardTemplate } from '@/lib/templates';
import { normalizeCalendarDate } from '@/lib/calendar-date';

export interface CardEditorSaveData {
  title: string;
  description?: string;
  content: CardContent;
  targetDate?: string;
  labels: CardLabel[];
  coverImage?: string;
  attachments?: Attachment[];
  recurrence?: RecurrenceConfig;
}

interface CardEditorProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: CardEditorSaveData, initialForm?: CardEditorSaveData) => void;
  onDelete?: () => void;
  mode: 'create' | 'edit';
  cardId?: string;
  initialData?: {
    title: string;
    description?: string;
    content: CardContent;
    targetDate?: string;
    labels?: CardLabel[];
    coverImage?: string;
    attachments?: Attachment[];
    recurrence?: RecurrenceConfig;
  };
}

const LABEL_COLORS: Record<CardLabel, string> = {
  red: 'bg-[#ef4444]',
  yellow: 'bg-[#eab308]',
  green: 'bg-[#22c55e]',
  blue: 'bg-[#3b82f6]',
  purple: 'bg-[#a855f7]',
  gray: 'bg-[#6b7280]',
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function genId() {
  return Math.random().toString(36).substring(2, 11);
}

function CardTemplatePicker({ onApply }: { onApply: (tpl: CardTemplate) => void }) {
  const [templates, setTemplates] = useState(() => getAllCardTemplates());
  if (templates.length === 0) return null;
  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">From template</span>
      <div className="flex flex-wrap gap-1.5">
        {templates.map((tpl) => (
          <div key={tpl.id} className="relative group/tpl">
            <button
              type="button"
              onClick={() => onApply(tpl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-white/10 bg-white/5 text-[#A8B2B2] hover:bg-white/10 hover:text-[#F2F7F7] transition-colors"
            >
              {tpl.name}
            </button>
            {tpl.category === 'user' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteUserCardTemplate(tpl.id);
                  setTemplates(getAllCardTemplates());
                  toast.success('Template deleted');
                }}
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-[#111515] border border-white/10 opacity-0 group-hover/tpl:opacity-100 hover:bg-red-500/20 text-red-400 transition-opacity"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CardEditor({ isOpen, onClose, onSave, onDelete, mode, cardId, initialData }: CardEditorProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [contentType, setContentType] = useState<CardContent['type']>('text');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [targetDate, setTargetDate] = useState('');
  const [targetDateTouched, setTargetDateTouched] = useState(false);
  const [targetDateBadInput, setTargetDateBadInput] = useState(false);
  const [targetDateError, setTargetDateError] = useState<string | undefined>(undefined);
  const [invalidOriginalDate, setInvalidOriginalDate] = useState<string | undefined>(undefined);
  const targetDateInputRef = useRef<HTMLInputElement>(null);
  const [labels, setLabels] = useState<CardLabel[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [newChecklistItem, setNewChecklistItem] = useState('');
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const attachmentFileRef = useRef<HTMLInputElement>(null);
  const pendingAttachmentEditRef = useRef<string | null>(null);
  const initialFormRef = useRef<CardEditorSaveData | undefined>(undefined);

  // Section visibility
  const [showDates, setShowDates] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showRecurrence, setShowRecurrence] = useState(false);
  const [recurrence, setRecurrence] = useState<RecurrenceConfig | null>(null);
  const [recurrenceIntervalInput, setRecurrenceIntervalInput] = useState('1');
  const [recurrenceMonthDayInput, setRecurrenceMonthDayInput] = useState('');
  const [recurrenceTouched, setRecurrenceTouched] = useState(false);
  const [recurrenceErrors, setRecurrenceErrors] = useState<{ interval?: string; dayOfMonth?: string }>({});

  useEffect(() => {
    if (isOpen) {
      if (initialData) {
        const initialDescription = initialData.description ?? '';
        const initialBodyText = initialData.content.text ?? '';
        const initialContentType = initialData.content.type === 'image' ? 'text' : initialData.content.type;
        const initialTargetDate = normalizeCalendarDate(initialData.targetDate ?? '');
        setTitle(initialData.title);
        setDescription(initialDescription);
        setBodyText(initialBodyText);
        setContentType(initialContentType);
        setChecklist(initialData.content.checklist || []);
        setTargetDate(initialTargetDate ?? '');
        setInvalidOriginalDate(initialData.targetDate && !initialTargetDate ? initialData.targetDate : undefined);
        setLabels(initialData.labels || []);

        // Build attachments — migrate legacy coverImage / content.imageUrl
        let existing: Attachment[] = initialData.attachments ? [...initialData.attachments] : [];

        if (initialData.coverImage && !existing.some(a => a.url === initialData.coverImage)) {
          existing.unshift({
            id: genId(),
            name: 'Cover image',
            url: initialData.coverImage,
            addedAt: new Date().toISOString(),
            isCover: true,
          });
        }

        if (initialData.content.type === 'image' && initialData.content.imageUrl &&
            !existing.some(a => a.url === initialData.content.imageUrl)) {
          existing.push({
            id: genId(),
            name: 'Image',
            url: initialData.content.imageUrl,
            addedAt: new Date().toISOString(),
            isCover: false,
          });
        }

        // The stored cover URL is authoritative. Old clients may leave stale
        // flags, or the same URL may appear on more than one attachment.
        let coverMatched = false;
        existing = existing.map((attachment) => {
          const isCover = !coverMatched && !!initialData.coverImage && attachment.url === initialData.coverImage;
          if (isCover) coverMatched = true;
          return { ...attachment, isCover };
        });

        setAttachments(existing);
        setShowDates(!!initialData.targetDate);
        setShowLabels(!!(initialData.labels && initialData.labels.length > 0));
        setRecurrence(initialData.recurrence || null);
        setRecurrenceIntervalInput(String(initialData.recurrence?.interval ?? 1));
        setRecurrenceMonthDayInput(initialData.recurrence?.dayOfMonth === undefined ? '' : String(initialData.recurrence.dayOfMonth));
        setShowRecurrence(!!initialData.recurrence);
        // Compare submitted values with what this form displayed, including
        // legacy image migration and distinct description/body fields. The
        // store can then apply only fields the user actually changed.
        initialFormRef.current = structuredClone({
          title: initialData.title.trim(),
          description: initialDescription.trim() || undefined,
          content: initialContentType === 'checklist'
            ? { type: 'checklist', checklist: initialData.content.checklist || [] }
            : { type: 'text', text: initialBodyText },
          targetDate: initialTargetDate ?? (initialData.targetDate || undefined),
          labels: initialData.labels || [],
          coverImage: existing.find((attachment) => attachment.isCover)?.url,
          attachments: existing.length > 0 ? existing : undefined,
          recurrence: initialData.recurrence || undefined,
        });
      } else {
        initialFormRef.current = undefined;
        setTitle('');
        setDescription('');
        setBodyText('');
        setContentType('text');
        setChecklist([]);
        setTargetDate('');
        setInvalidOriginalDate(undefined);
        setLabels([]);
        setAttachments([]);
        setShowDates(false);
        setShowLabels(false);
        setRecurrence(null);
        setRecurrenceIntervalInput('1');
        setRecurrenceMonthDayInput('');
        setShowRecurrence(false);
      }
      setNewChecklistItem('');
      setEditingAttachmentId(null);
      pendingAttachmentEditRef.current = null;
      setAddMenuOpen(false);
      setRecurrenceTouched(false);
      setRecurrenceErrors({});
      setTargetDateTouched(false);
      setTargetDateBadInput(false);
      setTargetDateError(undefined);
    }
  }, [isOpen, initialData]);

  const handleSave = () => {
    if (!title.trim()) return;

    // Native date inputs expose incomplete dates as an empty value. Check
    // badInput before treating that empty value as an intentional removal.
    const invalidDateInput = targetDateBadInput || targetDateInputRef.current?.validity.badInput;
    let submittedTargetDate = targetDateTouched ? undefined : initialFormRef.current?.targetDate;
    if (targetDateTouched && targetDate) submittedTargetDate = normalizeCalendarDate(targetDate);
    if (invalidDateInput || (targetDateTouched && !!targetDate && !submittedTargetDate)) {
      setTargetDateBadInput(!!invalidDateInput);
      setTargetDateError('Enter a complete, valid date or remove the due date.');
      return;
    }
    setTargetDateError(undefined);

    let submittedRecurrence = recurrence || undefined;
    if (recurrence && recurrenceTouched) {
      const interval = Number(recurrenceIntervalInput);
      const dayOfMonth = recurrenceMonthDayInput.trim() ? Number(recurrenceMonthDayInput) : undefined;
      const errors: typeof recurrenceErrors = {};
      if (!Number.isInteger(interval) || interval < 1 || interval > 99) {
        errors.interval = 'Enter a whole number from 1 to 99.';
      }
      if (recurrence.frequency === 'monthly' && dayOfMonth !== undefined &&
        (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)) {
        errors.dayOfMonth = 'Enter a whole number from 1 to 31, or leave this blank.';
      }
      setRecurrenceErrors(errors);
      if (Object.keys(errors).length) return;

      submittedRecurrence = { ...recurrence, interval };
      delete submittedRecurrence.daysOfWeek;
      delete submittedRecurrence.dayOfMonth;
      if (recurrence.frequency === 'weekly') {
        const days = [...new Set((recurrence.daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
        if (days.length) submittedRecurrence.daysOfWeek = days;
      }
      if (recurrence.frequency === 'monthly' && dayOfMonth !== undefined) submittedRecurrence.dayOfMonth = dayOfMonth;
    }

    let content: CardContent;
    if (contentType === 'checklist') {
      content = { type: 'checklist', checklist };
    } else {
      content = { type: 'text', text: bodyText };
    }

    const coverAttachment = attachments.find(a => a.isCover);

    onSave({
      title: title.trim(),
      description: description.trim() || undefined,
      content,
      targetDate: submittedTargetDate,
      labels,
      coverImage: coverAttachment?.url,
      attachments: attachments.length > 0 ? attachments : undefined,
      recurrence: submittedRecurrence,
    }, initialFormRef.current);
  };

  const changeRecurrenceFrequency = (frequency: RecurrenceConfig['frequency']) => {
    const next = { ...recurrence, frequency, interval: recurrence?.interval ?? 1 };
    if (!recurrence) setRecurrenceIntervalInput('1');
    if (frequency !== 'weekly' || recurrence?.frequency !== 'weekly') delete next.daysOfWeek;
    if (frequency !== 'monthly' || recurrence?.frequency !== 'monthly') {
      delete next.dayOfMonth;
      setRecurrenceMonthDayInput('');
    }
    setRecurrence(next);
    setRecurrenceTouched(true);
    setRecurrenceErrors({});
  };

  // Checklist helpers
  const addChecklistItem = () => {
    if (newChecklistItem.trim()) {
      setChecklist([
        ...checklist,
        { id: genId(), text: newChecklistItem.trim(), completed: false },
      ]);
      setNewChecklistItem('');
    }
  };

  const toggleChecklistItem = (id: string) => {
    setChecklist(checklist.map(item =>
      item.id === id ? { ...item, completed: !item.completed } : item
    ));
  };

  const removeChecklistItem = (id: string) => {
    setChecklist(checklist.filter(item => item.id !== id));
  };

  // Attachment helpers
  const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const validateImageFile = (file: File): string | null => {
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return 'Only JPEG, PNG, WebP, and GIF images are allowed';
    if (file.size > MAX_IMAGE_SIZE) return 'Image must be smaller than 2MB';
    return null;
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const err = validateImageFile(file);
    if (err) { toast.error(err); return; }
    const reader = new FileReader();
    reader.onloadend = () => {
      const newAttachment: Attachment = {
        id: genId(),
        name: file.name,
        url: reader.result as string,
        addedAt: new Date().toISOString(),
      };
      setAttachments(prev => [...prev, { ...newAttachment, isCover: prev.length === 0 }]);
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id));
  };

  const toggleCover = (id: string) => {
    setAttachments(prev => prev.map(a => ({
      ...a,
      isCover: a.id === id ? !a.isCover : false,
    })));
  };

  const renameAttachment = (id: string, newName: string) => {
    if (newName.trim()) {
      setAttachments(prev => prev.map(a => a.id === id ? { ...a, name: newName.trim() } : a));
    }
    setEditingAttachmentId(null);
  };

  const pillClass = (active: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
      active
        ? 'border-[#78fcd6]/40 bg-[#78fcd6]/10 text-[#78fcd6]'
        : 'border-white/10 bg-white/5 text-[#A8B2B2] hover:bg-white/10 hover:text-[#F2F7F7]'
    }`;

  const coverAttachment = attachments.find(a => a.isCover);

  const renderDetailsContent = () => (
    <>
      {/* Quick Action Pills */}
          <div className="flex flex-wrap gap-2">
            {/* + Add dropdown */}
            <Popover open={addMenuOpen} onOpenChange={setAddMenuOpen}>
              <PopoverTrigger asChild>
                <button type="button" className={pillClass(false)}>
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="w-56 bg-[#111515] border-white/10 p-0"
                align="start"
                sideOffset={4}
              >
                <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-medium text-[#A8B2B2]">Add to card</span>
                  <button
                    type="button"
                    onClick={() => setAddMenuOpen(false)}
                    className="p-0.5 rounded hover:bg-white/10 text-[#A8B2B2]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="py-1">
                  <LabelPicker
                    selectedLabels={labels}
                    onChange={(newLabels) => {
                      setLabels(newLabels);
                      if (newLabels.length > 0) setShowLabels(true);
                    }}
                    trigger={
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                      >
                        <Tag className="w-4 h-4 text-[#A8B2B2] flex-shrink-0" />
                        <div>
                          <p className="text-sm text-[#F2F7F7]">Labels</p>
                          <p className="text-xs text-[#A8B2B2]">Organize and categorize</p>
                        </div>
                      </button>
                    }
                  />
                  <button
                    type="button"
                    onClick={() => { setShowDates(true); setAddMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                  >
                    <Calendar className="w-4 h-4 text-[#A8B2B2] flex-shrink-0" />
                    <div>
                      <p className="text-sm text-[#F2F7F7]">Dates</p>
                      <p className="text-xs text-[#A8B2B2]">Due dates and reminders</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setContentType('checklist'); setAddMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                  >
                    <ListTodo className="w-4 h-4 text-[#A8B2B2] flex-shrink-0" />
                    <div>
                      <p className="text-sm text-[#F2F7F7]">Checklist</p>
                      <p className="text-xs text-[#A8B2B2]">Add subtasks</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => { attachmentFileRef.current?.click(); setAddMenuOpen(false); }}
                    className="w-full flex items-center gap-3 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                  >
                    <Paperclip className="w-4 h-4 text-[#A8B2B2] flex-shrink-0" />
                    <div>
                      <p className="text-sm text-[#F2F7F7]">Attachment</p>
                      <p className="text-xs text-[#A8B2B2]">Add images and files</p>
                    </div>
                  </button>
                </div>
              </PopoverContent>
            </Popover>

            {/* Direct pill shortcuts */}
            <button
              type="button"
              onClick={() => setShowDates(!showDates)}
              className={pillClass(showDates || !!targetDate)}
            >
              <Calendar className="w-3.5 h-3.5" />
              Dates
            </button>
            <button
              type="button"
              onClick={() => setContentType(contentType === 'checklist' ? 'text' : 'checklist')}
              className={pillClass(contentType === 'checklist')}
            >
              <ListTodo className="w-3.5 h-3.5" />
              Checklist
            </button>
            <button
              type="button"
              onClick={() => {
                if (recurrence) {
                  setRecurrence(null);
                  setShowRecurrence(false);
                  setRecurrenceTouched(true);
                  setRecurrenceErrors({});
                } else {
                  setShowRecurrence(!showRecurrence);
                }
              }}
              className={pillClass(!!recurrence)}
            >
              <Repeat className="w-3.5 h-3.5" />
              Repeat
            </button>
          </div>

          {/* Hidden file input for attachments */}
          <input
            type="file"
            aria-label="Add image attachment"
            ref={attachmentFileRef}
            accept="image/*"
            onChange={handleAttachmentUpload}
            className="hidden"
          />

          {/* Dates Section */}
          {(showDates || !!targetDate || (!targetDateTouched && !!invalidOriginalDate) || targetDateBadInput) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label htmlFor="target-date" className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Due date</label>
                {(targetDate || (!targetDateTouched && invalidOriginalDate) || targetDateBadInput) && (
                  <button
                    type="button"
                    aria-label="Remove due date"
                    onClick={() => {
                      setTargetDate('');
                      setTargetDateTouched(true);
                      setTargetDateBadInput(false);
                      setTargetDateError(undefined);
                      setShowDates(false);
                    }}
                    className="text-xs text-[#A8B2B2] hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>
              <Input
                id="target-date"
                ref={targetDateInputRef}
                type="date"
                aria-invalid={!!targetDateError}
                aria-describedby={[
                  !targetDateTouched && invalidOriginalDate ? 'target-date-repair' : undefined,
                  targetDateError ? 'target-date-error' : undefined,
                ].filter(Boolean).join(' ') || undefined}
                value={targetDate}
                onChange={(e) => {
                  setTargetDate(e.currentTarget.value);
                  setTargetDateTouched(true);
                  setTargetDateBadInput(e.currentTarget.validity.badInput);
                  setTargetDateError(undefined);
                }}
                className="bg-white/5 border-white/10 text-[#F2F7F7] h-9"
              />
              {!targetDateTouched && invalidOriginalDate && (
                <p id="target-date-repair" role="status" className="text-xs text-amber-300 [overflow-wrap:anywhere]">
                  The saved due date “{invalidOriginalDate}” is invalid. Choose a valid date or remove it. It will stay unchanged until you do.
                </p>
              )}
              {targetDateError && <p id="target-date-error" role="alert" className="text-xs text-red-400">{targetDateError}</p>}
            </div>
          )}

          {/* Recurrence Section */}
          {(showRecurrence || !!recurrence) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Recurrence</span>
                {recurrence && (
                  <button
                    type="button"
                    aria-label="Remove recurrence"
                    onClick={() => { setRecurrence(null); setShowRecurrence(false); setRecurrenceTouched(true); setRecurrenceErrors({}); }}
                    className="text-xs text-[#A8B2B2] hover:text-red-400 transition-colors"
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Frequency selector */}
              <div className="flex gap-1.5">
                {(['daily', 'weekly', 'monthly'] as const).map((freq) => (
                  <button
                    key={freq}
                    type="button"
                    onClick={() => changeRecurrenceFrequency(freq)}
                    aria-pressed={recurrence?.frequency === freq}
                    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors capitalize ${
                      recurrence?.frequency === freq
                        ? 'border-[#78fcd6]/40 bg-[#78fcd6]/10 text-[#78fcd6]'
                        : 'border-white/10 bg-white/5 text-[#A8B2B2] hover:bg-white/10'
                    }`}
                  >
                    {freq}
                  </button>
                ))}
              </div>

              {/* Interval */}
              {recurrence && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#A8B2B2]">Every</span>
                  <Input
                    type="number"
                    aria-label="Repeat every"
                    aria-invalid={!!recurrenceErrors.interval}
                    aria-describedby={recurrenceErrors.interval ? 'recurrence-interval-error' : undefined}
                    min={1}
                    max={99}
                    step={1}
                    value={recurrenceIntervalInput}
                    onChange={(e) => {
                      setRecurrenceIntervalInput(e.target.value);
                      setRecurrenceTouched(true);
                      setRecurrenceErrors((errors) => ({ ...errors, interval: undefined }));
                    }}
                    className="w-16 h-8 bg-white/5 border-white/10 text-[#F2F7F7] text-center text-xs"
                  />
                  <span className="text-xs text-[#A8B2B2]">
                    {recurrence.frequency === 'daily' ? 'day(s)' : recurrence.frequency === 'weekly' ? 'week(s)' : 'month(s)'}
                  </span>
                </div>
              )}
              {recurrenceErrors.interval && <p id="recurrence-interval-error" role="alert" className="text-xs text-red-400">{recurrenceErrors.interval}</p>}

              {/* Weekly: day of week picker */}
              {recurrence?.frequency === 'weekly' && (
                <div className="flex gap-1">
                  {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, idx) => {
                    const selected = recurrence.daysOfWeek?.includes(idx) ?? false;
                    return (
                      <button
                        key={idx}
                        type="button"
                        aria-label={day}
                        aria-pressed={selected}
                        onClick={() => {
                          const current = recurrence.daysOfWeek || [];
                          const next = selected ? current.filter((d) => d !== idx) : [...current, idx];
                          setRecurrence({ ...recurrence, daysOfWeek: next.length > 0 ? next : undefined });
                          setRecurrenceTouched(true);
                        }}
                        className={`w-8 h-8 rounded-md text-xs font-medium transition-colors ${
                          selected
                            ? 'bg-[#78fcd6]/20 text-[#78fcd6] border border-[#78fcd6]/40'
                            : 'bg-white/5 text-[#A8B2B2] border border-white/10 hover:bg-white/10'
                        }`}
                      >
                        {day[0]}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Monthly: day of month */}
              {recurrence?.frequency === 'monthly' && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#A8B2B2]">On day</span>
                  <Input
                    type="number"
                    aria-label="Day of month"
                    aria-invalid={!!recurrenceErrors.dayOfMonth}
                    aria-describedby={recurrenceErrors.dayOfMonth ? 'recurrence-month-day-error recurrence-month-day-hint' : 'recurrence-month-day-hint'}
                    min={1}
                    max={31}
                    step={1}
                    value={recurrenceMonthDayInput}
                    onChange={(e) => {
                      setRecurrenceMonthDayInput(e.target.value);
                      setRecurrenceTouched(true);
                      setRecurrenceErrors((errors) => ({ ...errors, dayOfMonth: undefined }));
                    }}
                    className="w-16 h-8 bg-white/5 border-white/10 text-[#F2F7F7] text-center text-xs"
                  />
                </div>
              )}
              {recurrence?.frequency === 'monthly' && <p id="recurrence-month-day-hint" className="text-xs text-[#A8B2B2]">Leave blank to use the due date’s day, or today’s day if no date is set.</p>}
              {recurrenceErrors.dayOfMonth && <p id="recurrence-month-day-error" role="alert" className="text-xs text-red-400">{recurrenceErrors.dayOfMonth}</p>}
            </div>
          )}

          {/* Labels Section */}
          {(showLabels || labels.length > 0) && (
            <div className="space-y-2">
              <span className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Labels</span>
              <div className="flex flex-wrap gap-1.5">
                {labels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setLabels(labels.filter((l) => l !== label))}
                    className={`${LABEL_COLORS[label]} h-7 px-3 rounded text-xs font-medium text-white capitalize hover:opacity-80 transition-opacity`}
                  >
                    {label}
                  </button>
                ))}
                <LabelPicker
                  selectedLabels={labels}
                  onChange={setLabels}
                  trigger={
                    <button
                      type="button"
                      className="h-7 w-7 rounded bg-white/10 hover:bg-white/15 flex items-center justify-center text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  }
                />
              </div>
            </div>
          )}

          {/* Description */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <AlignLeft className="w-4 h-4 text-[#A8B2B2]" />
              <label htmlFor="card-description" className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Description</label>
            </div>
            <Textarea
              id="card-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a more detailed description..."
              maxLength={5000}
              className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/40 min-h-[100px] resize-y"
              rows={4}
            />
          </div>

          {contentType === 'text' && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <AlignLeft className="w-4 h-4 text-[#A8B2B2]" />
                <label htmlFor="card-body-text" className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Body text</label>
              </div>
              <Textarea
                id="card-body-text"
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Add body text..."
                className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/40 min-h-[100px] resize-y"
                rows={4}
              />
            </div>
          )}

          {/* Checklist Section */}
          {contentType === 'checklist' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ListTodo className="w-4 h-4 text-[#A8B2B2]" />
                <span className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Checklist</span>
              </div>

              <div className="space-y-1.5 max-h-[200px] overflow-y-auto scrollbar-thin">
                {checklist.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-2 p-2 rounded-lg hover:bg-white/5 group transition-colors"
                  >
                    <Checkbox
                      checked={item.completed}
                      onCheckedChange={() => toggleChecklistItem(item.id)}
                      className="border-white/20 data-[state=checked]:bg-[#78fcd6] data-[state=checked]:border-[#78fcd6]"
                    />
                    <span
                      className={`flex-1 text-sm ${
                        item.completed ? 'text-[#A8B2B2] line-through' : 'text-[#F2F7F7]'
                      }`}
                    >
                      {item.text}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeChecklistItem(item.id)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded text-[#A8B2B2] hover:text-red-400 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Input
                  value={newChecklistItem}
                  onChange={(e) => setNewChecklistItem(e.target.value)}
                  placeholder="Add an item..."
                  className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/40 flex-1 h-9"
                  onKeyDown={(e) => e.key === 'Enter' && addChecklistItem()}
                />
                <Button
                  type="button"
                  onClick={addChecklistItem}
                  variant="outline"
                  className="border-white/10 text-[#F2F7F7] hover:bg-white/5 h-9 px-3"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Attachments Section */}
          {attachments.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-[#A8B2B2]" />
                  <span className="text-xs font-medium text-[#A8B2B2] uppercase tracking-wider">Attachments</span>
                </div>
                <button
                  type="button"
                  onClick={() => attachmentFileRef.current?.click()}
                  className="text-xs text-[#A8B2B2] hover:text-[#F2F7F7] border border-white/10 rounded px-2 py-1 hover:bg-white/5 transition-colors"
                >
                  Add
                </button>
              </div>

              <span className="text-[10px] font-medium text-[#A8B2B2]/60 uppercase tracking-wider">Files</span>

              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.03] hover:bg-white/5 group transition-colors"
                  >
                    {/* Thumbnail */}
                    <img
                      src={attachment.url}
                      alt=""
                      className="w-14 h-10 object-cover rounded flex-shrink-0 bg-white/5"
                    />

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      {editingAttachmentId === attachment.id ? (
                        <Input
                          autoFocus
                          aria-label="Attachment name"
                          defaultValue={attachment.name}
                          onBlur={(e) => renameAttachment(attachment.id, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') renameAttachment(attachment.id, e.currentTarget.value);
                            if (e.key === 'Escape') setEditingAttachmentId(null);
                          }}
                          className="h-6 text-xs bg-white/5 border-white/10 text-[#F2F7F7] px-1.5"
                        />
                      ) : (
                        <p className="text-sm text-[#F2F7F7] truncate">{attachment.name}</p>
                      )}
                      <div className="flex items-center gap-1.5 text-[10px] text-[#A8B2B2]">
                        <span>Added {formatTimeAgo(attachment.addedAt)}</span>
                        {attachment.isCover && (
                          <>
                            <span>&middot;</span>
                            <span className="inline-flex items-center gap-0.5">
                              <ImageIcon className="w-2.5 h-2.5" /> Cover
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`Actions for ${attachment.name}`}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-white/10 text-[#A8B2B2] transition-opacity flex-shrink-0"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        className="bg-[#111515] border-white/10"
                        align="end"
                        onCloseAutoFocus={(event) => {
                          const editId = pendingAttachmentEditRef.current;
                          if (!editId) return;
                          event.preventDefault();
                          pendingAttachmentEditRef.current = null;
                          setEditingAttachmentId(editId);
                        }}
                      >
                        <DropdownMenuItem
                          onSelect={() => { pendingAttachmentEditRef.current = attachment.id; }}
                          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
                        >
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => toggleCover(attachment.id)}
                          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
                        >
                          {attachment.isCover ? 'Remove cover' : 'Make cover'}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => removeAttachment(attachment.id)}
                          className="text-red-400 focus:bg-red-400/10 focus:text-red-400"
                        >
                          Remove
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            </div>
          )}

    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] w-[95vw] sm:max-w-lg max-h-[90vh] overflow-hidden p-0 gap-0" aria-describedby={undefined}>
        <DialogTitle className="sr-only">{mode === 'create' ? 'Create Card' : 'Edit Card'}</DialogTitle>
        {/* Cover Image from first attachment */}
        {coverAttachment && (
          <div className="relative">
            <img
              src={coverAttachment.url}
              alt="Card cover"
              className="w-full h-32 object-cover"
            />
            <button
              type="button"
              aria-label="Remove card cover"
              onClick={() => toggleCover(coverAttachment.id)}
              className="absolute top-2 right-2 p-1.5 bg-black/50 hover:bg-black/70 rounded-lg text-white transition-colors text-xs"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="overflow-y-auto max-h-[calc(90vh-60px)] px-5 pt-5 pb-4 flex flex-col min-h-0">
          {/* Title - always visible */}
          <Input
            id="card-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Card title..."
            maxLength={200}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
              if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
            className="text-lg font-semibold bg-transparent border-0 border-b border-white/10 rounded-none px-0 h-auto py-2 text-[#F2F7F7] placeholder:text-[#A8B2B2]/40 focus-visible:ring-0 focus-visible:border-[#78fcd6]/50 flex-shrink-0"
          />

          {mode === 'edit' && cardId ? (
            <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0 mt-4">
              <TabsList className="bg-white/5 border border-white/10 flex-shrink-0 h-9">
                <TabsTrigger
                  value="details"
                  className="text-xs data-[state=active]:bg-[#78fcd6]/10 data-[state=active]:text-[#78fcd6]"
                >
                  Details
                </TabsTrigger>
                <TabsTrigger
                  value="activity"
                  className="text-xs data-[state=active]:bg-[#78fcd6]/10 data-[state=active]:text-[#78fcd6]"
                >
                  Activity
                </TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="flex-1 mt-4 space-y-5 overflow-y-auto">
                {renderDetailsContent()}
              </TabsContent>
              <TabsContent value="activity" className="flex-1 mt-4 overflow-hidden">
                <CardActivityFeed cardId={cardId} />
              </TabsContent>
            </Tabs>
          ) : (
            <div className="space-y-5 mt-4">
              {/* Card Template Picker (create mode only) */}
              <CardTemplatePicker onApply={(tpl) => {
                setTitle(tpl.card.title);
                setDescription(tpl.card.description ?? '');
                setBodyText(tpl.card.content.text ?? '');
                setContentType(tpl.card.content.type === 'image' ? 'text' : tpl.card.content.type);
                setChecklist(tpl.card.content.checklist ? tpl.card.content.checklist.map(item => ({ ...item, id: genId(), completed: false })) : []);
                setLabels(tpl.card.labels || []);
                if (tpl.card.labels && tpl.card.labels.length > 0) setShowLabels(true);
              }} />
              {renderDetailsContent()}
            </div>
          )}

          {/* Footer Actions - always visible */}
          <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-4 flex-shrink-0">
            {mode === 'edit' && onDelete ? (
              <button
                type="button"
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 text-xs text-red-400/60 hover:text-red-400 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            ) : <div />}
            <div className="flex gap-2 ml-auto">
              <Button
                variant="outline"
                onClick={onClose}
                className="border-white/10 text-[#F2F7F7] hover:bg-white/5 h-8 text-xs px-3"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!title.trim()}
                className="gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50 h-8 text-xs px-4"
              >
                {mode === 'create' ? 'Add Card' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

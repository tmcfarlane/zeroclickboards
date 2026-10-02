import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getAllBoardTemplates,
  templateToColumns,
  type BoardTemplate as UITemplate,
} from '@/lib/templates';
import {
  readFileAsJSON,
  validateBoardJSON,
  importBoardFromJSON,
} from '@/lib/board-io';
import { useBoardStore } from '@/store/useBoardStore';
import { useAuthContext } from '@/components/auth/AuthProvider';
import { useAIUsage } from '@/hooks/useAIUsage';
import { ChevronDown, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import type { Card, CardContent, CardLabel, Column } from '@/types';
import { isComposingKey } from '@/lib/keyboard';

interface CreateBoardDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSignIn: () => void;
  onUpgrade: () => void;
}

interface AITemplateCard {
  title: string;
  description?: string;
  content: {
    type: 'text' | 'checklist';
    text?: string;
    checklist?: Array<{ text: string }>;
  };
  labels?: CardLabel[];
}

interface AITemplateColumn {
  title: string;
  sampleCards: AITemplateCard[];
}

interface AITemplate {
  name: string;
  description?: string;
  columns: AITemplateColumn[];
}

interface BoardTemplateResponse {
  template: AITemplate;
  usage: { used: number; limit: number | null; warning: boolean; charged: boolean };
}

interface BoardCreationAttempt {
  controller: AbortController;
  userId: string | null;
  kind: 'generation' | 'import';
}

function aiCardToCard(tmpl: AITemplateCard): Card {
  const now = new Date().toISOString();
  const content: CardContent = {
    type: tmpl.content.type,
    text: tmpl.content.text ?? '',
    ...(tmpl.content.checklist || tmpl.content.type === 'checklist' ? {
      checklist: (tmpl.content.checklist ?? []).map((item) => ({
        id: uuidv4(),
        text: item.text,
        completed: false,
      })),
    } : {}),
  };

  return {
    id: uuidv4(),
    title: tmpl.title,
    description: tmpl.description,
    content,
    labels: [...(tmpl.labels ?? [])],
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function CreateBoardDialog({
  isOpen,
  onOpenChange,
  onOpenSignIn,
  onUpgrade,
}: CreateBoardDialogProps) {
  const { session, isSignedIn } = useAuthContext();
  const { createBoard, setActiveBoard } = useBoardStore();
  const { used, limit, isLimitReached, isPaid, resetsAt, updateUsage } = useAIUsage();

  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDescription, setNewBoardDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<UITemplate | null>(null);
  const [templates] = useState<UITemplate[]>(() => getAllBoardTemplates());
  const importFileRef = useRef<HTMLInputElement>(null);
  const pendingAttemptRef = useRef<BoardCreationAttempt | null>(null);
  const userId = session?.user.id ?? null;

  const invalidatePendingAttempt = useCallback(() => {
    pendingAttemptRef.current?.controller.abort();
    pendingAttemptRef.current = null;
  }, []);

  useEffect(() => invalidatePendingAttempt, [invalidatePendingAttempt]);
  useEffect(() => {
    invalidatePendingAttempt();
    setIsGenerating(false);
    setPrompt('');
    setNewBoardName('');
    setNewBoardDescription('');
    setSelectedTemplate(null);
  }, [userId, invalidatePendingAttempt]);
  useEffect(() => {
    if (!isOpen && pendingAttemptRef.current) {
      invalidatePendingAttempt();
      setIsGenerating(false);
    }
  }, [isOpen, invalidatePendingAttempt]);

  function isCurrentAttempt(attempt: BoardCreationAttempt): boolean {
    return pendingAttemptRef.current === attempt
      && !attempt.controller.signal.aborted
      && useBoardStore.getState().currentUserId === attempt.userId;
  }

  function beginAttempt(kind: BoardCreationAttempt['kind']): BoardCreationAttempt {
    invalidatePendingAttempt();
    setIsGenerating(false);
    const attempt: BoardCreationAttempt = { controller: new AbortController(), userId, kind };
    pendingAttemptRef.current = attempt;
    return attempt;
  }

  function handleOpenChange(open: boolean): void {
    if (!open) invalidatePendingAttempt();
    onOpenChange(open);
  }

  const overQuota = !isPaid && isLimitReached;

  useEffect(() => {
    if (isOpen) {
      setShowAdvanced(overQuota);
    } else {
      setPrompt('');
      setNewBoardName('');
      setNewBoardDescription('');
      setSelectedTemplate(null);
      setIsGenerating(false);
    }
  }, [isOpen, overQuota]);

  const resetsAtFormatted = resetsAt
    ? new Date(resetsAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null;

  async function handleGenerate(): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed || isGenerating || pendingAttemptRef.current?.kind === 'generation') return;

    if (!isSignedIn || !session?.access_token || !userId) {
      handleOpenChange(false);
      onOpenSignIn();
      return;
    }

    if (overQuota) {
      toast.error('Daily AI limit reached — use Advanced options or upgrade.');
      setShowAdvanced(true);
      return;
    }

    const attempt = beginAttempt('generation');
    setIsGenerating(true);
    try {
      const res = await fetch('/api/ai/board-template', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ prompt: trimmed }),
        signal: AbortSignal.any([attempt.controller.signal, AbortSignal.timeout(35_000)]),
      });
      if (!isCurrentAttempt(attempt)) return;

      if (res.status === 401) {
        handleOpenChange(false);
        onOpenSignIn();
        return;
      }
      if (res.status === 429) {
        const json = (await res.json().catch(() => null)) as
          | { usage?: { used: number; limit: number } }
          | null;
        if (!isCurrentAttempt(attempt)) return;
        if (json?.usage) {
          updateUsage({ used: json.usage.used, limit: json.usage.limit });
        }
        toast.error("You've used all daily AI generations — use Advanced options or upgrade.");
        setShowAdvanced(true);
        return;
      }
      if (res.status === 504) {
        toast.error('AI timed out. Try again or use Advanced options.');
        return;
      }
      if (!res.ok) {
        toast.error('Could not generate board. Try a simpler prompt.');
        return;
      }

      const data = (await res.json()) as BoardTemplateResponse;
      if (!isCurrentAttempt(attempt)) return;
      // Persist the complete accepted template in the initial creation snapshot.
      // Navigation must never decide how much generated content is saved.
      const columns: Column[] = data.template.columns.map((column, order) => ({
        id: uuidv4(), title: column.title, order, cards: column.sampleCards.map(aiCardToCard),
      }));
      if (!isCurrentAttempt(attempt)) return;
      updateUsage({ used: data.usage.used, limit: data.usage.limit, warning: data.usage.warning });
      const boardId = createBoard(data.template.name, data.template.description, columns);
      setActiveBoard(boardId);
      handleOpenChange(false);
      toast.success('Board generated — edit anything you like');
    } catch (err) {
      if (!isCurrentAttempt(attempt)) return;
      if (err instanceof DOMException && err.name === 'TimeoutError') {
        toast.error('AI timed out. Try again or use Advanced options.');
      } else {
        console.error('[CreateBoardDialog] generate failed:', err);
        toast.error('Something went wrong. Try again.');
      }
    } finally {
      if (pendingAttemptRef.current === attempt) {
        pendingAttemptRef.current = null;
        setIsGenerating(false);
      }
    }
  }

  function handleManualCreate(): void {
    if (!newBoardName.trim()) return;
    invalidatePendingAttempt();
    createBoard(
      newBoardName.trim(),
      newBoardDescription.trim() || undefined,
      selectedTemplate ? templateToColumns(selectedTemplate) : undefined
    );
    handleOpenChange(false);
  }

  async function handleFileImport(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    const attempt = beginAttempt('import');
    try {
      const data = await readFileAsJSON(file);
      if (!isCurrentAttempt(attempt)) return;
      const result = validateBoardJSON(data);
      if (!result.valid) {
        toast.error(result.error);
        return;
      }
      const { name, description, columns } = importBoardFromJSON(result.payload);
      createBoard(name, description, columns);
      if (importFileRef.current) importFileRef.current.value = '';
      toast.success('Board imported successfully');
      handleOpenChange(false);
    } catch (err) {
      if (!isCurrentAttempt(attempt)) return;
      toast.error(err instanceof Error ? err.message : 'Failed to import board');
    } finally {
      if (pendingAttemptRef.current === attempt) {
        pendingAttemptRef.current = null;
        if (importFileRef.current) importFileRef.current.value = '';
      }
    }
  }

  const showUsageChip = isSignedIn && !isPaid && typeof limit === 'number';

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7] sm:max-w-[520px]" onEscapeKeyDown={(event) => { if (isComposingKey(event)) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Create New Board</DialogTitle>
          <DialogDescription className="text-[#A8B2B2]">
            Describe your project and let AI build it, or expand advanced options.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Over-quota banner */}
          {isSignedIn && overQuota && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-amber-100">
                  You&apos;ve used all {limit ?? 5} daily AI generations.
                  {resetsAtFormatted ? ` Resets at ${resetsAtFormatted}.` : ''}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    handleOpenChange(false);
                    onUpgrade();
                  }}
                  className="mt-1 text-xs font-medium text-amber-300 hover:text-amber-200 underline underline-offset-2"
                >
                  Upgrade to Pro for unlimited →
                </button>
              </div>
            </div>
          )}

          {/* AI hero input */}
          {isSignedIn && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ai-prompt" className="text-sm font-medium text-[#F2F7F7]">
                  What do you want to build?
                </Label>
                {showUsageChip && (
                  <span className="text-[11px] text-[#A8B2B2] tabular-nums">
                    {used}/{limit} today
                  </span>
                )}
              </div>
              <Input
                id="ai-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Plan a product launch"
                maxLength={200}
                autoFocus
                disabled={isGenerating || overQuota}
                className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                onKeyDown={(e) => {
                  if (isComposingKey(e.nativeEvent)) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleGenerate();
                  }
                }}
                aria-describedby="ai-prompt-hint"
              />
              <Button
                type="button"
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim() || isGenerating || overQuota}
                className="ai-generate-btn w-full text-[#0B0F0F] disabled:opacity-60 h-11 font-semibold rounded-lg border-0"
              >
                <span className="relative z-10 inline-flex items-center">
                  {isGenerating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="ai-sparkle w-4 h-4 mr-2" />
                      Generate with AI
                    </>
                  )}
                </span>
              </Button>
            </div>
          )}

          {/* Advanced options toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-2 text-sm text-[#A8B2B2] hover:text-[#F2F7F7] transition-colors"
            aria-expanded={showAdvanced}
            aria-controls="advanced-options"
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
            Advanced options
          </button>

          {showAdvanced && (
            <div id="advanced-options" className="space-y-3 border-t border-white/5 pt-3">
              <input
                ref={importFileRef}
                type="file"
                accept=".json,application/json"
                onChange={handleFileImport}
                className="hidden"
              />
              <div className="grid grid-cols-[90px_1fr] items-center gap-x-3 gap-y-2">
                <Label htmlFor="template" className="text-sm text-[#A8B2B2]">Template</Label>
                <Select
                  value={selectedTemplate?.id ?? 'blank'}
                  onValueChange={(value) => {
                    if (value === 'blank') setSelectedTemplate(null);
                    else setSelectedTemplate(templates.find((t) => t.id === value) ?? null);
                  }}
                >
                  <SelectTrigger
                    id="template"
                    className="w-full h-9 bg-white/5 border-white/10 text-[#F2F7F7]"
                  >
                    <SelectValue placeholder="Blank" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
                    <SelectItem value="blank">Blank</SelectItem>
                    {templates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Label htmlFor="name" className="text-sm text-[#A8B2B2]">Name</Label>
                <Input
                  id="name"
                  value={newBoardName}
                  onChange={(e) => setNewBoardName(e.target.value)}
                  placeholder="e.g., Website Launch"
                  maxLength={100}
                  className="h-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                  onKeyDown={(e) => {
                    if (isComposingKey(e.nativeEvent)) return;
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleManualCreate();
                    }
                  }}
                />

                <Label htmlFor="description" className="text-sm text-[#A8B2B2]">Description</Label>
                <Input
                  id="description"
                  value={newBoardDescription}
                  onChange={(e) => setNewBoardDescription(e.target.value)}
                  placeholder="Optional"
                  maxLength={500}
                  className="h-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                />
              </div>
              <button
                type="button"
                onClick={() => importFileRef.current?.click()}
                className="text-xs text-[#A8B2B2] hover:text-[#78fcd6] transition-colors underline underline-offset-2"
              >
                Or import from JSON file
              </button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
          >
            Cancel
          </Button>
          {showAdvanced && (
            <Button
              type="button"
              onClick={handleManualCreate}
              disabled={!newBoardName.trim()}
              className="gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50"
            >
              Create Board
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

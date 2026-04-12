import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import { BoardSelector } from '@/components/board/BoardSelector';
import { KanbanBoard } from '@/components/board/KanbanBoard';
import { BoardSkeleton } from '@/components/board/BoardSkeleton';
import { TimelineView } from '@/components/timeline/TimelineView';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { UserProfile } from '@/components/auth/UserProfile';
import { SignInModal } from '@/components/auth/SignInModal';
import { Button } from '@/components/ui/button';
import { Plus, Layout, Clock, Sparkles, Github } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TemplatePicker } from '@/components/board/TemplatePicker';
import { templateToColumns, type BoardTemplate } from '@/lib/templates';
import { Footer } from './Footer';
import { useSubscription } from '@/hooks/useSubscription';
import { AIUpgradePrompt } from '@/components/billing/AIUpgradePrompt';

export function AppShell() {
  const {
    activeBoardId,
    viewMode,
    createBoard,
    setActiveBoard,
    setViewMode,
    getActiveBoard,
    getBoardsForUser,
    setCurrentUserId,
    remoteStatus,
    refreshFromRemote
  } = useBoardStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const [newBoardName, setNewBoardName] = useState('');
  const [newBoardDescription, setNewBoardDescription] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<BoardTemplate | null>(null);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isUpgradePromptOpen, setIsUpgradePromptOpen] = useState(false);
  const { isSignedIn, isLoaded, userId } = useAuth();
  const { hasSubscription } = useSubscription();

  const activeBoard = getActiveBoard();
  const userBoards = getBoardsForUser(userId);
  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL as string | undefined;
  const searchInputId = 'board-search-input';

  useKeyboardShortcuts({
    onSearch: () => {
      const el = document.getElementById(searchInputId) as HTMLInputElement | null;
      el?.focus();
    },
    onToggleAI: () => {
      if (hasSubscription) {
        setIsAIOpen((v) => !v);
      } else {
        setIsUpgradePromptOpen(true);
      }
    },
    onBoardView: () => setViewMode('board'),
    onTimelineView: () => setViewMode('timeline'),
    onNewBoard: () => setIsCreateDialogOpen(true),
    onShowShortcuts: () => setIsShortcutsOpen(true),
    onUndo: () => useUndoStore.getState().undo(),
    onRedo: () => useUndoStore.getState().redo(),
  });

  useEffect(() => {
    if (isLoaded) {
      setCurrentUserId(userId);
    }
  }, [isLoaded, userId, setCurrentUserId]);

  useEffect(() => {
    if (isSignedIn && remoteStatus === 'error') {
      void refreshFromRemote();
    }
  }, [isSignedIn, remoteStatus, refreshFromRemote]);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && remoteStatus === 'ready' && userBoards.length === 0) {
      const boardId = createBoard('My First Project', 'Welcome to ZeroBoard!');
      setActiveBoard(boardId);
    } else if (!activeBoardId && userBoards.length > 0) {
      setActiveBoard(userBoards[0].id);
    }
  }, [userBoards, activeBoardId, createBoard, setActiveBoard, isSignedIn, isLoaded, remoteStatus]);

  const handleCreateBoard = () => {
    if (newBoardName.trim()) {
      createBoard(
        newBoardName.trim(),
        newBoardDescription.trim() || undefined,
        selectedTemplate ? templateToColumns(selectedTemplate) : undefined
      );
      setNewBoardName('');
      setNewBoardDescription('');
      setSelectedTemplate(null);
      setIsCreateDialogOpen(false);
    }
  };

  const handleAIClick = () => {
    if (hasSubscription) {
      setIsAIOpen(true);
    } else {
      setIsUpgradePromptOpen(true);
    }
  };

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-xl gradient-cyan animate-pulse" />
          <span className="text-[#A8B2B2] text-sm">Loading ZeroBoard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-dvh bg-[#0B0F0F] text-[#F2F7F7] noise-overlay flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F0F]/90 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-cyan flex items-center justify-center">
              <span className="text-[#0B0F0F] font-bold text-sm">Z</span>
            </div>
            <span className="font-semibold text-lg">ZeroBoard</span>
          </div>

          {userBoards.length > 0 && (
            <div className="flex-1 mx-2 min-w-0">
              <BoardSelector />
            </div>
          )}

          <div className="flex items-center gap-2">
            {activeBoard && (
              <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 mr-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewMode('board')}
                  className={`h-8 px-3 rounded-md transition-all ${
                    viewMode === 'board'
                      ? 'bg-[#78fcd6]/20 text-[#78fcd6]'
                      : 'text-[#A8B2B2] hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Layout className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Board</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewMode('timeline')}
                  className={`h-8 px-3 rounded-md transition-all ${
                    viewMode === 'timeline'
                      ? 'bg-[#78fcd6]/20 text-[#78fcd6]'
                      : 'text-[#A8B2B2] hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Clock className="w-4 h-4 sm:mr-1.5" />
                  <span className="hidden sm:inline">Timeline</span>
                </Button>
              </div>
            )}

            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              className="h-9 px-4 gradient-cyan text-[#0B0F0F] hover:opacity-90 font-medium rounded-lg"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline ml-1.5">New Board</span>
            </Button>

            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 hidden sm:flex items-center justify-center transition-colors"
                aria-label="Open GitHub repository"
              >
                <Github className="w-4 h-4 text-[#A8B2B2]" />
              </a>
            )}

            <div className="ml-2">
              <UserProfile onSignInClick={() => setIsSignInModalOpen(true)} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-14 flex-1 min-h-0 overflow-hidden">
        {remoteStatus === 'loading' && !activeBoard ? (
          <BoardSkeleton />
        ) : activeBoard ? (
          viewMode === 'board' ? (
            <KanbanBoard board={activeBoard} />
          ) : (
            <TimelineView board={activeBoard} />
          )
        ) : (
          <div className="h-full flex items-center justify-center" style={{ minHeight: 'calc(100vh - 3.5rem)' }}>
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                <Layout className="w-8 h-8 text-[#78fcd6]" />
              </div>
              <h2 className="text-xl font-semibold mb-2">No board selected</h2>
              <p className="text-[#A8B2B2] mb-4">Create a new board to get started</p>
              <Button
                onClick={() => setIsCreateDialogOpen(true)}
                className="gradient-cyan text-[#0B0F0F] hover:opacity-90"
              >
                <Plus className="w-4 h-4 mr-2" />
                Create Board
              </Button>
            </div>
          </div>
        )}
      </main>

      <Footer variant="compact" />

      {/* AI Assistant Floating Button */}
      <button
        type="button"
        onClick={handleAIClick}
        className="fixed bottom-20 right-4 sm:bottom-6 sm:right-6 w-12 h-12 sm:w-14 sm:h-14 rounded-full gradient-cyan flex items-center justify-center shadow-lg hover:scale-105 transition-transform z-40 group"
        style={{
          boxShadow: '0 0 0 1px rgba(120, 252, 214, 0.35), 0 20px 50px rgba(120, 252, 214, 0.18)',
        }}
      >
        <Sparkles className="w-6 h-6 text-[#0B0F0F] group-hover:animate-pulse" />
      </button>

      <AIAssistant isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} />
      <AIUpgradePrompt isOpen={isUpgradePromptOpen} onOpenChange={setIsUpgradePromptOpen} />
      <KeyboardShortcutsHelp isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
      <SignInModal isOpen={isSignInModalOpen} onOpenChange={setIsSignInModalOpen} />

      <Toaster
        theme="dark"
        position="bottom-right"
        offset={{ bottom: 80 }}
        toastOptions={{
          style: {
            background: '#111515',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#F2F7F7',
          },
        }}
      />

      {/* Create Board Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={(open) => {
        setIsCreateDialogOpen(open);
        if (!open) setSelectedTemplate(null);
      }}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Create New Board</DialogTitle>
            <DialogDescription className="text-[#A8B2B2]">
              Create a new project board to organize your work.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <TemplatePicker selected={selectedTemplate} onSelect={setSelectedTemplate} />
            <div className="space-y-2">
              <Label htmlFor="name">Board Name</Label>
              <Input
                id="name"
                value={newBoardName}
                onChange={(e) => setNewBoardName(e.target.value)}
                placeholder="e.g., Website Launch"
                maxLength={100}
                className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateBoard()}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Input
                id="description"
                value={newBoardDescription}
                onChange={(e) => setNewBoardDescription(e.target.value)}
                placeholder="Brief description of your project"
                maxLength={500}
                className="bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCreateDialogOpen(false)}
              className="border-white/10 text-[#F2F7F7] hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateBoard}
              disabled={!newBoardName.trim()}
              className="gradient-cyan text-[#0B0F0F] hover:opacity-90 disabled:opacity-50"
            >
              Create Board
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

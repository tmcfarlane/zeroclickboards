import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { useBoardStore } from '@/store/useBoardStore';
import { BoardSelector } from '@/components/board/BoardSelector';
import { KanbanBoard } from '@/components/board/KanbanBoard';
import { TimelineView } from '@/components/timeline/TimelineView';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { UserProfile } from '@/components/auth/UserProfile';
import { SignInModal } from '@/components/auth/SignInModal';
import { Button } from '@/components/ui/button';
import { Plus, Layout, Clock, Sparkles, LogIn, Github } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function App() {
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
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const { isSignedIn, isLoaded, userId } = useAuth();

  const activeBoard = getActiveBoard();
  const userBoards = getBoardsForUser(userId);
  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL as string | undefined;
  const searchInputId = 'board-search-input';

  useKeyboardShortcuts({
    onSearch: () => {
      const el = document.getElementById(searchInputId) as HTMLInputElement | null;
      el?.focus();
    },
    onToggleAI: () => setIsAIOpen((v) => !v),
    onBoardView: () => setViewMode('board'),
    onTimelineView: () => setViewMode('timeline'),
    onNewBoard: () => setIsCreateDialogOpen(true),
    onShowShortcuts: () => setIsShortcutsOpen(true),
  });

  // Sync user ID with store
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

  // Create default board if none exists for this user
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
      createBoard(newBoardName.trim(), newBoardDescription.trim() || undefined);
      setNewBoardName('');
      setNewBoardDescription('');
      setIsCreateDialogOpen(false);
    }
  };

  // Show welcome/landing state for non-authenticated users
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

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7]">
        {/* Header */}
        <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F0F]/90 backdrop-blur-md border-b border-white/5">
          <div className="flex items-center justify-between px-4 py-3">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg gradient-cyan flex items-center justify-center">
                <span className="text-[#0B0F0F] font-bold text-sm">Z</span>
              </div>
              <span className="font-semibold text-lg">ZeroBoard</span>
            </div>

            {/* Auth Button */}
            <div className="flex items-center gap-2">
              {repoUrl && (
                <a
                  href={repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  aria-label="Open GitHub repository"
                >
                  <Github className="w-4 h-4 text-[#A8B2B2]" />
                </a>
              )}
              <Button
                onClick={() => setIsSignInModalOpen(true)}
                className="h-9 px-4 gradient-cyan text-[#0B0F0F] hover:opacity-90 font-medium rounded-lg"
              >
                <LogIn className="w-4 h-4 mr-1.5" />
                Sign In
              </Button>
            </div>
          </div>
        </header>

        {/* Landing Content */}
        <main className="pt-14 min-h-screen flex items-center justify-center">
          <div className="text-center max-w-2xl mx-auto px-4">
            <div className="w-20 h-20 rounded-2xl gradient-cyan flex items-center justify-center mx-auto mb-8 shadow-lg">
              <Layout className="w-10 h-10 text-[#0B0F0F]" />
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Organize your work with
              <span className="text-[#78fcd6]"> ZeroBoard</span>
            </h1>
            <p className="text-lg text-[#A8B2B2] mb-8 max-w-md mx-auto">
              A beautiful Kanban board for teams and individuals. 
              Sign in to create boards, track tasks, and collaborate with your team.
            </p>
            <Button
              onClick={() => setIsSignInModalOpen(true)}
              className="h-12 px-8 gradient-cyan text-[#0B0F0F] hover:opacity-90 font-semibold rounded-xl text-lg"
            >
              Get Started
            </Button>
          </div>
        </main>

        {/* Sign In Modal */}
        <SignInModal isOpen={isSignInModalOpen} onOpenChange={setIsSignInModalOpen} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0F0F] text-[#F2F7F7] noise-overlay">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F0F]/90 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg gradient-cyan flex items-center justify-center">
              <span className="text-[#0B0F0F] font-bold text-sm">Z</span>
            </div>
            <span className="font-semibold text-lg">ZeroBoard</span>
          </div>

          {/* Board Selector */}
          {userBoards.length > 0 && (
            <div className="hidden sm:block">
              <BoardSelector />
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {/* View Toggle */}
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
                  <Layout className="w-4 h-4 mr-1.5" />
                  Board
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
                  <Clock className="w-4 h-4 mr-1.5" />
                  Timeline
                </Button>
              </div>
            )}

            <Button
              onClick={() => setIsCreateDialogOpen(true)}
              className="h-9 px-4 gradient-cyan text-[#0B0F0F] hover:opacity-90 font-medium rounded-lg"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Board
            </Button>

            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="h-9 w-9 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                aria-label="Open GitHub repository"
              >
                <Github className="w-4 h-4 text-[#A8B2B2]" />
              </a>
            )}

            {/* User Profile */}
            <div className="ml-2">
              <UserProfile onSignInClick={() => setIsSignInModalOpen(true)} />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-14 h-screen">
        {activeBoard ? (
          viewMode === 'board' ? (
            <KanbanBoard board={activeBoard} />
          ) : (
            <TimelineView board={activeBoard} />
          )
        ) : (
          <div className="h-full flex items-center justify-center">
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

      {/* AI Assistant Floating Button */}
      <button
        type="button"
        onClick={() => setIsAIOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full gradient-cyan flex items-center justify-center shadow-lg hover:scale-105 transition-transform z-40 group"
        style={{
          boxShadow: '0 0 0 1px rgba(120, 252, 214, 0.35), 0 20px 50px rgba(120, 252, 214, 0.18)',
        }}
      >
        <Sparkles className="w-6 h-6 text-[#0B0F0F] group-hover:animate-pulse" />
      </button>

      {/* AI Assistant Panel */}
      <AIAssistant isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: '#111515',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#F2F7F7',
          },
        }}
      />

      {/* Create Board Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="bg-[#111515] border-white/10 text-[#F2F7F7]">
          <DialogHeader>
            <DialogTitle>Create New Board</DialogTitle>
            <DialogDescription className="text-[#A8B2B2]">
              Create a new project board to organize your work.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
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

export default App;

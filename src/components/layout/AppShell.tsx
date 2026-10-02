import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Toaster, toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp';
import { useBoardStore } from '@/store/useBoardStore';
import { useUndoStore } from '@/store/useUndoStore';
import { KanbanBoard } from '@/components/board/KanbanBoard';
import { BoardSkeleton } from '@/components/board/BoardSkeleton';
import { ActiveCardEditor } from '@/components/board/ActiveCardEditor';
import { CardEditor, type CardEditorSaveData } from '@/components/board/CardEditor';
import { BoardSyncNotice } from '@/components/board/BoardSyncNotice';
import { BoardSelector } from '@/components/board/BoardSelector';
import { BoardTextDialog } from '@/components/board/BoardTextDialog';
import { ShareBoardDialog } from '@/components/board/ShareBoardDialog';
import { BoardDialogContext, type BoardTextDialogRequest, type BoardTextDialogTarget } from '@/hooks/useBoardDialogs';
import { ReadOnlyBoard } from '@/components/board/ReadOnlyBoard';
import { ViewToggle } from '@/components/board/ViewToggle';
import { Input } from '@/components/ui/input';
import { TimelineView } from '@/components/timeline/TimelineView';
import { AIAssistant } from '@/components/ai/AIAssistant';
import { UserProfile } from '@/components/auth/UserProfile';
import { SignInModal } from '@/components/auth/SignInModal';
import { Button } from '@/components/ui/button';
import { Plus, Layout, Github } from 'lucide-react';
import { CreateBoardDialog } from '@/components/board/CreateBoardDialog';
import { Footer } from './Footer';
import { AIUpgradePrompt } from '@/components/billing/AIUpgradePrompt';
import { UpgradeToProBanner } from '@/components/billing/UpgradeToProBanner';


export function AppShell() {
  const {
    activeBoardId,
    viewMode,
    createBoard,
    addCard,
    setActiveBoard,
    setViewMode,
    getActiveBoard,
    getBoardsForUser,
    setCurrentUserId,
    boardSyncStates,
    cardEditorSession,
    remoteStatus,
    refreshFromRemote
  } = useBoardStore();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newCardTarget, setNewCardTarget] = useState<{ boardId: string; columnId: string } | null>(null);
  const [textDialogRequest, setTextDialogRequest] = useState<BoardTextDialogRequest | null>(null);
  const [shareDialogRequest, setShareDialogRequest] = useState<{ boardId: string; boardName: string; isPublic: boolean; embedEnabled: boolean } | null>(null);
  const [hasShareDraft, setHasShareDraft] = useState(false);
  const [searchBoardId, setSearchBoardId] = useState<string | null>(null);
  const [viewerSearch, setViewerSearch] = useState('');
  const viewerSearchRef = useRef<HTMLInputElement>(null);
  const [isSignInModalOpen, setIsSignInModalOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isUpgradePromptOpen, setIsUpgradePromptOpen] = useState(false);
  const { isSignedIn, isLoaded, userId } = useAuth();


  const activeBoard = getActiveBoard();
  const userBoards = getBoardsForUser();
  const hasUnsavedChanges = !!cardEditorSession || !!textDialogRequest || hasShareDraft || Object.values(boardSyncStates).some((state) => state.status !== 'saved');
  const repoUrl = import.meta.env.VITE_GITHUB_REPO_URL as string | undefined;
  const canEditActiveBoard = !!activeBoard && useBoardStore.getState().canEditBoard(activeBoard.id);
  const sharedBoard = shareDialogRequest ? useBoardStore.getState().boards.find((board) => board.id === shareDialogRequest.boardId) : undefined;

  const openTextDialog = useCallback((target: BoardTextDialogTarget) => {
    const store = useBoardStore.getState();
    const board = store.boards.find((candidate) => candidate.id === target.boardId);
    if (!board || !store.canEditBoard(target.boardId)) return;
    const column = target.kind === 'rename-column' ? board.columns.find((candidate) => candidate.id === target.columnId) : undefined;
    if (target.kind === 'rename-column' && !column) return;
    setTextDialogRequest({ ...target, initialTitle: target.kind === 'rename-board' ? board.name : column?.title ?? '' });
  }, []);
  const openShareDialog = useCallback((boardId: string) => {
    const store = useBoardStore.getState();
    const board = store.boards.find((candidate) => candidate.id === boardId);
    if (!board || !store.canManageBoard(boardId)) return;
    setShareDialogRequest({ boardId, boardName: board.name, isPublic: board.isPublic ?? false, embedEnabled: board.embedEnabled ?? false });
  }, []);
  const boardDialogs = useMemo(() => ({ openTextDialog, openShareDialog }), [openTextDialog, openShareDialog]);

  useKeyboardShortcuts({
    onNewCard: () => {
      if (!activeBoard || !useBoardStore.getState().canEditBoard(activeBoard.id)) return;
      const column = activeBoard?.columns.find((candidate) => !activeBoard.hiddenColumnIds?.includes(candidate.id));
      if (activeBoard && column) {
        setNewCardTarget({ boardId: activeBoard.id, columnId: column.id });
      } else if (activeBoard) {
        toast.info('Show or add a column before adding a card.');
      }
    },
    onSearch: () => {
      if (!activeBoard) return;
      setViewMode('board');
      setSearchBoardId(activeBoard.id);
    },
    onToggleAI: () => setIsAIOpen((v) => { if (!v && viewMode === 'timeline') setViewMode('board'); return !v; }),
    onBoardView: () => setViewMode('board'),
    onTimelineView: () => { setViewMode('timeline'); setIsAIOpen(false); },
    onNewBoard: () => setIsCreateDialogOpen(true),
    onShowShortcuts: () => setIsShortcutsOpen(true),
    onUndo: () => { if (canEditActiveBoard) useUndoStore.getState().undo(); },
    onRedo: () => { if (canEditActiveBoard) useUndoStore.getState().redo(); },
  });

  useEffect(() => {
    if (searchBoardId && searchBoardId !== activeBoard?.id) setSearchBoardId(null);
    else if (searchBoardId && !canEditActiveBoard && viewMode === 'board') {
      viewerSearchRef.current?.focus();
      setSearchBoardId(null);
    }
  }, [searchBoardId, activeBoard?.id, canEditActiveBoard, viewMode]);

  useEffect(() => {
    if (isLoaded) {
      setCurrentUserId(userId);
      setTextDialogRequest(null);
      setShareDialogRequest(null);
      setHasShareDraft(false);
    }
  }, [isLoaded, userId, setCurrentUserId]);

  useEffect(() => {
    if (!isSignedIn) return;
    const refreshOnFocus = () => {
      void refreshFromRemote();
    };
    window.addEventListener('focus', refreshOnFocus);
    return () => window.removeEventListener('focus', refreshOnFocus);
  }, [isSignedIn, refreshFromRemote]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeLeaving);
    return () => window.removeEventListener('beforeunload', warnBeforeLeaving);
  }, [hasUnsavedChanges]);

  const [searchParams, setSearchParams] = useSearchParams();

  // Deep-link: /app?board=<id> sets the active board
  useEffect(() => {
    const deepLinkBoard = searchParams.get('board');
    if (deepLinkBoard && remoteStatus === 'ready') {
      const exists = userBoards.some(b => b.id === deepLinkBoard);
      if (exists) {
        setActiveBoard(deepLinkBoard);
        setSearchParams({}, { replace: true }); // clean the URL
      }
    }
  }, [searchParams, remoteStatus, userBoards, setActiveBoard, setSearchParams]);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && remoteStatus === 'ready' && userBoards.length === 0 && !cardEditorSession && !textDialogRequest && !shareDialogRequest) {
      const boardId = createBoard('My First Project', 'Welcome to ZeroBoard!');
      setActiveBoard(boardId);
    } else if (!activeBoardId && userBoards.length > 0) {
      setActiveBoard(userBoards[0].id);
    }
  }, [userBoards, activeBoardId, createBoard, setActiveBoard, isSignedIn, isLoaded, remoteStatus, cardEditorSession, textDialogRequest, shareDialogRequest]);

  const handleAIClick = () => {
    setIsAIOpen((v) => !v);
  };

  const handleKeyboardAddCard = (data: CardEditorSaveData) => {
    if (!newCardTarget) return;
    if (!useBoardStore.getState().canEditBoard(newCardTarget.boardId)) return;
    const board = useBoardStore.getState().boards.find((candidate) => candidate.id === newCardTarget.boardId);
    if (!board?.columns.some((column) => column.id === newCardTarget.columnId)) {
      toast.error('This column is no longer available. Close this card and choose another column.');
      return;
    }
    const cardId = addCard(newCardTarget.boardId, newCardTarget.columnId, data.title, data.content, data.targetDate, {
      description: data.description,
      labels: data.labels,
      coverImage: data.coverImage,
      attachments: data.attachments,
      recurrence: data.recurrence,
    });
    if (cardId) setNewCardTarget(null);
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
    <BoardDialogContext.Provider value={boardDialogs}>
    <div className="h-dvh bg-[#0B0F0F] text-[#F2F7F7] noise-overlay flex flex-col">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#0B0F0F]/90 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-1.5">
          <div className="flex items-center gap-2">
            <img src="/logo/logo_color.svg" alt="ZeroBoard" className="w-6 h-6" />
            <span className="font-semibold text-sm">ZeroBoard</span>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3">
            <UpgradeToProBanner />

            <div className="hidden sm:block h-5 w-px bg-white/10" aria-hidden="true" />

            <Button
              aria-label="New Board"
              onClick={() => setIsCreateDialogOpen(true)}
              variant="ghost"
              className="h-8 px-3 bg-white/5 border border-white/10 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/10 font-medium rounded-md text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline ml-1">New Board</span>
            </Button>

            {repoUrl && (
              <a
                href={repoUrl}
                target="_blank"
                rel="noreferrer"
                className="h-8 w-8 rounded-md border border-white/10 bg-white/5 hover:bg-white/10 hidden sm:flex items-center justify-center transition-colors"
                aria-label="Open GitHub repository"
              >
                <Github className="w-3.5 h-3.5 text-[#A8B2B2]" />
              </a>
            )}

            <div className="ml-1">
              <UserProfile
                onSignInClick={() => setIsSignInModalOpen(true)}
                onPricingClick={() => setIsUpgradePromptOpen(true)}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Header spacer — matches fixed header height */}
      <div className="pt-10" />

      {/* Main Content Area with AI Side Panel */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <AIAssistant isOpen={isAIOpen} onClose={() => setIsAIOpen(false)} onUpgrade={() => setIsUpgradePromptOpen(true)} />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {activeBoard ? <BoardSyncNotice boardId={activeBoard.id} /> : null}
          <main className="flex-1 min-h-0 overflow-hidden">
            {remoteStatus === 'loading' && !activeBoard ? (
              <BoardSkeleton />
            ) : activeBoard ? (
              viewMode === 'board' ? (
                !canEditActiveBoard ? (
                  <div className="h-full min-h-0 flex flex-col">
                    <div className="px-3 py-3 border-b border-white/10 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <BoardSelector onCreateBoardClick={() => setIsCreateDialogOpen(true)} />
                        <ViewToggle />
                      </div>
                      <p className="text-xs text-[#A8B2B2]">Read-only board</p>
                      <Input ref={viewerSearchRef} aria-label="Search cards" placeholder="Search cards..." value={viewerSearch} onChange={(event) => setViewerSearch(event.target.value)} className="bg-white/5 border-white/10" />
                    </div>
                    <div className="flex-1 min-h-0"><ReadOnlyBoard board={activeBoard} searchQuery={viewerSearch} /></div>
                  </div>
                ) : (
                <KanbanBoard
                  board={activeBoard}
                  onAIClick={handleAIClick}
                  onNewBoardClick={() => setIsCreateDialogOpen(true)}
                  onNewCardClick={(columnId) => { if (useBoardStore.getState().canEditBoard(activeBoard.id)) setNewCardTarget({ boardId: activeBoard.id, columnId }); }}
                  searchRequested={searchBoardId === activeBoard.id}
                  onSearchHandled={() => setSearchBoardId(null)}
                />
                )
              ) : (
                <TimelineView
                  board={activeBoard}
                  onNewBoardClick={() => setIsCreateDialogOpen(true)}
                />
              )
            ) : (
              <div className="h-full flex items-center justify-center" style={{ minHeight: 'calc(100vh - 2.5rem)' }}>
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
        </div>
      </div>


      <ActiveCardEditor />
      {textDialogRequest && <BoardTextDialog key={`${textDialogRequest.kind}:${textDialogRequest.boardId}:${textDialogRequest.kind === 'rename-column' ? textDialogRequest.columnId : ''}`} request={textDialogRequest} onClose={() => setTextDialogRequest(null)} />}
      {shareDialogRequest && (
        <ShareBoardDialog
          key={shareDialogRequest.boardId}
          boardId={shareDialogRequest.boardId}
          boardName={sharedBoard?.name ?? shareDialogRequest.boardName}
          isPublic={sharedBoard?.isPublic ?? shareDialogRequest.isPublic}
          embedEnabled={sharedBoard?.embedEnabled ?? shareDialogRequest.embedEnabled}
          isOpen
          onDraftChange={setHasShareDraft}
          onOpenChange={(open) => { if (!open) { setShareDialogRequest(null); setHasShareDraft(false); } }}
        />
      )}
      {newCardTarget && (
        <CardEditor isOpen onClose={() => setNewCardTarget(null)} onSave={handleKeyboardAddCard} mode="create" accessMessage={!useBoardStore.getState().canEditBoard(newCardTarget.boardId) ? 'You no longer have editing access to this board. Your form is kept here; copy anything you need before closing it.' : undefined} />
      )}
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

      <CreateBoardDialog
        isOpen={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onOpenSignIn={() => setIsSignInModalOpen(true)}
        onUpgrade={() => setIsUpgradePromptOpen(true)}
      />
    </div>
    </BoardDialogContext.Provider>
  );
}

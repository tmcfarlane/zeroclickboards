# Mobile Kanban Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the Kanban board for iPhone SE (375x667) with single-column tab navigation, condensed header, bottom action bar, and swipe gestures.

**Architecture:** Mobile layout is a parallel rendering branch inside `KanbanBoard.tsx`, toggled via Tailwind `sm:` responsive classes and a `useIsCompact` JS hook. Three new small components (`MobileColumnTabs`, `MobileBottomBar`, `MobileSearchOverlay`) handle mobile-specific UI. Cards render directly in KanbanBoard on mobile (not wrapped in `KanbanColumn`) for full-width display. Desktop layout is completely untouched.

**Tech Stack:** React 19, TypeScript, Tailwind CSS (sm: breakpoint = 640px), @dnd-kit (existing), vanilla touch events for swipe.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/hooks/use-is-compact.ts` | Create | 640px media query hook for JS-side mobile detection |
| `src/components/board/MobileColumnTabs.tsx` | Create | Scrollable tab strip showing column names + card counts |
| `src/components/board/MobileBottomBar.tsx` | Create | Fixed bottom bar with Ask AI + Add Card buttons |
| `src/components/board/MobileSearchOverlay.tsx` | Create | Slide-down search bar triggered from overflow menu |
| `src/components/board/KanbanBoard.tsx` | Modify | Add mobile header, mobile card list, activeColumnIndex state, swipe logic, integrate new components |

**Files NOT modified:** `KanbanColumn.tsx`, `KanbanCard.tsx`, `KanbanBoard` desktop layout. The mobile branch renders cards directly without the `KanbanColumn` wrapper, so existing components stay untouched.

---

### Task 1: Create `useIsCompact` hook

**Files:**
- Create: `src/hooks/use-is-compact.ts`

- [ ] **Step 1: Create the hook file**

```ts
// src/hooks/use-is-compact.ts
import { useState, useEffect } from 'react';

const COMPACT_BREAKPOINT = 640;

export function useIsCompact() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${COMPACT_BREAKPOINT - 1}px)`);
    const onChange = () => setIsCompact(mql.matches);
    mql.addEventListener('change', onChange);
    setIsCompact(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isCompact;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `use-is-compact.ts`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/use-is-compact.ts
git commit -m "feat: add useIsCompact hook for 640px mobile detection"
```

---

### Task 2: Create `MobileColumnTabs` component

**Files:**
- Create: `src/components/board/MobileColumnTabs.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/board/MobileColumnTabs.tsx
import { useEffect, useRef } from 'react';
import type { Column } from '@/types';

interface MobileColumnTabsProps {
  columns: Column[];
  activeIndex: number;
  onTabChange: (index: number) => void;
}

export function MobileColumnTabs({ columns, activeIndex, onTabChange }: MobileColumnTabsProps) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [activeIndex]);

  return (
    <div
      ref={tabsRef}
      className="flex items-stretch gap-0 overflow-x-auto scrollbar-none bg-[#111515]/80 backdrop-blur-sm border-b border-white/10 sm:hidden"
    >
      {columns.map((col, i) => {
        const isActive = i === activeIndex;
        const cardCount = col.cards.filter(c => !c.isArchived).length;
        return (
          <button
            key={col.id}
            ref={isActive ? activeTabRef : undefined}
            type="button"
            onClick={() => onTabChange(i)}
            className={`flex-shrink-0 px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
              isActive
                ? 'text-[#78fcd6] border-[#78fcd6]'
                : 'text-[#A8B2B2] border-transparent hover:text-[#F2F7F7]'
            }`}
          >
            {col.title}
            <span className={`ml-1.5 text-xs ${isActive ? 'text-[#78fcd6]/70' : 'text-[#A8B2B2]/50'}`}>
              {cardCount}
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `MobileColumnTabs.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/board/MobileColumnTabs.tsx
git commit -m "feat: add MobileColumnTabs component for column navigation"
```

---

### Task 3: Create `MobileBottomBar` component

**Files:**
- Create: `src/components/board/MobileBottomBar.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/board/MobileBottomBar.tsx
import { Button } from '@/components/ui/button';
import { Plus, Sparkles } from 'lucide-react';

interface MobileBottomBarProps {
  onAIClick?: () => void;
  onAddCard: () => void;
}

export function MobileBottomBar({ onAIClick, onAddCard }: MobileBottomBarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-white/10 bg-[#0B0F0F]/90 backdrop-blur-sm sm:hidden">
      {onAIClick && (
        <Button
          onClick={onAIClick}
          variant="ghost"
          className="flex-1 h-11 gap-2 text-sm font-medium text-[#78fcd6] bg-[#78fcd6]/10 border border-[#78fcd6]/30 hover:bg-[#78fcd6]/20"
        >
          <Sparkles className="w-4 h-4" />
          Ask AI
        </Button>
      )}
      <Button
        onClick={onAddCard}
        variant="ghost"
        className="flex-1 h-11 gap-2 text-sm font-medium text-[#F2F7F7] bg-white/5 border border-white/10 hover:bg-white/10"
      >
        <Plus className="w-4 h-4" />
        Add Card
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `MobileBottomBar.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/board/MobileBottomBar.tsx
git commit -m "feat: add MobileBottomBar component with Ask AI and Add Card"
```

---

### Task 4: Create `MobileSearchOverlay` component

**Files:**
- Create: `src/components/board/MobileSearchOverlay.tsx`

- [ ] **Step 1: Create the component**

```tsx
// src/components/board/MobileSearchOverlay.tsx
import { useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, X } from 'lucide-react';

interface MobileSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  value: string;
  onChange: (value: string) => void;
}

export function MobileSearchOverlay({ isOpen, onClose, value, onChange }: MobileSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 py-2 bg-[#0B0F0F] border-b border-white/10 sm:hidden">
      <Search className="w-4 h-4 text-[#A8B2B2] shrink-0" />
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search cards..."
        className="flex-1 h-9 bg-white/5 border-white/10 text-[#F2F7F7] placeholder:text-[#A8B2B2]/50"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={() => { onChange(''); onClose(); }}
        className="h-9 w-9 text-[#A8B2B2] hover:text-[#F2F7F7] shrink-0"
      >
        <X className="w-4 h-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to `MobileSearchOverlay.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/components/board/MobileSearchOverlay.tsx
git commit -m "feat: add MobileSearchOverlay for slide-down search"
```

---

### Task 5: Add mobile header to `KanbanBoard`

This task modifies the header section of `KanbanBoard.tsx`. The existing desktop header (lines 399-620) gets wrapped in `hidden sm:flex` classes, and a new mobile header is added above it with `flex sm:hidden`.

**Files:**
- Modify: `src/components/board/KanbanBoard.tsx`

- [ ] **Step 1: Add imports**

At the top of `KanbanBoard.tsx`, add these imports:

```tsx
import { useIsCompact } from '@/hooks/use-is-compact';
import { MobileColumnTabs } from './MobileColumnTabs';
import { MobileBottomBar } from './MobileBottomBar';
import { MobileSearchOverlay } from './MobileSearchOverlay';
import { verticalListSortingStrategy } from '@dnd-kit/sortable';
import { X } from 'lucide-react';
```

Note: `verticalListSortingStrategy` is needed for the mobile card list in Task 7. `X` icon is already imported if present; check first. `horizontalListSortingStrategy` is already imported — keep it for desktop.

- [ ] **Step 2: Add mobile state variables**

Inside the `KanbanBoard` component function, after the existing state declarations (around line 62), add:

```tsx
const isCompact = useIsCompact();
const [activeColumnIndex, setActiveColumnIndex] = useState(0);
const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
const [isFilterOpen, setIsFilterOpen] = useState(false);
```

Also add a guard so `activeColumnIndex` stays in bounds when columns change:

```tsx
useEffect(() => {
  if (activeColumnIndex >= filteredColumns.length && filteredColumns.length > 0) {
    setActiveColumnIndex(filteredColumns.length - 1);
  }
}, [filteredColumns.length, activeColumnIndex]);
```

Place this `useEffect` after the `filteredColumns` computation (after line 394).

- [ ] **Step 3: Add mobile header JSX**

Replace the board header div (line 399) opening tag:

```tsx
{/* Board Header */}
<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 pt-5 pb-3 border-b border-white/5">
```

With a structure that has both mobile and desktop headers:

```tsx
{/* Mobile Header */}
<div className="relative flex sm:hidden items-center justify-between px-3 pt-3 pb-2 border-b border-white/5">
  <div className="flex items-center gap-2 min-w-0 flex-1">
    <BoardSelector onCreateBoardClick={onNewBoardClick} />
  </div>
  <div className="flex items-center gap-1">
    <ViewToggle />
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-[#A8B2B2] hover:text-[#F2F7F7] hover:bg-white/5"
        >
          <MoreHorizontal className="w-5 h-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48 bg-[#111515] border-white/10">
        <DropdownMenuItem
          onClick={() => setIsMobileSearchOpen(true)}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <Search className="w-4 h-4" />
          Search
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setIsFilterOpen(!isFilterOpen)}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <SlidersHorizontal className="w-4 h-4" />
          Filter
          {(selectedLabels.length > 0 || dueDateFilter) && (
            <span className="ml-auto w-2 h-2 bg-[#78fcd6] rounded-full" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setIsShareDialogOpen(true)}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <Share2 className="w-4 h-4" />
          Share
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-white/10" />
        <DropdownMenuItem
          onClick={() => setIsAddColumnDialogOpen(true)}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <Plus className="w-4 h-4" />
          Add Column
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            const template = boardToTemplate(board);
            saveUserBoardTemplate(template);
            toast.success('Board saved as template — use it when creating a new board');
          }}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <BookmarkPlus className="w-4 h-4" />
          Save as Template
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            downloadBoardJSON(board);
            toast.success('Board exported');
          }}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <Download className="w-4 h-4" />
          Export to JSON
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setIsBackgroundPickerOpen(true)}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <Palette className="w-4 h-4" />
          Change Background
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setIsArchiveOpen(true)}
          className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
        >
          <Archive className="w-4 h-4" />
          Archive
        </DropdownMenuItem>
        {hiddenColumns.length > 0 && (
          <>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuLabel className="text-[#A8B2B2] text-xs">
              Hidden Columns
            </DropdownMenuLabel>
            {hiddenColumns.map((col) => (
              <DropdownMenuItem
                key={col.id}
                onClick={() => showColumn(col.id)}
                className="text-[#F2F7F7] focus:bg-white/5 focus:text-[#F2F7F7]"
              >
                <Eye className="w-4 h-4" />
                {col.title}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  <MobileSearchOverlay
    isOpen={isMobileSearchOpen}
    onClose={() => setIsMobileSearchOpen(false)}
    value={searchQuery}
    onChange={setSearchQuery}
  />
</div>

{/* Mobile Filter Panel (below header when open) */}
{isFilterOpen && (
  <div className="sm:hidden px-3 py-3 border-b border-white/10 bg-[#111515]/80 backdrop-blur-sm">
    <div className="flex items-center justify-between mb-2">
      <p className="text-xs font-medium text-[#A8B2B2]">Filters</p>
      <button type="button" onClick={() => setIsFilterOpen(false)} className="text-[#A8B2B2] hover:text-[#F2F7F7]">
        <X className="w-4 h-4" />
      </button>
    </div>
    <div className="space-y-3">
      <div>
        <p className="text-xs font-medium text-[#A8B2B2] mb-2 flex items-center gap-1.5">
          <Tag className="w-3 h-3" /> Labels
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setSelectedLabels(selectedLabels.includes(label)
                  ? selectedLabels.filter((l) => l !== label)
                  : [...selectedLabels, label]
                );
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                selectedLabels.includes(label)
                  ? 'border-[#78fcd6]/50 bg-[#78fcd6]/10 text-[#78fcd6]'
                  : 'border-white/10 bg-white/5 text-[#A8B2B2]'
              }`}
            >
              <div className={`w-3 h-3 rounded ${LABEL_COLORS[label]}`} />
              <span className="capitalize">{label}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="text-xs font-medium text-[#A8B2B2] mb-2 flex items-center gap-1.5">
          <Calendar className="w-3 h-3" /> Due Date
        </p>
        <div className="flex flex-wrap gap-2">
          {DUE_DATE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDueDateFilter(dueDateFilter === opt.value ? null : opt.value)}
              className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                dueDateFilter === opt.value
                  ? 'border-[#78fcd6]/50 bg-[#78fcd6]/20 text-[#78fcd6]'
                  : 'border-white/10 text-[#A8B2B2] bg-white/5'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {(selectedLabels.length > 0 || dueDateFilter) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setSelectedLabels([]); setDueDateFilter(null); }}
          className="h-7 text-xs text-[#A8B2B2] hover:text-[#F2F7F7]"
        >
          Clear All
        </Button>
      )}
    </div>
  </div>
)}

{/* Desktop Header (unchanged) */}
<div className="hidden sm:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 pt-5 pb-3 border-b border-white/5">
```

The rest of the desktop header content (lines 400-620) remains exactly as-is, followed by its closing `</div>`.

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/components/board/KanbanBoard.tsx
git commit -m "feat: add condensed mobile header with overflow menu and filters"
```

---

### Task 6: Add column tab strip to `KanbanBoard`

**Files:**
- Modify: `src/components/board/KanbanBoard.tsx`

- [ ] **Step 1: Add the tab strip between the headers and the board columns**

After the desktop header closing `</div>` (and the `ArchiveView`/`BackgroundPicker` renders), and before the `{/* Board Columns */}` comment, add:

```tsx
{/* Mobile Column Tabs */}
<MobileColumnTabs
  columns={filteredColumns}
  activeIndex={activeColumnIndex}
  onTabChange={setActiveColumnIndex}
/>
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/board/KanbanBoard.tsx
git commit -m "feat: integrate MobileColumnTabs in KanbanBoard"
```

---

### Task 7: Add mobile card list and bottom bar to `KanbanBoard`

This is the core layout change. The existing `DndContext` + horizontal scroll area gets wrapped with `hidden sm:block` for desktop, and a new mobile card list renders below the tab strip.

**Files:**
- Modify: `src/components/board/KanbanBoard.tsx`

- [ ] **Step 1: Add mobile card list state**

Add a ref for the mobile card list (near the other refs around line 84):

```tsx
const mobileCardListRef = useRef<HTMLDivElement>(null);
```

Compute the active column for mobile rendering (after `filteredColumns`, around line 394):

```tsx
const activeColumn = filteredColumns[activeColumnIndex] ?? filteredColumns[0];
const activeColumnCards = activeColumn?.cards.filter(c => !c.isArchived) ?? [];
```

Add state for mobile Add Card dialog:

```tsx
const [isMobileAddCardOpen, setIsMobileAddCardOpen] = useState(false);
```

Add the handler for mobile Add Card (near `handleAddColumn`, around line 354):

```tsx
const handleMobileAddCard = (data: CardEditorSaveData) => {
  if (!activeColumn) return;
  addCard(board.id, activeColumn.id, data.title, data.content, data.targetDate, {
    labels: data.labels,
    coverImage: data.coverImage,
    attachments: data.attachments,
    recurrence: data.recurrence,
  });
  setIsMobileAddCardOpen(false);
};
```

Note: `CardEditorSaveData` needs to be imported. Add to the imports at the top:

```tsx
import { CardEditor, type CardEditorSaveData } from './CardEditor';
```

- [ ] **Step 2: Wrap desktop DndContext in responsive classes**

Change the existing DndContext block (lines 622-658). Wrap the desktop scroll container div with `hidden sm:block`:

Find this line (631):
```tsx
<div ref={scrollContainerRef} className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin cursor-grab">
```

Change to:
```tsx
<div ref={scrollContainerRef} className="hidden sm:flex flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin cursor-grab">
```

(Changed `flex-1` stays, added `hidden sm:flex` so it's hidden on mobile but flex on desktop.)

- [ ] **Step 3: Add mobile card list before the desktop scroll container**

Inside the `DndContext` (after the opening `<DndContext>` tag, before the desktop scroll div), add the mobile card list:

```tsx
{/* Mobile: single column card list */}
{isCompact && activeColumn && (
  <div ref={mobileCardListRef} className="flex-1 overflow-y-auto sm:hidden">
    <div className="p-3 space-y-2">
      <SortableContext
        items={activeColumnCards.map((c) => c.id)}
        strategy={verticalListSortingStrategy}
      >
        {activeColumnCards.map((card) => (
          <KanbanCard
            key={card.id}
            boardId={board.id}
            columnId={activeColumn.id}
            card={card}
          />
        ))}
      </SortableContext>
      {activeColumnCards.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-[#A8B2B2]">
          <p className="text-sm">No cards in this column</p>
        </div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 4: Update DragOverlay for mobile width**

Find the existing DragOverlay (line 647-656):

```tsx
<DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
  {activeCard ? (
    <div className="w-72 sm:w-80 bg-[#1a1f1f] border border-[#78fcd6]/30 rounded-lg p-3 shadow-2xl shadow-[#78fcd6]/10 opacity-90 rotate-2">
```

Change the overlay div classes to be full-width on mobile:

```tsx
<DragOverlay dropAnimation={{ duration: 200, easing: 'ease' }}>
  {activeCard ? (
    <div className="w-[calc(100vw-24px)] sm:w-80 bg-[#1a1f1f] border border-[#78fcd6]/30 rounded-lg p-3 shadow-2xl shadow-[#78fcd6]/10 opacity-90 rotate-2">
```

- [ ] **Step 5: Add MobileBottomBar and mobile CardEditor after the DndContext**

After the closing `</DndContext>` tag, before the ShareBoardDialog, add:

```tsx
{/* Mobile Bottom Bar */}
<MobileBottomBar
  onAIClick={onAIClick}
  onAddCard={() => setIsMobileAddCardOpen(true)}
/>

{/* Mobile Add Card Dialog */}
<CardEditor
  isOpen={isMobileAddCardOpen}
  onClose={() => setIsMobileAddCardOpen(false)}
  onSave={handleMobileAddCard}
  mode="create"
/>
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/components/board/KanbanBoard.tsx
git commit -m "feat: add mobile single-column card list with bottom bar"
```

---

### Task 8: Add swipe gesture between columns

**Files:**
- Modify: `src/components/board/KanbanBoard.tsx`

- [ ] **Step 1: Add swipe touch handlers**

Add a `useEffect` for swipe handling on the mobile card list. Place this after the existing scroll/wheel `useEffect` (after line 147):

```tsx
useEffect(() => {
  const el = mobileCardListRef.current;
  if (!el || !isCompact) return;

  let touchStartX = 0;
  let touchStartY = 0;
  let isSwiping = false;

  function onTouchStart(e: TouchEvent) {
    if (activeDragData) return;
    const touch = e.touches[0];
    touchStartX = touch.clientX;
    touchStartY = touch.clientY;
    isSwiping = false;
  }

  function onTouchMove(e: TouchEvent) {
    if (activeDragData) return;
    if (isSwiping) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartX);
    const dy = Math.abs(touch.clientY - touchStartY);
    if (dx > 10 || dy > 10) {
      isSwiping = dx > dy;
    }
  }

  function onTouchEnd(e: TouchEvent) {
    if (activeDragData || !isSwiping) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    if (Math.abs(dx) < 50) return;

    if (dx < 0 && activeColumnIndex < filteredColumns.length - 1) {
      setActiveColumnIndex(activeColumnIndex + 1);
    } else if (dx > 0 && activeColumnIndex > 0) {
      setActiveColumnIndex(activeColumnIndex - 1);
    }
  }

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true });

  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
  };
}, [isCompact, activeDragData, activeColumnIndex, filteredColumns.length]);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/board/KanbanBoard.tsx
git commit -m "feat: add swipe gesture to navigate between columns on mobile"
```

---

### Task 9: Visual verification

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open in browser at iPhone SE dimensions**

Open the app in Chrome. Open DevTools → Toggle Device Toolbar → select "iPhone SE" (375x667).

Verify the following:

1. **Mobile header**: Board name visible with chevron, ViewToggle icons visible, overflow menu (⋯) opens with Search/Filter/Share/Add Column/etc.
2. **Search overlay**: Tapping Search in ⋯ menu opens a slide-down search bar. Typing filters cards. X closes and clears.
3. **Filter panel**: Tapping Filter in ⋯ menu opens inline filter panel with label pills and due date pills. Filters apply to card list.
4. **Column tabs**: Tab strip shows all columns with card counts. Active tab has teal underline. Tabs scroll horizontally if many columns. Tapping a tab switches the card list.
5. **Card list**: Shows cards for the active column only, full-width. Cards display title, labels, dates, descriptions correctly.
6. **Empty column**: Switching to a column with no cards shows "No cards in this column" message.
7. **Bottom bar**: Fixed at bottom with "Ask AI" (teal accent) and "Add Card" buttons. Add Card opens the editor dialog for the active column. Ask AI opens the AI panel.
8. **Swipe**: Swiping left/right on the card list switches to adjacent columns.
9. **Drag & drop**: Long-press a card to start dragging. Reorder within the column works. Drag overlay is full-width.
10. **Desktop unchanged**: At >640px width, the layout reverts to the existing horizontal column view. All desktop functionality intact.

- [ ] **Step 3: Fix any visual issues found**

Address any spacing, overflow, or interaction issues.

- [ ] **Step 4: Commit any fixes**

```bash
git add -u
git commit -m "fix: polish mobile kanban layout and interactions"
```

# Mobile Kanban Optimization Design

**Date:** 2026-04-16
**Target:** iPhone SE (375x667) and similar small screens
**Breakpoint:** `max-width: 640px` (below existing `sm:` Tailwind breakpoint)
**Scope:** Kanban board view only (header, columns, cards). Timeline, auth, dialogs untouched.

## Problem

At 375px, the current Kanban board is unusable:
- Header has 7+ controls crammed into one row
- Columns are 288px wide — only ~1 fits, with awkward horizontal scroll
- Touch targets are too small
- No clear navigation between columns
- Primary actions (Ask AI, Add Card) aren't thumb-reachable

## Design Decisions

| Question | Decision |
|----------|----------|
| Column navigation | Single full-width column with swipe + tab strip |
| Header layout | One compressed row top + fixed bottom action bar |
| Tab strip placement | Below header, horizontally scrollable |
| Drag-and-drop | Within-column reorder only; cross-column via card actions menu |
| Scope | Kanban board only (first pass) |

## Layout Structure

Vertical layout (667px viewport):

| Zone | Height | Contents |
|------|--------|----------|
| Header | ~48px | Board name (truncated) + ViewToggle (icons) + overflow menu |
| Column tabs | ~40px | Scrollable tab strip: column names + card counts |
| Card list | ~530px (remaining) | Full-width scrollable list for active column |
| Bottom bar | ~52px | "Ask AI" + "Add Card" buttons, fixed |

## Section 1: Header Condensing

### Mobile top row
- **Left**: BoardSelector (board name truncated to ~200px max-width + chevron)
- **Right**: ViewToggle (icon-only, already handled) + overflow menu button

### Overflow menu contents (in order)
1. Search — opens inline search bar that slides down, replacing header row temporarily (X to close)
2. Filter — label + due date, existing popover content
3. Share
4. Add Column
5. Save as Template
6. Export to JSON
7. Change Background
8. Archive
9. Hidden Columns (if any)

### What moves off the header on mobile
- Ask AI button → bottom bar
- Search input → overflow menu expandable overlay
- Filter icon → overflow menu
- Share button → overflow menu

### Implementation
- Wrap existing header JSX in responsive conditionals: `hidden sm:flex` for desktop, `flex sm:hidden` for mobile
- Overflow menu reuses existing `DropdownMenu` — adds Search, Filter, Share items
- Search overlay: `absolute inset-x-0 top-0` div with search input + close button, toggled by state

## Section 2: Column Tab Strip

### Behavior
- Horizontal scrollable strip, one tab per visible column (respects `hiddenColumnIds`)
- Each tab: column title + card count badge (e.g. "To Do 5")
- Active tab: `text-[#78fcd6]` with 2px bottom border accent
- Tapping a tab switches the card list instantly
- Swiping left/right on card list area also switches columns (snap animation)
- Tab strip auto-scrolls to keep active tab visible

### Visual style
- Background: `bg-[#111515]/80 backdrop-blur-sm`
- Inactive tabs: `text-sm text-[#A8B2B2]`
- Active tab: `text-[#78fcd6]` with `border-b-2 border-[#78fcd6]`
- Compact padding (`px-3`), 2-3 tabs visible, rest scroll
- Single row, `overflow-x-auto`, hidden scrollbar

### State management
- New `activeColumnIndex` local state in KanbanBoard (not Zustand — UI-only)
- Swipe detection via vanilla touch event handlers on card list container
- No new dependencies

### Column ordering
- Matches existing `visibleColumns` order
- Column reorder on mobile: via overflow menu only (no drag-reorder of columns)

## Section 3: Bottom Action Bar

### Layout
- Fixed to bottom of the board container (not viewport — stays within board div, above app footer)
- Two buttons side by side, equal width, with gap
- Height: 52px including padding

### Buttons
- **Ask AI**: `bg-[#78fcd6]/10 border border-[#78fcd6]/30 text-[#78fcd6]`, Sparkles icon + "Ask AI"
- **Add Card**: `bg-white/5 border border-white/10 text-[#F2F7F7]`, Plus icon + "Add Card"
- Add Card adds to the currently active column

### Visibility
- Only renders at mobile breakpoint
- Per-column "Add Card" button hidden on mobile to avoid duplication

### Interaction
- Ask AI calls existing `onAIClick` prop
- Add Card opens existing `CardEditor` in create mode, scoped to active column

## Section 4: Card List & Cards

### Card list container
- Full-width, vertical scroll (`overflow-y-auto`)
- Padding: `p-3`
- Cards spaced with `space-y-2`
- Fills available space between tab strip and bottom bar

### Card adjustments on mobile
- Width: full-width (no fixed `w-72`/`w-80`)
- Cover image height: `h-16` (unchanged)
- Tap opens CardEditor, long-press initiates within-column drag reorder
- Card actions menu: unchanged
- "Move to..." in card actions menu is primary cross-column mechanism

### Swipe between columns
- Touch handlers on card list wrapper
- 50px horizontal delta threshold to trigger column switch
- Horizontal movement must exceed vertical within first 10px to disambiguate from scrolling
- Transition: `transform: translateX()` with 200ms ease

### Drag-and-drop adjustments
- `TouchSensor` constraint stays `{ delay: 200, tolerance: 5 }`
- Column swipe disabled during drag
- `DragOverlay` width: full-width on mobile

## Files to modify

| File | Changes |
|------|---------|
| `src/components/board/KanbanBoard.tsx` | Add mobile header, tab strip, bottom bar, swipe logic, `activeColumnIndex` state. Wrap desktop layout in `hidden sm:flex`. |
| `src/components/board/KanbanColumn.tsx` | Hide per-column "Add Card" on mobile. Adjust column width for mobile rendering. |
| `src/components/board/KanbanCard.tsx` | Remove fixed width constraints on mobile. |

## Out of scope
- Timeline view mobile optimization
- CardEditor / dialog mobile optimization (bottom sheets)
- Auth screens
- Column drag-reorder on mobile
- Swipe-to-move-card gesture (future enhancement)

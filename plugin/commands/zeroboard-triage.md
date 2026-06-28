---
description: Turn notes or ideas into ZeroBoard cards on a board.
argument-hint: "<board name> — <notes or tasks to triage>"
allowed-tools: mcp__zeroboard__list_boards, mcp__zeroboard__get_board, mcp__zeroboard__create_board, mcp__zeroboard__add_card, mcp__zeroboard__add_column
---

Turn the following into ZeroBoard cards: "$ARGUMENTS"

1. **Find the target board.** Call `list_boards` and match the board the user named. If they didn't name one, ask which board to use (or offer to create one with `create_board`).
2. **Inspect it.** Call `get_board` to see the columns. Choose a sensible destination column — default to "To Do" or the leftmost column.
3. **Extract discrete, actionable items** from the notes. For each, call `add_card` with a clear, imperative title and a short description. Group obviously-related items and do not create duplicates (you can `search` first if unsure).
4. **Report back.** List what you added (title + column) and ask whether anything should be moved, merged, or edited.

If you would create more than ~8 cards at once, confirm the board and the list with the user first.

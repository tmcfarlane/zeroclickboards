---
name: transcript-to-cards
description: Use when the user pastes a meeting transcript or notes and wants the action items turned into ZeroBoard cards. Extracts owners, tasks, and due dates and creates cards via the zeroboard MCP tools.
---

# Meeting transcript → ZeroBoard cards

When the user provides a meeting transcript or notes and wants the action items captured on a board:

1. **Read the transcript** and pull out concrete action items — things someone agreed to do. Ignore discussion that isn't actionable.
2. For each item, capture: a short **imperative title**, an optional **owner** (the person responsible), and any **due date** mentioned (resolve relative dates like "by Friday" to an ISO date).
3. **Pick the board.** Call `mcp__zeroboard__list_boards`. If the user named a board, match it; otherwise ask which board (or offer `mcp__zeroboard__create_board`). Call `mcp__zeroboard__get_board` to read the columns; default new items to "To Do".
4. **Create the cards.** For each action item call `mcp__zeroboard__add_card` with the title, a one-line description (include the owner), and `targetDate` when known. Use `mcp__zeroboard__set_target_date` or `mcp__zeroboard__add_label` for follow-up adjustments.
5. **Summarize.** List the cards created (title · owner · due) and ask whether to adjust owners, dates, or columns.

Guidelines:
- Don't invent tasks that weren't actually agreed to. If an item is ambiguous, ask rather than guess.
- De-duplicate against existing cards — `mcp__zeroboard__search` first if the board may already have related cards.
- Keep titles short and action-oriented ("Send Q3 report to finance", not "We should probably send the report at some point").

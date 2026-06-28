---
description: Give a standup-style summary of your ZeroBoard board(s).
argument-hint: "[board name (optional)]"
allowed-tools: mcp__zeroboard__list_boards, mcp__zeroboard__get_board, mcp__zeroboard__search
---

Give the user a concise standup summary of their ZeroBoard work.

Board filter (optional): "$ARGUMENTS"

1. Call `list_boards`. If a board name was provided above, pick the closest match; otherwise use the most recently updated board (or summarize the few boards there are).
2. For the chosen board, call `get_board` to read its columns and cards.
3. Produce a tight, scannable standup:
   - **In progress** — titles of cards in the "In Progress" column.
   - **Blocked** — cards in "Blocked" (and the reason, if the description says).
   - **Up next** — the top few "To Do" cards.
   - **Recently done** — cards in Resolved/Closed updated recently.
   - Flag any card whose `targetDate` is overdue or due soon.

Surface what matters for a standup — do not dump every card. If a column is empty, omit it.

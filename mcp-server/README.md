# @zeroclickdev/zeroboard-mcp

An [MCP](https://modelcontextprotocol.io) server for **ZeroBoard** — manage your boards, columns, and cards from any MCP‑compatible coding agent (Claude Code, Cursor, Zed, Windsurf).

> Status: **v1 core** (issue #9). Read/write tools + resources over stdio, authenticated with your ZeroBoard (Supabase) account. See [Roadmap](#roadmap) for what's next.

## Quick start

Requires Node.js 20 or newer, matching the Supabase client's minimum version. The server supplies its own WebSocket transport, so Node 20 works without a global WebSocket implementation. CI checks Node 20 and 22.

```bash
# Sign in once — opens your browser (Google or email); stores a refreshable
# session under ~/.zeroboard.
npx -y @zeroclickdev/zeroboard-mcp login

# Headless / no browser? Use password sign-in instead:
ZEROBOARD_EMAIL=you@example.com ZEROBOARD_PASSWORD=… npx -y @zeroclickdev/zeroboard-mcp login --password

# Check who you are
npx -y @zeroclickdev/zeroboard-mcp status
```

Then add the server to your agent (below). The default command (no subcommand) runs the MCP server over stdio.

## Client configuration

**Claude Code**
```bash
claude mcp add zeroboard -- npx -y @zeroclickdev/zeroboard-mcp
```

**Claude Desktop** — `claude_desktop_config.json` (Settings → Developer → Edit Config)
```json
{ "mcpServers": { "zeroboard": { "command": "npx", "args": ["-y", "@zeroclickdev/zeroboard-mcp"] } } }
```
Restart Claude Desktop after editing; the `zeroboard` tools appear under the tools (🔌) menu.

**Cursor** — `~/.cursor/mcp.json`
```json
{ "mcpServers": { "zeroboard": { "command": "npx", "args": ["-y", "@zeroclickdev/zeroboard-mcp"] } } }
```

**Zed** — `settings.json`
```json
{ "context_servers": { "zeroboard": { "command": { "path": "npx", "args": ["-y", "@zeroclickdev/zeroboard-mcp"] } } } }
```

**Windsurf** — `mcp_config.json`
```json
{ "mcpServers": { "zeroboard": { "command": "npx", "args": ["-y", "@zeroclickdev/zeroboard-mcp"] } } }
```

Add `"--read-only"` to `args` (or set `ZEROBOARD_READONLY=1`) to expose only the read tools.

## Tools

**Read:** `list_boards`, `get_board`, `list_columns`, `list_cards`, `get_card`, `search`

**Write:** `create_board`, `generate_board` (AI — create a board from a prompt), `update_board`, `delete_board`, `add_column`, `update_column`, `remove_column`, `reorder_columns`, `add_card`, `update_card`, `move_card`, `archive_card`, `restore_card`, `duplicate_card`, `delete_card`, `add_checklist_item`, `toggle_checklist_item`, `add_label`, `remove_label`, `set_target_date`, `set_cover_image`, `set_recurrence`

Destructive tools (`delete_board`, `delete_card`, `remove_column`) carry a `destructiveHint`; reads carry `readOnlyHint`, so clients can warn or auto-approve appropriately.

### Recurring cards

`add_card` accepts an optional `recurrence` object. Use `set_recurrence` to replace an existing card's complete schedule, or pass `null` to clear it. Changing recurrence preserves the target date, content, attachments, labels, and archive state. Clearing a schedule prevents future archives from making a recurring copy; previously created copies remain independent cards.

For example, call `set_recurrence` with:

```json
{
  "boardId": "your-board-id",
  "cardId": "your-card-id",
  "recurrence": { "frequency": "weekly", "interval": 2, "daysOfWeek": [1, 3] }
}
```

This repeats on Monday and Wednesday every two weeks. To stop repeating, use the same board/card IDs with `"recurrence": null`.

Rules use `frequency: "daily" | "weekly" | "monthly"` and an integer `interval` from 1 to 99. Weekly rules may include unique `daysOfWeek` integers from 0 (Sunday) to 6 (Saturday); stored days are sorted. Missing or empty weekdays follow the target date's weekday. Monthly rules may include an integer `dayOfMonth` from 1 to 31; omitting it follows the target date's day. Frequency-specific fields are rejected on other rule types, and invalid rules leave the board unchanged. The browser validates the same numeric limits and keeps invalid drafts open for correction.

Set a target date to anchor the schedule. An undated card uses the current date when archived. Setting a rule does not create cards; archiving an active recurring card creates its next copy.

## Resources

- `zeroboard://me` — the signed‑in account
- `zeroboard://boards` — index of your boards
- `zeroboard://board/{boardId}` — a full board (columns + cards) as JSON

## Auth & security

- Uses **Supabase Auth** with the public anon key only — **never** the service‑role key. Postgres **RLS** (`auth.uid() = user_id`) enforces that you only ever see/modify your own data.
- `login` opens the ZeroBoard web app's `/auth/cli` page, which signs you in with the app's normal Supabase auth (Google or email) and hands the session back to a short‑lived loopback listener on `127.0.0.1`, gated by a one‑time random `state`. No password is typed into the CLI. (`--password` / `ZEROBOARD_EMAIL`+`ZEROBOARD_PASSWORD` do a headless password grant instead.)
- The CLI validates the delivered session before accepting it, so a stale/expired session is rejected rather than stored.
- It stores `{ access_token, refresh_token }` in `~/.zeroboard/credentials.json` (mode `0600`). The long‑lived server auto‑refreshes the access token and rewrites the rotated refresh token. `logout` wipes it.
- Card titles/contents are returned verbatim to your agent. As with any data source, treat board text as **untrusted input** (possible prompt injection) — the server never executes it.

## Concurrency

Board columns/cards live in a single `boards.data` JSONB blob (the same source of truth the web app uses). MCP card and column mutations update only the exact `updated_at` revision they read. If another writer changes that revision first, the server reads the latest board and reapplies the operation, for up to three attempts. Persistent contention returns an error. Network and API errors are not automatically replayed because a write may already have committed. The existing `boards_set_updated_at` database trigger must be present, as provided by `supabase/schema.sql`.

The web app also saves against the exact database revision and merges its draft with incoming changes. Independent card fields, checklist items, attachments, additions, and card moves are reconciled. When both sides change the same value incompatibly, saving pauses for review; the user can keep their edits or use incoming edits for the conflicting fields while retaining unrelated changes. Both clients preserve unrelated fields in `boards.data`.

Concurrent changes to different recurrence frequencies are reviewed as complete schedules, so choosing an incoming weekly rule also retains its weekdays. Independent edits within the same frequency, such as its interval and weekdays, still merge.

Open card editors retain their opening snapshot, so an MCP update or move does not reset typed text. Save submits only changed form fields. Description and Body text are independent fields in the browser and MCP; editing or clearing one preserves the other. Converting legacy image content to text keeps the image as an attachment unless it is explicitly removed. Shared boards receive realtime updates and refresh on window focus.

Drafts and conflict decisions are kept in the current browser tab, not durable offline storage. Failed saves offer retry, and a draft whose board was deleted can be saved as a new private board. The browser warns before leaving with an open editor or unsaved board changes. These safeguards require the updated web client and MCP server; older clients can still make unguarded writes.

Column reordering requires every current column ID exactly once; invalid input leaves the board unchanged. Archiving an active recurring card creates the next occurrence in the same column and resets its checklist. Archiving it again does not create another copy.

Weekly schedules with selected weekdays use Monday–Sunday active weeks, matching the timeline. For example, every two weeks on Monday and Wednesday runs the remaining selected days in the active week, then skips a week. An explicitly assigned initial target date remains the first occurrence even if it is not a selected weekday. Monthly dates clamp to the destination month's last day and preserve the original day for future copies: January 31 → February 28/29 → March 31. The timeline and archived copies follow the same schedule, including distant timeline ranges.

`set_cover_image` keeps attachment cover flags consistent with the selected URL. Clearing the cover keeps the attachments, and later attachment edits do not automatically restore a cleared cover. When duplicate attachments share a cover URL, only the first is selected.

## Configuration

| Env var | Purpose |
| --- | --- |
| `ZEROBOARD_SUPABASE_URL` / `ZEROBOARD_SUPABASE_ANON_KEY` | Override the target project (defaults baked in at publish; fall back to `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) |
| `ZEROBOARD_EMAIL` / `ZEROBOARD_PASSWORD` | Non‑interactive `login --password` credentials |
| `ZEROBOARD_WEB_URL` | ZeroBoard web app base URL for browser login (default `https://board.zeroclickdev.ai`) |
| `ZEROBOARD_NO_BROWSER=1` | Don't auto‑open a browser during `login` (just print the URL) |
| `ZEROBOARD_READONLY=1` | Read‑only mode |

## Development

```bash
npm install
npm run build
npm test        # offline data-layer + MCP protocol regressions; no account needed
npm run smoke   # exercises the data layer against real Supabase (needs E2E_EMAIL/PASSWORD + VITE_SUPABASE_* in ../.env.local)
npm run smoke:mcp # opt-in live MCP protocol checks; supply those same variables in the process environment
```

`smoke:mcp` signs in as the dedicated E2E account without touching `~/.zeroboard`, creates a temporary test board, forces a concurrent-write conflict, exercises recurring archives and resource reads, and deletes the board in cleanup. Run it only with a configured test account. Offline regression tests run in CI. The repository’s authenticated Playwright suite also forces browser/MCP writes to overlap against a dedicated test account and checks merged edits and explicit conflict resolution after reload. Build this MCP package before running those browser tests.

## Roadmap

- ✅ Browser login via the hosted `/auth/cli` route (Google + email) — done; a future hardening is a full server-side PKCE code exchange (the current flow binds the loopback delivery with a one‑time `state` and validates the session before storing).
- ✅ `generate_board` tool backed by the existing `/api/ai/board-template` endpoint — done.
- ✅ Conditional card/column writes with bounded conflict retries in the MCP server — done. The web app also reconciles drafts and reviews conflicting edits.
- A dedicated `/api/v1` layer for scoped/read‑only tokens and audit logging.
- Realtime: a `list_changes(since)` poll tool and (where clients support it) resource‑update notifications.
- ✅ A Claude Code **plugin** that bundles this server plus slash commands — done.

## License

MIT

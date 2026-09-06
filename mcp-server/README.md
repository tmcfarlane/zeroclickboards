# @zeroclickdev/zeroboard-mcp

An [MCP](https://modelcontextprotocol.io) server for **ZeroBoard** — manage your boards, columns, and cards from any MCP‑compatible coding agent (Claude Code, Cursor, Zed, Windsurf).

> Status: **v1 core** (issue #9). Read/write tools + resources over stdio, authenticated with your ZeroBoard (Supabase) account. See [Roadmap](#roadmap) for what's next.

## Quick start

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

**Write:** `create_board`, `generate_board` (AI — create a board from a prompt), `update_board`, `delete_board`, `add_column`, `update_column`, `remove_column`, `reorder_columns`, `add_card`, `update_card`, `move_card`, `archive_card`, `restore_card`, `duplicate_card`, `delete_card`, `add_checklist_item`, `toggle_checklist_item`, `add_label`, `remove_label`, `set_target_date`, `set_cover_image`

Destructive tools (`delete_board`, `delete_card`, `remove_column`) carry a `destructiveHint`; reads carry `readOnlyHint`, so clients can warn or auto-approve appropriately.

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

These guards protect **writes made by this MCP server**. The web app still saves its board snapshot on a debounce without a revision check, so a later stale web save can overwrite an MCP edit. Full two-way conflict handling remains future work. MCP mutations preserve unrelated fields in `boards.data`.

Column reordering requires every current column ID exactly once; invalid input leaves the board unchanged. Archiving an active recurring card creates the next occurrence in the same column and resets its checklist. Archiving it again does not create another copy. Monthly dates clamp to the destination month's last day, including February in leap years.

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

`smoke:mcp` signs in as the dedicated E2E account without touching `~/.zeroboard`, creates a temporary test board, forces a concurrent-write conflict, exercises recurring archives and resource reads, and deletes the board in cleanup. Run it only with a configured test account. Offline regression tests run in CI.

## Roadmap

- ✅ Browser login via the hosted `/auth/cli` route (Google + email) — done; a future hardening is a full server-side PKCE code exchange (the current flow binds the loopback delivery with a one‑time `state` and validates the session before storing).
- ✅ `generate_board` tool backed by the existing `/api/ai/board-template` endpoint — done.
- ✅ Conditional card/column writes with bounded conflict retries in the MCP server — done. Web-side conflict handling is still needed.
- A dedicated `/api/v1` layer for scoped/read‑only tokens and audit logging.
- Realtime: a `list_changes(since)` poll tool and (where clients support it) resource‑update notifications.
- ✅ A Claude Code **plugin** that bundles this server plus slash commands — done.

## License

MIT

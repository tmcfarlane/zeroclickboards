# @zeroclickdev/zeroboard-mcp

An [MCP](https://modelcontextprotocol.io) server for **ZeroBoard** — manage your boards, columns, and cards from any MCP‑compatible coding agent (Claude Code, Cursor, Zed, Windsurf).

> Status: **v1 core** (issue #9). Read/write tools + resources over stdio, authenticated with your ZeroBoard (Supabase) account. See [Roadmap](#roadmap) for what's next.

## Quick start

```bash
# Sign in once (stores a refreshable session under ~/.zeroboard)
npx -y @zeroclickdev/zeroboard-mcp login

# Check who you are
npx -y @zeroclickdev/zeroboard-mcp status
```

Then add the server to your agent (below). The default command (no subcommand) runs the MCP server over stdio.

## Client configuration

**Claude Code**
```bash
claude mcp add zeroboard -- npx -y @zeroclickdev/zeroboard-mcp
```

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

**Write:** `create_board`, `update_board`, `delete_board`, `add_column`, `update_column`, `remove_column`, `reorder_columns`, `add_card`, `update_card`, `move_card`, `archive_card`, `restore_card`, `duplicate_card`, `delete_card`, `add_checklist_item`, `toggle_checklist_item`, `add_label`, `remove_label`, `set_target_date`, `set_cover_image`

Destructive tools (`delete_board`, `delete_card`, `remove_column`) carry a `destructiveHint`; reads carry `readOnlyHint`, so clients can warn or auto-approve appropriately.

## Resources

- `zeroboard://me` — the signed‑in account
- `zeroboard://boards` — index of your boards
- `zeroboard://board/{boardId}` — a full board (columns + cards) as JSON

## Auth & security

- Uses **Supabase Auth** with the public anon key only — **never** the service‑role key. Postgres **RLS** (`auth.uid() = user_id`) enforces that you only ever see/modify your own data.
- `login` stores `{ access_token, refresh_token }` in `~/.zeroboard/credentials.json` (mode `0600`). The long‑lived server auto‑refreshes the access token and rewrites the rotated refresh token. `logout` wipes it.
- Card titles/contents are returned verbatim to your agent. As with any data source, treat board text as **untrusted input** (possible prompt injection) — the server never executes it.

## Concurrency

Board columns/cards live in a single `boards.data` JSONB blob (the same source of truth the web app uses). Writes are read‑modify‑write and **last‑write‑wins** — a simultaneous edit in the web UI (which syncs on a debounce) and via MCP can clobber each other. The server always reads the freshest row immediately before writing to keep the window small. Scoped tokens and conditional updates are planned for v2.

## Configuration

| Env var | Purpose |
| --- | --- |
| `ZEROBOARD_SUPABASE_URL` / `ZEROBOARD_SUPABASE_ANON_KEY` | Override the target project (defaults baked in at publish; fall back to `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`) |
| `ZEROBOARD_EMAIL` / `ZEROBOARD_PASSWORD` | Non‑interactive `login` credentials |
| `ZEROBOARD_READONLY=1` | Read‑only mode |

## Development

```bash
npm install
npm run build
npm run smoke   # exercises the data layer against real Supabase (needs E2E_EMAIL/PASSWORD + VITE_SUPABASE_* in ../.env.local)
```

## Roadmap

- Browser **PKCE login** via a hosted `/auth/cli` route (Google OAuth + email), replacing password‑grant `login`.
- `generate_board` tool backed by the existing `/api/ai/board-template` endpoint.
- A dedicated `/api/v1` layer for scoped/read‑only tokens, audit logging, and conditional updates.
- Realtime: a `list_changes(since)` poll tool and (where clients support it) resource‑update notifications.
- A Claude Code **plugin** that bundles this server plus slash commands and a transcript‑to‑cards skill.

## License

MIT

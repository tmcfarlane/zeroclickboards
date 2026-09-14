# ZeroBoard — Claude Code plugin

Manage your [ZeroBoard](https://board.zeroclickdev.ai) kanban boards, columns, and cards without leaving Claude Code. This plugin bundles the **ZeroBoard MCP server** ([`@zeroclickdev/zeroboard-mcp`](../mcp-server)) plus slash commands and a skill.

## Install

```text
/plugin marketplace add tmcfarlane/zeroclickboards
/plugin install zeroboard@zeroclickdev
```

Then sign in once (opens nothing — stores a refreshable session under `~/.zeroboard`):

```bash
npx -y @zeroclickdev/zeroboard-mcp login
```

> The plugin launches the server via `npx -y @zeroclickdev/zeroboard-mcp`, so it picks up that login automatically. Run `… status` to confirm, `… logout` to clear it.

## What you get

**MCP server** — tools for boards, cards, checklists, labels, dates, covers, and recurring schedules, plus search and resources (`zeroboard://boards`, `zeroboard://board/{id}`). Configure a schedule with `add_card` or replace/clear it with `set_recurrence`. All operations follow your account's Supabase RLS permissions. See the [server README](../mcp-server/README.md) for the full tool list and recurrence examples.

**Commands**
- `/zeroboard:zeroboard-standup [board]` — a standup-style summary of what's in progress, blocked, and up next.
- `/zeroboard:zeroboard-triage <board> — <notes>` — turn notes/ideas into cards.

**Skill**
- `transcript-to-cards` — paste a meeting transcript and have the action items captured as cards (owners + due dates).

## Local development

To test against a local server build instead of the published package, point the plugin's MCP command at the built file — temporarily set `mcpServers.zeroboard` in `.claude-plugin/plugin.json` to:

```json
{ "command": "node", "args": ["/absolute/path/to/zeroclickboards/mcp-server/dist/index.js"] }
```

(Build it first with `cd mcp-server && npm install && npm run build`, and `node dist/index.js login`.)

## License

MIT

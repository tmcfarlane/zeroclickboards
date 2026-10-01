# ZeroBoard local plugin

Portable Agent Plugins package; stdio is for local Codex, not public ChatGPT web distribution. Build and install the reviewed MCP from this checkout (the currently published 0.1.0 does not implement `--plugin`):

```sh
cd mcp-server
npm ci
npm run build
npm link
```

Do not change or log out of an existing ZeroBoard connection. A previously authenticated `zeroboard-mcp` uses its existing credential store. Authenticate through `zeroboard-mcp login` only when needed.

Set `ZEROBOARD_BOARD_IDS` to a comma-separated list of explicitly selected board IDs in the local MCP process environment; an absent/empty list grants no boards. `ZEROBOARD_READONLY=1` disables commit. Configure the host to prompt for `commit_cards` approval. Load this folder as a local plugin source following the current Codex plugin documentation. No user-wide marketplace is changed by this repository.

For a portable bundle that does not require npm link, run `node scripts/package-plugin.mjs` from the repository root. It includes the reviewed compiled server and locked runtime dependencies. No credentials or environment files are bundled. Node >=20 is required.

Only six read tools plus preview_cards/commit_cards are exposed. Every read/resource is checked against the selected boards and current account membership. Commit creates a batch of cards with dates; it does not edit existing cards. Role checks complement the proposed RLS migration, which still needs database review and testing before production.

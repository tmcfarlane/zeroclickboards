# ZeroBoard local plugin

Portable Agent Plugins package; stdio is for local Codex, not public ChatGPT web distribution. Build the reviewed MCP from this checkout (the currently published 0.1.0 silently ignores `--plugin`):

```sh
cd mcp-server
npm ci
npm run build
```

The plugin launcher uses the bundled runtime or this checkout's adjacent `mcp-server`; it never runs a globally installed `zeroboard-mcp`. A missing/stale build or incompatible version fails before sign-in. For a portable install, run `node scripts/package-plugin.mjs` from the repository root after building, then load `dist/zeroboard-plugin` as a local plugin source. The bundle contains the reviewed runtime and locked dependencies, with no credentials or environment files. Node >=20 is required. Loading the raw `codex-plugin` folder after a host copies it away from the checkout requires this portable bundle.

Do not change or log out of an existing ZeroBoard connection. The reviewed runtime reuses its existing credential store. Authenticate with `node mcp-server/dist/index.js login` from the repository root only when needed.

Set `ZEROBOARD_BOARD_IDS` to a comma-separated list of explicitly selected board IDs in the local MCP process environment; an absent/empty list grants no boards. `ZEROBOARD_READONLY=1` disables commit. Configure the host to prompt for `commit_cards` approval. Load this folder as a local plugin source following the current Codex plugin documentation. No user-wide marketplace is changed by this repository.

Only six read tools plus preview_cards/commit_cards are exposed. Every read/resource is checked against the selected boards and current account membership. Commit creates a batch of cards with dates; it does not edit existing cards. Role checks complement the editor RLS migration; apply and verify the migration when provisioning another deployment.

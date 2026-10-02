# Hosted ChatGPT connection

ZeroBoard now includes the account connection settings, `/auth/connector` consent page, and a Vercel Node adapter at `api/connector.ts`. The adapter serves the authenticated settings/consent API and the canonical OAuth/MCP routes through `vercel.json` rewrites. It uses the same stateless `http.ts` and `oauth.ts` core as the tested local connector. An account sees an honest unavailable state until the private schema, dedicated SQL login, server secrets and predefined OAuth client configuration are ready. Merging the code does not provision those resources or publish a directory listing.

## Server configuration

Set these only in Vercel server configuration. Never prefix private values with `VITE_`, put them in `mcp.json`, or include them in browser responses.

| Variable | Required value |
| --- | --- |
| `ZEROBOARD_CONNECTOR_ENABLED` | `true` after staging verification; omission keeps the UI unavailable. |
| `ZEROBOARD_CONNECTOR_ISSUER` | Canonical HTTPS origin, such as `https://board.zeroclickdev.ai`, without query/path. |
| `ZEROBOARD_CONNECTOR_DATABASE_URL` | TLS Postgres connection for a dedicated connector login inheriting `zeroboard_connector`. Use the Supabase pooler appropriate to the deployment; prepared statements are disabled. |
| `ZEROBOARD_CONNECTOR_VAULT_KEY` | Stable, randomly generated 32-byte AES key encoded as canonical base64. Rotation invalidates existing encrypted sessions. |
| `ZEROBOARD_CONNECTOR_PROPOSAL_KEY` | Stable random server secret of at least 32 bytes; rotation invalidates outstanding card previews. |
| `ZEROBOARD_CONNECTOR_CLIENTS` | JSON array of predefined public clients: `client_id`, `client_name`, `redirect_uris`, and `token_endpoint_auth_method: "none"`. HTTPS callbacks match exactly. A separate native Codex client may register literal `http://127.0.0.1/callback`; only its listener port may vary. No default client is provisioned. |
| `ZEROBOARD_CONNECTOR_DATABASE_CA` | Optional single PEM CA certificate for a database/pooler certificate chain not in the Node trust store. Obtain the project's authoritative CA from the provider dashboard and store the actual PEM with newlines. Malformed and non-CA certificates are rejected. TLS always verifies the chain and database hostname. |
| `ZEROBOARD_CONNECTOR_ALLOWED_ORIGINS` | Optional JSON array of exact HTTPS browser origins that may call the OAuth/MCP resource. The issuer origin is always allowed. |
| `SUPABASE_URL` | HTTPS Supabase project URL. Existing `VITE_SUPABASE_URL` is a fallback. |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key. Existing `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` are compatible fallbacks. Secret/service-role keys are rejected. |

Postgres TLS requires certificate verification (`rejectUnauthorized: true`). Use a host with a certificate chain trusted by Node. If the project uses a private CA, provision the CA through the deployment's trusted Node certificate configuration; do not disable verification. Configure canonical domains and route rewrites before enabling the connector. A preview deployment must use its own canonical origin/client setup or retain the disabled state; production consent actions accept the production origin only.

The SQL executor reserves one pool connection for each statement and releases it in `finally`, including after SQL errors. The pool still permits two independent active connections, with prepared statements disabled. This prevents unfinished statements from being pipelined on the same socket: [Supabase documents that postgres.js pipelining can hang queries or return mismatched rows through its shared transaction pooler](https://supabase.com/docs/guides/database/postgres-js). Changing Simple to Extended Query protocol alone did not resolve the observed pooler failure. The fix does not cache readiness, retry OAuth writes, or skip privilege checks. Real-driver regressions measure frontend statement starts and backend `ReadyForQuery` packets, run the full readiness check with mixed parameterized statements at pool sizes one and two, and verify recovery after a SQL error. Restricted remote catalog smoke checks separately confirmed ten serial and five parallel health calls with per-statement reservation at each pool size, one and two; those catalog checks do not establish a complete client authorization or deployment flow.

## Private storage and privileges

Review and apply the editor-enforcement, OAuth-records and connector-vault migrations to a disposable/staging Supabase database first. The new migration creates a `zeroboard_oauth.sessions` table with RLS and no browser grants, plus a passwordless `zeroboard_connector` privilege role. It grants that role access only to the private OAuth/session tables and creates the backend-only RLS policies. Keep `zeroboard_oauth` outside the exposed Data API schemas.

Provision a dedicated login using the deployment secret manager and grant it the privilege role. The following is an administrator provisioning template; replace the login name and password securely outside version control:

```sql
create role zeroboard_connector_login login nosuperuser nobypassrls nocreaterole nocreatedb noreplication
  password '<generated-server-only-password>';
grant zeroboard_connector to zeroboard_connector_login;
```

The login may inherit only `zeroboard_connector`, without ADMIN permission. Neither role may have elevated role attributes, database/schema creation, application/private object ownership or grants that let it delegate private access. Do not grant browser/service roles, application/auth table or column access, or execution of the six restricted application helpers. SQL storage has no board-table authorization role: board operations use a fresh publishable-key client with the authenticated user's access JWT.

Availability checks retain the required private CRUD permissions, RLS policies and schema checks, and reject the extra privileges above, including direct, PUBLIC and inherited grants. Ownership through either permitted role is rejected because owners can bypass ordinary RLS. Function checks cover the application's restricted invite/auth/membership helpers; unrelated shared-project functions do not become deployment dependencies. This readiness guard covers the reviewed app boundary; continue inspecting deployed privileges and policies when adding application tables or functions. Missing configuration/schema/permissions or excessive privileges produce `available: false`, with no usable endpoint advertised.

The pg_cron extension grants some table permissions to PUBLIC. Keep those shared extension grants intact and deny the runtime login cron schema USAGE. Readiness accepts inaccessible cron table ACLs, but rejects cron namespace access through any grant, including PUBLIC, because that makes the extension permissions usable. The administrator owns the cleanup job; the runtime neither schedules jobs nor reads their records.

Schedule removal of expired rows from `zeroboard_oauth.records` and `zeroboard_oauth.sessions`. Expired records cannot authorize requests even before cleanup. The records table stores hashed pending/code/token keys and opaque grants. Account JWTs are confined to AES-256-GCM ciphertext in the separate vault, with random nonces and the account reference authenticated as associated data. No credential is placed in the settings list, consent response, tool output or OAuth records. Validate deployed policies with Supabase advisors; the PR executes the private migrations/role denials in isolated PostgreSQL tests but does not apply them to production or establish deployed RLS.

## Session and consent policy

The hosted connection lasts at most **15 minutes**, capped by the current Supabase access token's expiry. It deliberately neither accepts, stores nor rotates the browser's refresh token. This preserves the browser's session refresh ownership. Reconnect by approving the connection again using the current signed-in browser session. An independent long-lived account session would require a separate authentication design; this implementation does not promise it.

The OAuth flow uses Authorization Code plus S256 PKCE, predefined public clients, resource binding, one-time durable pending requests/codes, and opaque short-lived tokens. HTTPS callbacks match exactly. Native HTTP callbacks must use literal `127.0.0.1`, with exactly the registered path/query; their listener port alone may vary. Dynamic client registration and client-ID metadata documents are not advertised or fetched. Removing a callback or changing its path/query or resource invalidates outstanding requests/codes before approval or exchange. Token exchange must match the actual redirect URI saved at authorization, including its active native port. Metadata advertises authorization-code grants only; OAuth refresh grants are disabled.

Authorization metadata advertises RFC 9207 issuer identification. Approval, cancellation, and SDK protocol-error callbacks include `iss` matching the discovery document's exact issuer, with state preserved. This permits eligible OpenAI clients to use their documented stable callback instead of a callback-ID-specific URL; still copy the exact callback from client setup into the predefined allowlist. Do not advertise issuer identification without returning it on success and error callbacks.

### Native Codex client setup

The native desktop app/CLI direct-MCP flow uses a local HTTP listener rather than ChatGPT's HTTPS management callback. Add a separate public native client to the configured array; keep the ChatGPT client and its exact HTTPS callback separate. For example, an operator may choose this public ID (it is not an OpenAI-assigned identifier):

```json
{
  "client_id": "zeroboard-codex-native",
  "client_name": "Codex native",
  "redirect_uris": ["http://127.0.0.1/callback"],
  "token_endpoint_auth_method": "none"
}
```

After the hosted runtime is configured and available, use that same public ID in Codex:

```sh
codex mcp add zeroboard \
  --url https://board.zeroclickdev.ai/mcp \
  --oauth-client-id zeroboard-codex-native \
  --oauth-resource https://board.zeroclickdev.ai/mcp
```

Register the exact callback displayed by `codex mcp add`. With issuer identification, new predefined clients can save the stable `/callback` path. Older entries without a saved callback may use a server-specific path; register that exact path or explicitly save the documented native callback in `mcp_servers.<name>.oauth.callback_url`. Do not allow wildcard paths. The app and CLI share MCP configuration on the same host. Plugin HTTP manifests use `oauth.clientId` and `oauth.callbackUrl` for the corresponding values; the existing local stdio bundle remains a separate setup.

Codex inserts the active listener port into `http://127.0.0.1/callback` during authorization. Leave the registered URL without a port for normal local setup. A fixed callback port requires matching listener configuration (`oauth.callback_port`); a port in the URL alone does not configure the listener. The narrow native policy rejects `localhost`, IPv6, decimal/hex/octal aliases, unrelated HTTP hosts, credentials, fragments and path normalization. The shared browser/server validator and authorization preflight enforce this before the SDK can redirect protocol errors. HTTPS port differences still fail, including HTTPS loopback URLs.

These callback/configuration behaviors were checked against the [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) on October 2, 2026. Installed CLI help confirmed the public-client/resource flags; native account linking still requires a separately provisioned deployment and disposable-account smoke verification.

The account setup API exposes each public ID with `callbackKinds`, derived from registered URIs rather than client names. Guided native setup requires the default literal `127.0.0.1` `/callback` path with no query. Guided ChatGPT setup requires its documented stable HTTPS callback. Other valid callbacks, including legacy callback-ID paths, retain their OAuth policy but need operator-specific setup; a new connection may choose a different callback. The UI shows required IDs openly and supplies a quoted Codex command with `--oauth-client-id` and `--oauth-resource`; URL-only automatic registration cannot work because this deployment has no DCR/CIMD. Native-only configuration does not advertise ChatGPT web setup. ChatGPT's client must accept a predefined public ID with no secret; do not select automatic registration or invent a client secret.

The settings list is labeled Approved access: grants are persisted at approval, before code exchange. A row proves permission was granted, not that a client successfully exchanged its code or called a tool. Users should return to the client and perform a board read to confirm setup; uncompleted grants remain revocable until expiry. The local stdio plugin is separate: its Node launcher accepts only the bundled or adjacent reviewed 0.2.0 runtime, checks for the dedicated scoped entry point, and never falls back to a global npm 0.1.0 executable.

The consent page authenticates through the existing Supabase account and shows the requesting client, exact scopes and available owned/member boards. Public/embed visibility alone never makes a board eligible. Viewers can select read access; `cards:add` requires owner/editor access for every selected board. Approval/revocation require the user's bearer token and the exact app Origin. The backend derives account identity from validated `getUser`, never a submitted user ID. It checks board authorization again before the atomic pending take. An unsuccessful approval removes its provisional vault entry. Cancel consumes the pending request and returns the stored, still-registered callback with `error=access_denied` and the original state; the page can offer a Return to client link. No code/token is issued on cancel.

Account settings list only the authenticated user's active grants, selected board IDs, scopes, client names and expiry. Revocation marks the grant revoked and removes its encrypted account session. OAuth `/revoke` also revokes the whole grant for a token held by its registered client. Each MCP request revalidates grant/token/resource and calls `getUser` on the vaulted JWT. Supabase access JWT lifetime remains a limit on immediate session revocation semantics; deleting a user/session does not automatically invalidate every already-issued JWT before expiry.

## API and hosting routes

- `GET /api/connector`: authenticated availability, canonical endpoint, public configured client IDs, and the user's connection list.
- `GET /api/connector?action=consent&request=<opaque>`: authenticated requesting client/scopes, eligible board names/edit permissions and pending expiry.
- `POST /api/connector`: strict JSON actions `approve` (request + board IDs), `cancel` (request), or `revoke` (connection ID); same-origin bearer authentication required.
- `/authorize`, `/token`, `/revoke`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/mcp`: rewritten into the same Node adapter; it preserves OAuth parameters and supports Vercel's pre-parsed JSON/form bodies.

MCP HTTP is stateless and creates a new server, transport and RLS client for every request. The canonical Host and configured Origin allowlist are enforced. Missing/expired connector tokens receive HTTP 401 with resource discovery metadata. The plugin exposes six read tools plus preview/commit; destructive/existing-card edits, board creation and billed `generate_board` remain absent. Meeting commit requires an unmodified signed preview, unchanged board revision, current edit access and explicit host approval. `approved=true` alone is not proof of human approval. Stable card IDs prevent duplicate batches while previews remain valid, and ambiguous writes are not automatically replayed.

Authenticated MCP requests use `POST` with the exact `application/json` media type. Other methods return HTTP 405 with `Allow: POST, OPTIONS`; preflight remains available and unauthenticated GET/POST retain the Bearer challenge. Every parsed MCP JSON payload is limited to 1 MiB of serialized UTF-8, including bodies supplied by a hosting adapter. Malformed lazy JSON getters return a safe JSON-RPC parse error. Raw requests additionally retain Express's original byte limit and gzip/deflate/brotli inflation handling. OAuth form endpoints are separate from this guard.

The current [Vercel Node helper](https://github.com/vercel/vercel/blob/main/packages/node/src/serverless-functions/helpers.ts) restores its consumed bytes behind `req.read()`. For completed pre-parsed requests, the guard makes at most one bounded read of 1 MiB plus one byte, or checks a server-supplied raw Buffer when present; declared identity Content-Length also supplements the logical limit. A genuinely consumed-only adapter cannot recover whitespace or Unicode escape bytes, so its serialized-payload limit does not promise original-byte parity. Vercel's [documented parsed-body helper](https://vercel.com/docs/functions/runtimes/node-js#request-body) does not guarantee a `rawBody` property. Pre-parsed requests with nonidentity Content-Encoding receive HTTP 415 because the adapter does not establish whether its object or bytes have been inflated; raw compressed requests retain their existing behavior. No projectwide helper setting changes are required.

## Verification and remaining deployment work

The PR's backend tests run actual private-schema migrations and role policies in isolated PostgreSQL. They verify ciphertext/expiry/tampering, browser-role denials, readiness privilege failures, authenticated board eligibility, foreign/viewer write denials, cross-site requests, callback/resource revalidation across configuration changes, S256/replay behavior, raw and pre-parsed Vercel request bodies, `/mcp` discovery/initialize/tool reads, selected-board isolation and revocation. Native regressions cover two listener ports, exact token-exchange redirects, protocol-error callbacks, and adversarial URL shapes rejected without redirects. Existing MCP tests separately verify editor RLS and approved card-batch behavior. Consent UI tests cover native approval/denial and unsafe return-address rejection without touching real boards or production credentials.

Before enabling a real deployment: provision the private login/secrets and exact client configuration; inspect deployed board UPDATE policies; apply migrations to staging; run Supabase advisors; validate the connector with MCP Inspector and an installed ChatGPT/Codex client against disposable boards; then enable the production configuration. Add appropriate edge request limits and OpenAI client validation for public distribution. Publishing identity/domain, privacy/terms, listing assets, review cases, release notes and reviewer accounts remain directory requirements. No directory submission, production migration, account identity linking or AI billing change occurs in this PR.

References checked October 1, 2026: [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins), [OpenAI connector auth](https://developers.openai.com/plugins/build/auth), [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security). The SDK 1.29 bridge emits top-level tool `securitySchemes` as required by OpenAI clients. Sign in with ChatGPT remains a separate identity/provider phase; installation does not move ZeroBoard inference costs onto a ChatGPT plan.

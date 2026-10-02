# Hosted MCP lifecycle ordering audit

Read-only source review of `work/zeroboard-ai-ci`, branch `codex/gauntlet-ai-drafts`, HEAD `b840af42b6ed2064a274ecd25b06d9ee285d0f05`. The reviewed backend product files have no diff from PR 38 head `0d9b88f193f87e77b8e10d9aebae28f663c880cd`. Working status contained only the previously authorized `node_modules` symlink. No tests, builds, browsers, network requests, credentials, or services were used for this audit. The sequences below are source-derived, unexecuted reproductions.

No release blocker is established for a fresh request started after completed revocation or membership downgrade. Two bounded, untested ordering boundaries merit deterministic gates before deciding whether to change the existing in-flight contract.

## Actual authorization and mutation boundaries

`http.ts:72–94` calls `accountForToken` for every MCP HTTP request, then creates a fresh RLS client-bound server and stateless transport. A client’s subsequent tool request is independently authorized; initialization does not retain a server-side grant session. Missing/revoked/expired credentials fail before server construction. Removing the vault row also makes a later account resolution fail.

`oauth.ts:142–159` reads token and grant, checks expiry/revocation/issuer/resource/configured client/scopes, rereads the grant and checks revocation, then awaits account resolution. Hosted resolution (`connector-runtime.ts:36–46`) loads an unexpired encrypted vault row and calls actual SDK `getUser` using its access JWT. It returns the session expiry. There is no final expiry/grant reread after that awaited resolution.

The tool service does **not** reload the OAuth grant at tool dispatch or at a database write. It uses the selected boards and read/write scope captured when this HTTP request’s server was constructed. It **does** check current board access during each operation: `getRow` reads the row then verifies owner/explicit membership; `mutateColumns` checks owner/editor again before constructing the write (`board-data.ts:144–148,164–182`). The final PostgREST UPDATE uses the user JWT, board ID and exact `updated_at` equality. Its RLS policy requires owner/editor on the UPDATE statement; the database timestamp trigger advances the revision. A membership downgrade committed before that SQL statement starts is therefore independent of the earlier application role read. No grant predicate is part of this board UPDATE, and there is no membership row lock spanning the remote reads and write. A downgrade occurring after an UPDATE statement has started is an ordinary database snapshot/in-flight boundary, not proof of a viewer starting a new authorized write.

`meeting.ts:40–46` checks preview signature/schema/expiry once before awaited board operations. `addPreviewCards` verifies board revision, applies the whole batch in one conditional JSONB UPDATE and uses stable IDs for replay. Existing IDs produce a no-write result; partial existing IDs fail. The signature is bound to user and sorted selected board IDs (`meeting.ts:14–15`), not grant ID. A new valid connection for that same account/board set may reuse an unexpired old preview, but must have current write scope/access and a new host approval. This is not use of the revoked connection and is not an identified blocker.

## Source-founded ordering gaps

### A. Account resolution may finish after revocation or connector expiry

1. Request A arrives while its token/grant are valid. Both grant reads return `revoked:false`.
2. A loads its vault row, then is held in `/auth/v1/user`.
3. Request B persists `revoked:true`; settings revocation also deletes the vault row and can return success.
4. A’s already-issued getUser call returns a matching user. `accountForToken` returns its earlier grant without checking the new state. The HTTP adapter now constructs the server and can dispatch the requested tool; no board operation has yet been dispatched at the time B finished.

The same held phase can cross the connector/vault expiry while the underlying JWT remains valid longer: `resolveAccount` returns the earlier `expires` value, but `accountForToken` does not inspect it. RLS validates that JWT and board permissions, not the private connector grant.

This is a request **started before** revocation/expiry. New request C started after B’s persisted revocation reads the revoked grant and is denied. No code path writes that grant back to `revoked:false`. A token exchange racing revocation may return a newly stored opaque token, but its next request still rereads the revoked grant and fails; token issuance does not restore authority.

The missing gate is whether A is allowed to begin tool work after its account-resolution phase finishes under invalidated connector authority. A minimal prospective repair would revalidate current token/grant and returned account expiry after the awaited resolution, before server construction. This would close the described held phase, not guarantee cancellation of a tool/SQL write already dispatched or make revocation linearizable with all remote board writes. That stronger contract would require separate design and is not recommended by this audit.

### B. Expiry is checked before single-use consumption, not by the consumption statement

`SqlOAuthStore.get` selects solely by kind/key. `take` is the atomic `DELETE ... WHERE kind=$1 AND key=$2 RETURNING value` (`oauth-store.ts:7–18`), with **no** expiry predicate. The records table has no expiry RLS condition/trigger; five-minute cron cleanup is separate. The executor reserves/releases a connection per statement, not for an OAuth transaction.

Concrete pending sequence: start approval while pending is valid; hold a board-access read after `oauth.ts:95`; cross pending expiry while the account stays valid; release the read before cleanup deletes the row. The unconditional take at line 108 succeeds and lines 110–114 create a fresh valid grant/code. This is the same consent POST begun before expiry, not acceptance of a POST whose initial validation already found an expired request.

Code exchange has the equivalent gap between `code()`’s expiry check and its unconditional take, including waiting for a pool lease/DELETE to execute. A still-active grant can produce a token after that code’s deadline. Cancellation can likewise consume an expired pending request after its earlier check, but issues no authority. Preview expiry is also checked before the asynchronous board read/write; its completion-time meaning is an existing in-flight contract, not an independent new authorization bypass.

A smallest prospective scope is an expiry condition on single-use SQL consumption, plus validation of the returned record/current clock before issuing authority if expiry must hold at settlement. Root should first define whether expiry must hold when a consume statement begins or when the response is emitted. SQL `now()` alone should not be described as a wall-clock guarantee across all statement/lock waits. No multi-statement transaction or cross-system lock currently exists, and this report does not propose one.

## Existing proof and its limits

- `oauth-http.test.mjs:97–115`: PKCE/callback/resource checks, serial code replay, a token manually set to expired, and a request after completed OAuth revocation. The pending “expired” assertion at line 100 follows an already-completed approval, so it is consumed-pending coverage, not time-crossing coverage.
- `oauth-store.test.mjs:7–23`: real PGlite migrations, concurrent atomic code takes (one winner), API-role denial; later test verifies inferred TEXT payload parameter and object roundtrip. Native HTTP `TestStore.take` awaits an ordinary get then deletes, so it is not an atomic-concurrency oracle. Use the real SQL store for pending/code concurrency gates.
- `connector.test.ts:255–298`: actual private migrations/vault, raw/preparsed adapter consent/exchange, runtime restart, selected-board reads and serial authenticated revoke followed by denied account resolution. Its PostgREST fixture provides static membership and GETs, not a held write with live SQL board RLS.
- `plugin.test.mjs:23–87`: exact preview approval, sequential idempotent replay, stale/tampered previews, account binding and static viewer-role rejection; it does not downgrade an editor between an earlier membership read and UPDATE dispatch.
- `board-data.test.mjs:58–185`: overlapping additions/revision conflicts, explicit RLS error with no retry, silent zero-row RLS rejection without a second write, and an ambiguous transport error after committed data with no automatic replay. These establish bounded write/error handling; none promise cancellation of an already-started mutation after grant revocation.
- `rls.test.mjs`: applies the actual editor enforcement migration against production-shaped policies, checks static owner/editor/viewer/commenter writes, sharing/ownership guards and permissive-policy hazards. It does not serialize a live two-connection membership change against an in-progress UPDATE.
- `connector-sql.test.ts`: native driver statement reservation, mixed-query/readiness concurrency, max-one/max-two sockets, and release/recovery after SQL errors. It establishes connection lifecycle; no grant consumption, revocation, or board mutation transaction is tested there.
- Previously recorded `fifth-production-real-services.json` lists a real shared-editor downgrade blocking a queued commit and direct viewer UPDATE. That receipt is existing evidence, not a new run here; it does not identify the exact after-membership-read/before-PATCH boundary.

## Smallest next gate

Use one isolated lifecycle fixture with actual `SqlOAuthStore`/vault migrations and the existing mocked Supabase transport; add explicit deferred checkpoints and controlled clocks/expired records, no sleeps, credentials or timeout increases. Proposed four cases: hold getUser, finish revoke, release and observe whether any tool/board dispatch occurs; hold getUser across connector expiry with an otherwise valid account JWT; hold pending approval and code consumption across their expiry (with two concurrent consumers still having one winner); downgrade membership after the application editor read but before a new UPDATE statement, proving zero changed rows and no automatic second PATCH. Pair each with ordinary valid completion and fresh post-revoke denial. Any before/after behavior changes require root’s explicit contract decision; no test should assert rollback/cancellation of an already committed/dispatched SQL operation.

## SHA256 identity

| Product file | SHA256 |
| --- | --- |
| mcp-server/src/oauth.ts | `7fb75edb0c68d6508ce763aa70d10fc74c31a05556d81b0d0c7d19ad1006e575` |
| mcp-server/src/oauth-store.ts | `a336444c2a02ced5c818f9908ddc5eff45fa0340b51b1e310afd036312079f84` |
| mcp-server/src/http.ts | `244d6fe6a62a6b9b4f06e023887a9a8db49d033b3fba2b91d66aa39868151766` |
| mcp-server/src/server.ts | `4d9b396ff24ad3b419ceb75b1352d046650c0348a354625dc47b97b71ee50760` |
| mcp-server/src/meeting.ts | `a0d58f8cf758593cfc259c5546895ab06a75ea674a79933564d8c664f22041c3` |
| mcp-server/src/board-data.ts | `bbac2dc43d1beb20f7cb07e028046d3df9eb87884d984fdba2c9d4f65657a034` |
| api/connector.ts | `b38719fa05e779d32b33f934466ebb8b67f6133896eb18f512ebf1389cac3562` |
| api/_lib/connector-runtime.ts | `89f955901c3a7c849fb20e8f2356a1fc8099ddf3ce8251d71a067b05bfb592be` |
| api/_lib/connector-vault.ts | `e1c78fc671f657d8f0bb93a2f1736d05136c6f43644ba270da0aa3cc31732711` |
| api/_lib/connector-sql.ts | `467174f4298ea29b177271c13de5d0ddbea18888f4002a7002b784322c886a0b` |
| editor enforcement migration | `24bc22fc072c75157e256a1e4bbf2ab7fbad8639a8cebf666155c06eae2b7f7d` |
| expiry cleanup migration | `da97273b6b2bc3d9a999dd0ee6aeb7bb019b5f9fe3b58612c11c1c33c83911ab` |

| Reviewed test file | SHA256 |
| --- | --- |
| mcp-server/test/oauth-http.test.mjs | `113fd84cf937c87a3df65615a565562e809a89dcf69c3a16d596d5e87b59a9a6` |
| mcp-server/test/oauth-store.test.mjs | `8f390fcdc2ca25d35e2841ac9d67a2e57e1126e227c2a62fa060f369d4c1e7d6` |
| mcp-server/test/plugin.test.mjs | `3f4b9be227a016077864ae55d48f744d2dc860a274e48072e8ec1d28c6169572` |
| mcp-server/test/board-data.test.mjs | `15d89b8471b94772c36b8279eeabcc0b5446b0935295589f3c776f078275c8f2` |
| mcp-server/test/rls.test.mjs | `6a607a808863e440ec82e3a5b989112815239624fc2defaedc4ac3cba018292f` |
| mcp-server/test/connector-cleanup.test.mjs | `cbf5e64d2f5566324de7718c6fd7f4aba12bfa7a3ced0426d693b4e8b90e917c` |
| api/_lib/__tests__/connector.test.ts | `f7f843c10132b4ea1c349595ba4d67d8e9bdefcdf8dd3c2a5c537ef1dd5ac743` |
| api/_lib/__tests__/connector-sql.test.ts | `af9b0599f80f2aecee1d51ae9f42938182058b8b99fd649a00d57ce598b3ac9f` |


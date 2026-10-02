# Independent final MCP lifecycle review

No concrete blocker found in the reviewed two-file product candidate and 16 focused lifecycle cases. This is a read-only source/diff review on `work/zeroboard-ai-ci`, branch `codex/gauntlet-mcp-lifecycle`, base `f8cfd718a867e90be26609fd392ec6129d05def9`. No edits, tests, builds or service contact were performed by this reviewer. The owner is running the AFTER gate; its results are not claimed here. The prior plan review defines the bounded pre-authority decision contract and clock/snapshot limits.

## Product assessment

- `oauth.ts:156–181` uses one `currentAccess` implementation for SDK verification and account resolution. It checks current stored token/grant, revocation, configured client, issuer/resource/scopes, then finite strict expiry against a clock sampled after its last await. `accountForToken` resolves the initial account reference, reruns current validity after the awaited resolution, checks optional account expiry and current user/reference binding, and returns the freshly checked grant. Existing local account contexts without `expires` remain supported.
- `oauth.ts:98–128` retains actual selected-board/editor checks, atomically consumes pending once, rejects any changed client/callback/resource/challenge/scopes/state binding, and evaluates consumed pending plus returned account expiry after all board reads and consume settlement. Issuance uses that consumed row. The first grant write follows the final decision without another pre-decision await.
- `oauth.ts:130–153` still requires the exact actual callback/resource and preserves PKCE challenge binding through consumption. It retains the consumed code, rejects changed grant/client/callback/challenge/resource linkage, and checks code plus current grant expiry after the later awaited grant lookup, before dispatching a token write. Expiry is excluded from the binding fingerprint because it is independently validated at this final decision.
- `currentExpiry` requires finite `expires > now`, so equality, nonfinite values and nonnumeric persisted values fail closed. Pending display/cancel, code lookup, grant/token checks and optional account expiry use this predicate. Consumed/expired denial does not recreate records or retry authority issuance.
- `oauth-store.ts:16–19` changes only the existing atomic DELETE/RETURNING predicate to require `expires_at > clock_timestamp()`. Key/kind parameters, JSON value shape, public `OAuthStore.take` signature and one-winner behavior remain intact. No schema, TTL, API, pool, transaction, RLS, package or production retry change is introduced.

## Focused evidence assessment

The new Node suite explicitly `vi.unmock`s the Supabase SDK, loads the actual runtime/provider/store/vault source, applies the real private migrations to PGlite and guards all SDK HTTP against fixture-only auth/board paths. Native loopback MCP requests use the actual HTTP/SDK adapter. The positive dispatch case asserts an actual GET and successful result; held getUser denial cases assert HTTP 401 and zero board dispatch rather than just an internal exception.

The 16 cases cover normal dispatch; completed revocation during held resolution with fresh-request denial; separate token/grant/account expiry at exact equality; real expired pending/code take; one-winner concurrent valid pending/code take; two actual SQL clock-vs-transaction-time controls; pending/code expiry after executed consume settlement; account expiry after held board reads; code expiry during its later held grant lookup; and ordinary approval/exchange/new-token resolution. Their four positive controls preserve usable authority and concurrency while the twelve denied boundaries require no new authority writes where applicable.

The SQL clock controls assert actual PostgreSQL predicates before taking; they do not merely mirror the implementation string. Unlike the original plan's assumption, this fixture explicitly observes that advancing the stubbed Date.now advances PGlite's WASI clock while transaction time stays fixed. Tests guard that premise with real result rows. Production PostgreSQL clock behavior remains the separately documented PostgreSQL 17 contract; the fixture is not a simulated production pooler or multi-process revocation lock.

Fixture teardown releases all held boundaries, drains tracked requests, closes its native listener and closes PGlite before restoring mocks. The new test does not import dist or require a shared build. Its direct code-exchange boundary isolates lifecycle behavior; the unchanged native OAuth HTTP suite remains the PKCE/callback protocol oracle. No test deadline or production assertion was weakened in the reviewed diff.

## Limits and disposition

The final checks are a decision boundary, not a linearizable lock spanning remote storage and board writes. A revocation committed after the final read snapshot can still race already-dispatched authority, and no SQL cancellation, rollback or response-emission deadline is promised. The stored SQL deadline and consumed JSON/application deadline independently deny expiry; the patch does not claim identical cross-system clocks. Ambiguous authority-write failures remain fail closed on subsequent use, with no automatic consumed-code retry.

No change request from this independent review. Focused AFTER evidence, full integration/native protocol gates and exact-head CI remain owner/parent responsibilities; this report is not a substitute for those executions.

## Captured hashes

Captured 2026-10-02T13:12:25.098265+00:00, HEAD `f8cfd718a867e90be26609fd392ec6129d05def9`.

| File | SHA256 |
| --- | --- |
| `mcp-server/src/oauth.ts` | `b74de20b3770aff5d4880e581bb8073accd72f926c13fed90b63824cd2ab9099` |
| `mcp-server/src/oauth-store.ts` | `53f46643435e99cdc693a9bf192eff43102f6a9a8b6893379f1ffa95456df1d9` |
| `api/_lib/__tests__/connector-lifecycle.test.ts` | `1a2071bb3b04bc25d7ab1ae1017504d9255a404e336db7e65b8de6ada74449e5` |
| `mcp-server/src/http.ts` | `244d6fe6a62a6b9b4f06e023887a9a8db49d033b3fba2b91d66aa39868151766` |
| `api/_lib/connector-runtime.ts` | `89f955901c3a7c849fb20e8f2356a1fc8099ddf3ce8251d71a067b05bfb592be` |
| `api/_lib/connector-vault.ts` | `e1c78fc671f657d8f0bb93a2f1736d05136c6f43644ba270da0aa3cc31732711` |
| `api/_lib/connector-sql.ts` | `467174f4298ea29b177271c13de5d0ddbea18888f4002a7002b784322c886a0b` |
| `mcp-server/test/oauth-http.test.mjs` | `113fd84cf937c87a3df65615a565562e809a89dcf69c3a16d596d5e87b59a9a6` |
| `mcp-server/test/oauth-store.test.mjs` | `8f390fcdc2ca25d35e2841ac9d67a2e57e1126e227c2a62fa060f369d4c1e7d6` |

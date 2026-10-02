# MCP lifecycle candidate: final bounded verification

Candidate in work/zeroboard-ai-ci, codex/gauntlet-mcp-lifecycle, base f8cfd718a867e90be26609fd392ec6129d05def9. Two product files and one new focused test are frozen. No API product, schema, RLS, TTL, pool, deadline, dependency target or shared dist changes. No remote services, credentials, production data, deployment, commits or pushes were used by this slice.

The repair revalidates current token/grant after awaited account resolution before new tool authority can be constructed, including current selected scope/boards and returned account identity/session expiry. SqlOAuthStore.take rejects rows expired according to clock_timestamp. Approval/exchange use and validate returned single-use records and check expiry after remaining required awaits before issuing authority. Immutable callback/client/resource/PKCE/scope bindings remain consistent. Existing public interfaces are unchanged.

This does not cancel/rollback a tool or SQL write already dispatched, guarantee expiry at response emission, or establish a transaction across private storage and board writes.

## Verified gates

| Gate | Result |
| --- | --- |
| Full controlled BEFORE v1 | 4 positive controls pass; 12 prospective failures, 16 total, 10.90s |
| Strengthened paired HTTP BEFORE v2 | 1 positive pass; 4 held-authority failures; 11 filtered, 4.74s. Each failure shows HTTP 200 plus captured GET dispatch, while fresh post-revoke denial still passes. |
| First AFTER v3, preserved | 15 pass; first positive exceeded the unchanged 5s test deadline, 27.57s. No semantic assertion or cleanup cascade; exact timeout phase is not known. |
| Isolated monotonic positive diagnostic | 1 pass, 15 filtered; case 2.887s. Catalog, migrations and runtime 2.097s; seeding 0.262s; HTTP/tool 0.522s. Setup consumed substantial assertion budget, but the earlier timeout phase is not established. |
| Final AFTER v4 | 16/16 pass, 15.02s. The held lookup denies HTTP 401 with zero board dispatch; expired or delayed consumption issues zero new authority. |
| Existing compiled native OAuth/store/plugin guards, Node 20.20.2 | 22/22 pass, zero skips/errors, 7.016s |
| Same private artifact/harness, Node 22.22.0 | 22/22 pass, zero skips/errors, 5.774s |
| Static |Strict MCP types, final API/node types, scoped lint including both product files, diff check, private MCP build all pass.|

All 16 assertion bodies stayed unchanged after paired v2. V3 only explicitly unmocks the real SDK for full app-suite compatibility. V4 moves a fresh isolated fixture into normal beforeEach with its existing 10s hook budget; each test still has its unchanged 5s deadline. It does not share an engine/catalog or prewarm a reusable fixture. Every case still gets new PGlite/schema/vault, own logical clock and fetch fixture. Original v1/v3 test snapshots and all failing logs remain separate; no identical-hash full-suite before/after claim is made.

Actual SQL migration/storage/vault, Supabase SDK and stateless MCP HTTP/tool dispatch are exercised. PGlite's installed WASI clock calls Date.now, so the controlled clock advances actual SQL clock_timestamp alongside app checks. Transaction controls query SQL to prove expiry is after transaction_timestamp but already expired at clock_timestamp; they distinguish the predicate from now() without sleeps or mocked SQL rows. Delayed DELETE tests execute consumption before holding delivery, then check returned JSON expiry at the later authority decision. The held grant-lookup test catches a code check placed too early.

## Frozen identity

- oauth.ts: b74de20b3770aff5d4880e581bb8073accd72f926c13fed90b63824cd2ab9099
- oauth-store.ts: 53f46643435e99cdc693a9bf192eff43102f6a9a8b6893379f1ffa95456df1d9
- final connector-lifecycle.test.ts: fa6043110df2c528eca6603f9734580d482db21dc59c697e79c793235819e53e
- installed PGlite dist/index.js: 03bce0708dbe57ab154c75089ded04c47d0a9e713fe397dee33cd3912101cab5

Exact logs, all source/test/config/snapshot hashes, diagnostic harness and native manifest are in twelfth-mcp-lifecycle-final-receipt.json. Source and assertion provenance includes v1 hash 99212b15..., v2 hash 544d26e6..., v3 hash 1a2071bb..., and v4 hash fa604311.... The product diff is preserved separately.

Private native build: /private/tmp/zeroboard-mcp-lifecycle-b74de20b/mcp-server/dist. Existing test/harness/migration copies have their own complete hash manifest; Node 20/22 ran the identical compiled artifacts sequentially with --test-concurrency=1. Explicit binaries: /private/tmp/zeroboard-ai-ci-runtime/node_modules/node/bin/node and /Users/tmcfarlane/.nvm/versions/node/v22.22.0/bin/node. Standalone Vitest config/cache stayed outside repo and loaded no app setup/environment files.

All owned Node/compiler/lint processes exited and native HTTP/PGlite fixtures closed. Root was notified that the resource slot and root node_modules symlink are free for fresh integration. Full combined app/API and eventual exact-head broad MCP CI remain root-owned gates. Independent source and final test-setup review are clear. The reviewer confirmed all 16 assertion bodies match the preserved pre-setup-change snapshot byte-for-byte; its final review addendum is saved separately. No further suite reruns are planned absent new changes/failures.


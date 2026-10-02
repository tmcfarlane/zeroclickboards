# MCP lifecycle verification

Two product files revalidate current OAuth authority after awaited account resolution and at single-use pending/code consumption. This folder is public fixture evidence for the bounded pre-authority decision contract, captured on base `f8cfd718a867e90be26609fd392ec6129d05def9` in `codex/gauntlet-mcp-lifecycle`.

The repair does not cancel tools or SQL already dispatched, provide a response-emission deadline, or create a transaction across private OAuth storage and board writes. No API/schema/RLS/TTL/pool/dependency changes are included. No real services, production credentials, board data, emails or deployment were used in these executions.

## Results and provenance

| Execution | Result | Source version |
| --- | --- | --- |
| Full controlled BEFORE | 4 positive controls pass, 12 intended failures; 16 total | v1 `99212b15…` |
| Paired held-HTTP BEFORE | 1 positive pass, 4 intended failures, 11 filtered; each held failure captures HTTP 200 and actual GET dispatch | v2 `544d26e6…` |
| Initial AFTER, retained | 15 pass, one first-control timeout at the unchanged 5s deadline | v3 `1a2071bb…` |
| Isolated monotonic diagnostic | 1 pass, 15 filtered; case 2.887s, catalog/runtime setup 2.097s | Instrumented v3 snapshot |
| Final focused AFTER | 16/16 pass; held resolution rejects 401 with zero board dispatch, expired consumption issues zero new authority | v4 `fa604311…` |
| Existing native OAuth/store/plugin compatibility | 22/22 pass on Node 20.20.2; 22/22 pass on Node 22.22.0, sequentially using the same private compiled graph | Executed 32-artifact manifest |
| Static | MCP and API/node types, scoped lint, diff check, private MCP compile pass | Frozen candidate |

The original timeout's exact phase is not established. The isolated diagnostic shows substantial setup cost; it does not retrospectively locate that timeout. Final v4 moves fresh per-case engine/catalog/runtime preparation into normal `beforeEach` with the existing 10s hook budget. All 16 test bodies match v3 byte-for-byte; the 5s test deadlines and assertions stay unchanged. There is no shared engine, reusable prewarmed fixture, deadline increase or identical-hash full BEFORE/AFTER claim.

Actual SQL migrations, `SqlOAuthStore`, the session vault, Supabase SDK and native stateless MCP HTTP/tool dispatch are exercised. Installed PGlite 0.3.14 uses `Date.now` for its WASI real-time clock, so these controls advance a shared application/SQL clock. Real SQL transaction controls distinguish `clock_timestamp()` from fixed `transaction_timestamp()`; SQL rows/results are not mocked. This is not a production pooler or independent-clock test.

## Files

- `captured/twelfth-mcp-lifecycle-final.md` and its original receipt contain the complete result and scope.
- `captured/` preserves the original BEFORE, initial/final AFTER, diagnostic, static and native logs/results byte-for-byte. Empty type/lint/build logs represent successful quiet commands, as recorded in the receipt.
- `captured/twelfth-mcp-lifecycle-final-review-initial.md` preserves the earlier independent source review. `captured/twelfth-mcp-lifecycle-final-review.md` includes its exact final test-setup addendum. The plan review is preserved separately; reviewers ran no tests.
- `sources/before/` and `sources/final/` hold exact product snapshots. Original v1/v3/v4 test snapshots remain in `captured/`. `sources/paired-before-v2.test.ts.txt` is a hash-matched reconstruction of v2 from the preserved v3 snapshot, removing only the later actual-SDK unmock lines; its recorded execution hash matches exactly.
- `sources/native-inputs/` holds the public native tests/helper/migrations/package/TypeScript config. The 32-file compiled manifest and Node 20/22 logs are retained. The private compiled bundle remains outside the repository; it is not needed to ship this source repair.
- Captured standalone and diagnostic configs retain the original absolute run paths. They document historical execution and do not claim to be portable commands from this folder.
- `receipt.json` maps durable copies to their original hashes and frozen source identity. `manifest.json` hashes every durable file except itself. `verify-evidence.py` checks all durable hashes and the current three frozen product/test hashes without running tests or contacting services.

## Reproduction and remaining gates

Run `python3 docs/qa/v0.8/mcp-lifecycle/verify-evidence.py` from the repository to check evidence integrity. The final executable regression lives at `api/_lib/__tests__/connector-lifecycle.test.ts`; normal app CI discovers it. Its actual-SDK unmock keeps browser SDK setup from replacing the transport under test. Historical standalone Vitest executions used Node 20.20.2, one worker, Node environment, no app setup or environment files; exact configs and outputs are preserved.

The native gate privately compiled `mcp-server/tsconfig.json` with `--outDir /private/tmp/zeroboard-mcp-lifecycle-b74de20b/mcp-server/dist`, then ran `node --test --test-concurrency=1 test/oauth-http.test.mjs test/oauth-store.test.mjs test/plugin.test.mjs` from that private `mcp-server` copy on each explicit Node runtime. The manifest identifies every executed artifact/input.

Fresh-base combined application/API tests, broad native exact-head CI and any real hosted gate are parent-owned and pending at this capture. A pre-integration hosted harness is prepared but unexecuted; its provenance stays outside this folder. No hosted verification is claimed by these fixture results. All owned HTTP/PGlite fixtures and processes were closed before capture.

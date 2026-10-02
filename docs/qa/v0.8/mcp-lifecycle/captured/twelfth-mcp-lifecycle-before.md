# Controlled MCP lifecycle BEFORE evidence

Base: `codex/gauntlet-mcp-lifecycle`, `f8cfd718a867e90be26609fd392ec6129d05def9`, work/zeroboard-ai-ci. Product OAuth/store source stayed byte-identical to the preceding read-only audit. Only a new focused test and outside-repository QA/config/cache were created. No credentials, remote services, browser, shared build/dist, production edits, commits or pushes.

Two Node 20.20.2 one-worker runs completed and all owned loopback servers/PGlite instances were closed. The PG resource slot is now free. Root authorized a subsequent bounded two-product-file repair after this report, with AFTER PGlite execution held until root releases the slot.

## Results

- Full BEFORE: **4 pass, 12 intended failure, 16 total**, 10.90 seconds. The passing controls are actual hosted get_board, concurrent valid pending take (one winner), concurrent valid code take (one winner), and normal approval -> code exchange -> new token account resolution.
- Paired HTTP BEFORE: **1 pass, 4 intended failure, 11 filtered skips**, 4.74 seconds. The four failures each explicitly show both **HTTP 200 instead of 401** and **['GET'] instead of zero board dispatch**. This second run uses the same prospective assertions as soft paired checks to capture both failures; no expectation was weakened. The valid hosted tool control passes again.
- No unhandled errors or held-response cleanup cascade occurred. Finally cleanup releases every hold, awaits pending work, closes the native HTTP fixture, closes PGlite even if native close fails, then restores global clock/fetch.
- In the held-revocation case, persisted revoked:true and absent vault were verified before release. A genuinely new HTTP request after revocation returned401 with zero board dispatch; only the already-started, held request subsequently dispatched. This does **not** demonstrate a fresh post-revoke bypass.
- Token/grant/account expiry each reached the exact deadline while getUser was held, then the captured board GET occurred. Independent seeded account/token/grant lifetimes isolate each required guard; they do not claim ordinary issuance can outlive its vaulted session.
- Actual SQL take returned expired pending and code rows. Both transaction controls first proved, using SQL, that expires_at was later than transaction_timestamp but already <=clock_timestamp, then the original unconditional take still returned the row.
- Actual DELETE was executed while valid and its result held. Crossing pending expiry before delivery produced a success callback with **1 new grant +1 code**. Crossing code expiry before delivery produced **1 new token**. No expiry rejection occurred.
- Holding the board-access read after successful account resolution, then crossing that returned session's expiry with pending still valid, produced a success callback with **1 already-expired grant +1 new code**. That grant is naturally unusable after expiry; this test establishes issuance/acknowledgement correctness, not a usable post-expiry grant exploit.
- Holding the grant lookup after successful code take, then crossing the consumed code's deadline, produced **1 new token**. This proves the final code check must follow that later required await, not merely sit immediately after DELETE delivery.

## Real fixture and clock scope

The test executes actual SqlOAuthStore, encrypted SqlSessionVault, production records/vault migrations, createConnectorRuntime, MCP server/transport and Supabase SDK. Only fixture.invalid auth/PostgREST requests are handled by a strict local fetch fixture. Unexpected origins/routes fail. Native HTTP uses an ephemeral loopback listener and a fixed canonical fixture Host. The input is an actual get_board tool call; recorded PostgREST GETs prove actual tool dispatch. SQL result delivery holds do not substitute return values.

Installed @electric-sql/pglite0.3.14 `dist/index.js` contains `_emscripten_date_now=()=>Date.now()`, called by WASI real-time clock. SHA256:
`03bce0708dbe57ab154c75089ded04c47d0a9e713fe397dee33cd3912101cab5`.

Consequently the controlled Date.now also controls PostgreSQL's clock_timestamp in this fixture. Assertions query actual SQL timestamps/predicates; they do not mock SQL rows or claim independent clocks, real-time expiry waits, or production response-time guarantees. There are no sleeps, fake timers or raised deadlines. The direct expired-take cases use actual past records; the delayed-delivery cases execute DELETE before advancing the clock.

## Exact command

Full run (CWD work/zeroboard-ai-ci):

```sh
CI=true /private/tmp/zeroboard-ai-ci-runtime/node_modules/node/bin/node node_modules/vitest/vitest.mjs run api/_lib/__tests__/connector-lifecycle.test.ts --maxWorkers=1 --config /Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/outputs/gauntlet/twelfth-mcp-lifecycle-vite.config.mjs --reporter=verbose --reporter=json --outputFile=/Users/tmcfarlane/Documents/Codex/2026-09-30/zeroboard-chatgpt-integration/outputs/gauntlet/twelfth-mcp-lifecycle-before.json
```

Stdout/stderr were redirected to twelfth-mcp-lifecycle-before.log. The paired auth run adds `-t 'MCP authority'` and uses before-auth.json/log. The private config imports only Vitest's config helper, loads this sole Node test with setupFiles:[], and uses an outside-repo cache; it neither imports the app Vite plugin nor loads environment files. The initial full-run test snapshot is preserved separately.

## Approved candidate shape, still not applied at this report

1. Private current-token/grant validator shared by verifyAccessToken and accountForToken. Read current time after its final required client lookup. Validate finite expiry with >now. accountForToken resolves the initial account, reruns the validator after that await, checks returned account expiry/user identity against the current grant, then returns current authority for new server construction.
2. Same OAuthStore.take signature; SQL expiry-aware DELETE using expires_at>clock_timestamp(). No schema, TTL, RLS, pool or deadline changes.
3. Retain and validate returned consumed pending/code records, preserving original bindings. Approval checks consumed pending and resolved account again before first grant/code write, after board and consume awaits. Exchange checks consumed code/current grant at the authority decision after the grant lookup, before token write.
4. No cancellation or rollback of an already-dispatched tool/SQL operation, no response-emission wall-clock promise, and no multi-system transaction. Existing host approval, scopes, board limits, PKCE/callback/resource semantics and valid/concurrent controls remain.

## Identity

| Artifact | SHA256 |
| --- | --- |
| unchanged oauth.ts | 7fb75edb0c68d6508ce763aa70d10fc74c31a05556d81b0d0c7d19ad1006e575 |
| unchanged oauth-store.ts | a336444c2a02ced5c818f9908ddc5eff45fa0340b51b1e310afd036312079f84 |
| original full-run test snapshot | 99212b15214a13e2c03f64bd5cc3d5216ab8390f6aaa45e81b8a4a817c9e7a78 |
| paired assertion/current test | 544d26e65c3ee1ad1c595207a42f8271f3f37a8d4a795dbe1ba7c9ec419f1849 |
| standalone config | 8385640b41ba7a9582e5d470d38321ebc43b63301ab0bf26821fd0ca3f685d18 |
| full BEFORE log | 53360ff4dfb2895cab1a71e1759c2e5219719c920529ae6d0827c246b13959a5 |
| full BEFORE JSON | fc7e921b2efca9875a67c15573a3cd78aba41471302411009976069df33abb44 |
| paired HTTP log | b1e247545387c09b67f22d5e460bd793ac9e4ab2eecb15e531f885ffe7b2737d |
| paired HTTP JSON | cc32883934ec15487910b97668d99b6abe21f128f71324d41b0a78db517d0b8f |


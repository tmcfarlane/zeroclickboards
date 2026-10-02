# Fresh MCP lifecycle integration

Executed at integrated HEAD `a26da88bf3768cc9bbe54f0c8cb8ddb7deb6cdcf`, merging reviewed lifecycle candidate `de385e8` with PR 45 merge base `022803b0760749f12489bcb2c0a6ef017fbc9a6c`. Root application dependencies use the validated private AI 6.0.214 / OpenAI adapter 3.0.77 tree; dedicated MCP dependencies remain unchanged with Zod 3. No install or shared dependency mutation occurred.

The one full app/API execution **failed: 981 passed and one failed across 47 test files**, with no retry. All 16 lifecycle tests passed. The sole failure is the existing Account sign-out case in `src/components/auth/__tests__/signOut.test.tsx:133`: the held logout fixture was reached, but `findByRole('button', { name: 'Signing out...' })` timed out while the captured DOM still showed enabled `Sign out` and the signed-in user. This run does not establish why that logout reached the fixture or classify the failure as a product or fixture defect. Parent owns diagnosis. Exact failure output remains in `full-test.log` and `full-test.json`; it is not replaced by a later green result.

| Gate | Observed result |
| --- | --- |
| Full app/API, once, Node 20.20.2, CI=true, maxWorkers=2 | 981 pass / 1 fail, 982 tests, 46 pass / 1 fail files, 47 files; elapsed 49.95s |
| Lifecycle file within that run | 16/16 pass |
| Nonincremental application TypeScript | Pass |
| Nonincremental API/node TypeScript | Pass |
| Scoped lint on two product files and lifecycle test | Pass |
| Original-config fixture Vite build to private outDir | Pass, 41 artifacts, elapsed 6.23s |
| Source/config freeze | All 382 tracked hashes match HEAD before execution and remain unchanged afterward |
| Prior bounded evidence preservation | All original 52 durable files unchanged |

The full gate retains the original Vite test settings, globals, jsdom default, setup file and includes. The private config overrides only cacheDir. The build retains original plugins/options and overrides only private cacheDir, build.outDir and emptyOutDir. Suite environment uses the existing placeholder Supabase URL/key; the browser-ready compiled build uses `https://connector-fixture.invalid` and `disposable-fixture-public-key`. Exact commands, explicit environment and exit codes are in the execution receipts; private configs retain the original absolute capture paths.

The build is at `/private/tmp/zeroboard-mcp-integrated-built-smoke/dist`; `built-artifact-sha256.json` hashes all 41 files. Entry JS is `assets/index-q79N9Snq.js` (990,183 bytes), lazy AppShell is `assets/AppShell-BWXOOkRE.js` (409,176 bytes); these are artifact identities, not a measured user timing or performance claim. The usual large-chunk warning is retained in the successful build log.

All owned suite/compiler/lint/build processes exited. The database test resource slot was released immediately after the full gate exited. No source changes, full retry, browser gate, real hosted service verification, production data/credential access, commit or push were performed by this integration slice. Parent owns compiled setup/consent checks, sign-out diagnosis and exact-head CI/deployment gates.

`receipt.json` records source/dependency/runtime identity and all results. `manifest.json` hashes every copied integration file except itself. The original parent evidence README/receipt/manifest remains untouched; this integration is a separate append-only capture.

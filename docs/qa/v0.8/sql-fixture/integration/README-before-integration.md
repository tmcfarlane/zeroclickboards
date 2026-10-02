# Native SQL fixture lifecycle

The wire fixture previously created PGlite and the private catalog after each TCP socket connected. Initialization and the startup response were outside its tracked work, so teardown could close the engine while that work continued. Catalog setup also occupied the unchanged five-second postgres.js connection deadline.

The helper now prepares one independent catalog per configured socket before listening, tracks startup and statement work together, stops new work before draining, and closes engines afterward. Nested caller `finally` blocks preserve fixture cleanup if driver shutdown fails. Production SQL execution, pool sizes, configuration, migrations and packages are unchanged.

## Before and after evidence

The same new real-socket lifecycle case is archived in both [instrumented original](source/instrumented-before.ts.txt) and [repaired source](source/repaired.ts.txt). It sends a valid PostgreSQL startup frame, holds startup, disconnects before any wire query and starts teardown. After two event-loop turns it releases startup and executes a real PostgreSQL `SELECT 42` inside that checkpoint.

- [Original helper](logs/lifecycle-before.log): the one selected case fails because teardown already completed and the native query rejects `PGlite is closed`; the three unchanged protocol cases are skipped. No deliberately detached global rejection is emitted by this bounded witness.
- [Repaired helper](logs/native-after.log): all four cases pass in 10.68 seconds, without unhandled errors. The native checkpoint returns 42 before teardown; the closed engine then rejects a query and the retired TCP listener refuses a connection.
- The original postgres.js protocol checks still prove overlapping requests from the unreserved driver, no overlap with the production executor at max=1/2, correct parameterized/parameterless/JSON results, and release after an actual SQL error. Both configured sockets still become active in the max=2 case.
- [Scoped ESLint](logs/lint.log), [API TypeScript](logs/types.log) and `git diff --check` pass. Empty compiler/lint logs mean exit code 0 with no diagnostics.

The driver connection timeout remains five seconds. Existing and new test deadlines remain fifteen seconds. No assertion or timeout was loosened. See [verification.json](verification.json) for exact commands, base/source hashes, lifecycle-case equality and gate status; [artifact-sha256.json](artifact-sha256.json) binds the archived evidence.

## Evidence limits

The [historical review](source/historical-review.md) records the previous local combined run's two connection-timeout failures and closed-engine teardown errors, plus the unchanged isolated file's three passing cases. The controlled lifecycle witness reproduces the untracked startup cleanup defect; it does not independently time which catalog/WASM phase caused every historical timeout. The handshake is synthetic, while statement packets and query results execute in real PostgreSQL.

The parent inspected PR42's actual failed GitHub job: all three original SQL cases passed, and six failures were in `signOut.test.tsx`. That separate auth-test blocker is being repaired by another owner. This fixture patch is not presented as the PR42 CI fix. A full unit integration gate and committed-head CI remain pending for this uncommitted patch.

## Reproduction

From the repository root, the focused repaired-source gate is:

```sh
npx vitest run api/_lib/__tests__/connector-sql.test.ts --maxWorkers 1
npx eslint api/_lib/__tests__/connector-sql.test.ts
npx tsc -p tsconfig.node.json --noEmit
```

Recorded runs used the [private Vite configuration](harness/private-vite.config.mjs.txt), which inherits repository test settings and moves its cache outside shared dependencies. Its absolute paths describe this isolated worktree and are evidence metadata, not a portable configuration requirement. No live database or credential is used. The controlled original source and its exact command are preserved for review; do not replace current source merely to replay an expected failing witness.

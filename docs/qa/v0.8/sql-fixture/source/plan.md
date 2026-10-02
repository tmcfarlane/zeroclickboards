# Test-only SQL wire fixture lifecycle repair

The current isolated worktree is `codex/gauntlet-sql-fixture` at `63efb43fe37ddc312a9b76b7ee1f875901389e7f`. Only `api/_lib/__tests__/connector-sql.test.ts` and its scoped QA evidence will change. The unchanged fixture is archived in `tenth-connector-sql-fixture-before.ts.txt`; `tenth-connector-sql-fixture-before.json` records its hash. Production executor/pool/configuration, migrations, timeouts and packages are excluded.

The source-confirmed defect is initialization/handshake work missing from `pending`: closing a socket before SQL lets fixture teardown close PGlite while its detached chain is still creating the catalog or preparing a startup response. The previous full run observed native `PGlite is closed` failures in migration initialization after `CONNECT_TIMEOUT`. That log is evidence of the failure; it does not by itself establish which setup phase consumed the connection deadline.

## Before witness

Add one optional fixture-only `beforeStartup` boundary and one real-socket regression while keeping original lazy engine allocation and original teardown intact. The test sends a valid PostgreSQL startup packet, pauses the startup chain after real catalog preparation but before any wire SQL, disconnects the client, then starts fixture teardown. It releases the controlled boundary after two event-loop turns and executes a real PGlite `SELECT 42` in that startup checkpoint. The test records whether teardown completed while work was held, whether the native query rejected, and its actual row value.

The original helper should close the engine before the held startup work resumes: the real query then rejects with `PGlite is closed`. The repaired helper must wait for the same chain and let the query succeed before closing the engine. Observing the query rejection inside the test boundary keeps the intentional failing before run bounded instead of manufacturing an unhandled global rejection. No mocked SQL result/driver or production executor is involved. This exercises the founded untracked-startup portion; original catalog-detachment stacks remain preserved separately.

The extra boundary is inactive in all three existing protocol tests. The baseline helper will temporarily accept an unused `max` argument so this new test and all existing assertions can remain identical across before/after runs. The instrumented-before hash and expected failure log will be recorded separately from the pristine baseline hash.

## Minimal helper repair

1. `wireFixture(max = 1)` prepares one independent real PGlite catalog per allowed socket before opening the TCP listener or constructing postgres.js. The max=2 test passes its existing pool size explicitly. Preparation is awaited/observed; a failure attempts to close every engine already created and rethrows the original failure.
2. Accepted sockets consume exactly one prepared engine. An unexpected extra socket is reported as a fixture error and closed, rather than starting unbounded cold setup within the driver's deadline.
3. A small enqueue helper serializes and tracks every accepted-connection chain, including startup. Rejections remain observable in `fixture.errors`; they are not treated as success. SQL packet execution, actual PostgreSQL replies and all overlap/cardinality/error-release assertions remain unchanged.
4. Teardown marks the fixture closing, stops accepting/processing packets and destroys sockets before draining all tracked work. It closes every prepared engine only after that work finishes. Startup avoids writing a handshake to an already disconnected socket.
5. Existing caller `finally` blocks nest driver shutdown inside a `try/finally` so fixture cleanup still executes if `sql.end()` rejects. Five-second driver connection deadlines and fifteen-second existing test deadlines remain unchanged.

## Gates

After the parent's resource release, first run only the new lifecycle witness against the instrumented old helper, one worker/private cache. Preserve its native closed-engine failure and source hash. Then apply the small helper repair and run all four native tests with the same assertions/timeouts. Targeted lint/TypeScript validation follows without a competing build. A full bounded unit gate is deferred until the parent integrates the latest `v0.8` and authorizes its resource slot; committed-head CI remains required. No commit, push, PR, service contact or production change is authorized here.

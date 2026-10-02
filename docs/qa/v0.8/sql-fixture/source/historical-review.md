# Native SQL fixture initialization and teardown

A concrete fixture lifecycle defect is founded; no production executor or pool change is indicated. This review did not run tests, start/stop processes, change source or contact services.

Current `api/_lib/__tests__/connector-sql.test.ts` hash: `af9b0599f80f2aecee1d51ae9f42938182058b8b99fd649a00d57ce598b3ac9f`.

## Evidence

The full combined run log reports 970 passing tests, two `CONNECT_TIMEOUT` failures in the native SQL fixture, and three unhandled `PGlite is closed` errors. All three closed-engine stacks point to `catalogFixture:34`, while applying migration SQL. The isolated file log reports all three tests passing in 4.28 seconds. Logs:

- `/private/tmp/zeroboard-ai-drafts-combined-units-full.log`: `1214fe14bbe7b3626dd967861f40587caea5292ab926c4b463b091b3aa5fdf7b`
- `/private/tmp/zeroboard-ai-drafts-combined-sql-isolated.log`: `ab3c6c23bcf61949a87da1cb0a2db220196bfc2af9f8a6d85e863eb5e2ed0a58`

In the source, each accepted TCP socket constructs a fresh PGlite engine and starts catalog creation (`48–50`). The startup handshake waits on that catalog (`61–64`). Only later statement-chain promises enter `pending` (`92–94`); neither the catalog promise nor startup-handshake chain is registered or given its own rejection handler. If the driver times out before sending a SQL statement, `close()` destroys sockets, sees no tracked work, and closes the engine (`103–107`) even though catalog creation can still be reading/applying a migration. This exactly fits the closed-engine stacks; it is a source-confirmed cleanup race.

The installed postgres.js starts its connect timer before connecting (`connection.js:343`) and cancels it on ReadyForQuery (`552`). The fixture sets `connect_timeout:5` but performs PGlite/WASM startup, file reads, migrations and role setup inside that connection window. Contended setup can therefore consume a networking deadline. The logs do not independently measure which setup phase exceeded five seconds, so this is a founded placement problem rather than a claim that every observed timeout has been causally reproduced.

## Smallest fixture-only repair

Prepare one catalogued PGlite engine per configured test socket before opening the TCP listener/constructing postgres.js: `wireFixture(max = 1)`, with the max=2 case passing `max`. Preserve one independent engine per socket and all existing real protocol execution, overlap counters and lease-release assertions. A prepared connection can send the synthetic handshake as soon as its startup packet arrives; there is no migration work inside the driver connect deadline. Unexpected extra sockets should fail clearly rather than silently start an unprepared engine.

Ensure preparation failure closes every engine already created, and teardown waits for every accepted connection's current chain before closing engines. If initialization/handshake remain asynchronous instead, both must join the tracked lifetime immediately and have observed rejection handling; merely increasing `connect_timeout` or catching/discarding closed-engine errors would leave the race. Stop accepting/processing new packets before taking the final pending-work snapshot.

Use nested `try/finally` around `sql.end()` and `fixture.close()` so a driver shutdown rejection cannot skip fixture cleanup. This is ancillary teardown hardening, not a production behavior change.

## Minimum verification after an authorized fix

Retain all three protocol tests and their existing five-second connect timeout: the unreserved driver must still show overlap, the executor must show none at max=1/2, two independent sockets must still become active, and failed SQL must release its lease and permit later health checks. Add a bounded fixture-lifecycle control that closes a socket before any SQL statement and then closes the fixture, proving no unhandled initialization/closed-engine rejection or leaked listener/engine. A preparation failure should also be reported and cleaned, rather than hidden.

Run the native file alone first; then the parent's normal two-worker combined gate provides contention evidence. No extra timeout, retry loop, production executor change or pool size increase is justified by the reviewed evidence.

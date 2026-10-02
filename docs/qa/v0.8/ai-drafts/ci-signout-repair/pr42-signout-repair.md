# PR42 sign-out fixture repair

Only `src/components/auth/__tests__/signOut.test.tsx` changed in the new `work/zeroboard-ai-ci` worktree, base `fa6476c70cbd25ba32dcb677bfc7ff5ee94c8025`. No production defect was founded or product source changed. The test-only patch awaits observable pending controls and guarantees held transport cleanup before resetting the next test's SDK state.

The actual Linux CI trace has 951 passes and six failures in this file. The first Account test reached one held `/auth/v1/logout` but synchronously failed to find the pending button. It exited before resolving that response. All five later cases timed out in their `beforeEach` actual-SDK `setSession` calls after 10 seconds. Native SQL cases passed in this CI run; the separate earlier local SQL-fixture failures are unrelated evidence.

The unchanged Account case passed locally using exact Node `20.20.2`, CI=true and the workflow placeholder environment. macOS arm64 is not Linux x64, and the original pending-state timing cause was not reproduced. Waiting for a disabled pending control is the appropriate observable UI assertion: HTTP fixture arrival alone does not establish that React committed the corresponding control. Both button and menuitem lookups now use `findByRole`; the disabled assertions and duplicate-request checks remain intact. No sleep or timeout was added.

Held response resolvers are now registered and removed on settlement. After each case, React/router cleanup unmounts the initiator; remaining held transports receive a disposable failure response, then public `supabase.auth.getSession()` drains the actual SDK's session-lock queue before global mocks/fetch are restored in finally. The SDK remains real; no private cleanup method, mock sign-out contract or auth-lock bypass was introduced.

## Controlled before/after evidence

A temporary, explicitly labeled throw was inserted immediately after the actual SDK's held logout reached the fixture. Before the cleanup change, this deterministic abort reproduced six failures: the intended first abort followed by all five ten-second setup timeouts (57.27 seconds). With the identical abort and repaired cleanup, only the intended first failure remained; the other five actual-SDK cases passed without setup timeouts (5.58 seconds). Original/probe snapshots and both failed-run logs are preserved outside the repository. The probe throw is absent from the final source.

After removing the probe, all six intact tests passed in 7.16 seconds under Node `20.20.2`: Account failure/session retention/duplicate prevention/explicit successful retry, public keyboard pending/failure/retry, unexpected SDK rejection normalization, departed-route stale result suppression, persistent billing toast host and optional draft intent delegation. Scoped ESLint and `git diff --check` passed. Assertions were preserved rather than weakening error/retry or pending semantics.

Before hash: `7c5b7b1a5fe9c2dd170879122aa0c0933c52144af6b6f83bbf6c85fdbcfcae31`.

Final owned test hash: `bd6566761bdae412fb6cf717b1f6bad76bc4bdc6d080a9512a5cf7a2c68e7273`.

`pr42-signout-repair-receipt.json` records all log/snapshot/config hashes and exact environment/result scope; `pr42-signout-repair.diff` preserves the narrow patch. Runtime/cache and Vite cache/config are private outside-repository paths. The only additional worktree entry is the explicitly authorized `node_modules` symlink to the unchanged primary dependency directory.

No commits, push, deployment, browser/build/full-suite run, real auth/service request or shared dependency install occurred. Owned test processes are finished. Exact committed-head CI and any combined integration/type gate remain root-owned and required. The controlled proof establishes the cleanup cascade repair; it does not claim to establish the original intermittent Linux pending-lookup cause.

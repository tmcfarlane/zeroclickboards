# Consent and connection ownership verification

Baseline: v0.8 merge `a507cd0d68c7e880089d350dc026988b3ce24cfc` (PR #39), October 2, 2026. Repair branch: `codex/gauntlet-consent`. Product changes are confined to `ConnectorConsentPage.tsx` and `ConnectorSettings.tsx`. API, authentication SDK, OAuth authorization, database/configuration, packages, and global routing are unchanged.

## Behavior

A delayed approval previously followed its callback after Back to boards or after the same tab displayed a different request/account. Cancellation results also survived replacement of the request, and an old account's disconnect dialog could remain visible after account replacement. The page now keys its local state by account identity and request ID, and invalidates asynchronous continuations during layout cleanup. Synchronous pending refs prevent duplicate mutations before disabled buttons render. Same-account token renewal and unrelated query/hash changes preserve selected boards and submitted actions.

Leaving consent preserves the user's chosen destination. The submitted approval may already have completed on the server; the pending status explains that approved access can be reviewed or disconnected in Account. The client does not promise rollback, replay the action, revoke automatically, persist a callback/code, or publish an old account's result into a successor page.

Settings defers session/retry reads while a revoke is pending, invalidates older reads at dispatch, and refreshes authoritative access with the current session after either outcome. Successful acknowledgement removes the row immediately. A non-2xx acknowledgement can still follow persisted server revocation, so an authoritative empty list also removes the obsolete confirmation while retaining the error for the current account. Failed/malformed reconciliation stays retryable through a GET; it never repeats the POST.

## Controlled evidence

All browser evidence uses the real app with disposable transport fixtures. Account replacement exercises the public Supabase SDK and actual AuthProvider callback. Tokens are deliberately unsigned, all accounts/endpoints use fixture data, and the fixture still seeds localStorage only on the top-level localhost page. No production credentials, approvals, boards, configuration, or deployment were changed by these runs.

| Gate | Before | After |
| --- | --- | --- |
| Thirty new controlled ownership/reconciliation unit cases | 26 failed, 4 positive controls passed against immutable captured baseline product files | All 30 passed within 87 focused connector units across 4 files |
| Five actual app lifecycle scenarios on desktop/mobile | All 10 failed on unchanged product baseline | All 10 passed, 15.8 seconds |
| Scoped ESLint and diff whitespace | — | Passed |
| TypeScript/app build with working disposable environment | — | Passed |
| Frozen full connector browser suite | — | 208 passed, 2 inapplicable mobile rename skips; 210 total, 3.9 minutes, no retries |

The baseline unit replay uses exact `git show` product/helper copies from the baseline commit and a temporary resolver outside the repository. It corrects an initial test fixture that reused one consumed Response for two reads; the 26/4 result above excludes that fixture error. Raw logs, captured baseline modules, and before browser traces are retained outside the repository under `outputs/gauntlet/seventh-before`. The working source was frozen before the broader browser run in `outputs/gauntlet/seventh-frozen-source.json`; all nine recorded source hashes matched after the run. [receipt.json](receipt.json) records source and final screenshot SHA-256 values.

Focused commands:

```sh
npm test -- src/components/connectors/__tests__
CI=true npx playwright test tests/connector-ui/connector-ownership.spec.ts --config playwright.connector.config.ts --workers=2 --retries=0
VITE_SUPABASE_URL=https://connector-fixture.invalid VITE_SUPABASE_ANON_KEY=disposable-fixture-public-key npm run build
CI=true npx playwright test --config playwright.connector.config.ts --workers=2 --retries=0
```

The unit cases cover departed approve/cancel success and failure, JSON decoding after owner replacement, same-account renewal, unrelated query/hash changes, synchronous duplicate/cross-action attempts, StrictMode cleanup, stale clipboard/revoke continuation, deferred reads, old GET snapshots, partial revocation, and failed/malformed reconciliation without replay. Existing selection, scope, callback, current approval, acknowledgement, and retry cases remain positive controls.

## Durable fixture screenshots

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| Submitted approval and honest may-complete status | [desktop](screenshots/approval-pending-fixture-desktop.png) | [mobile](screenshots/approval-pending-fixture-mobile.png) |
| Actual Back to boards remains in control after late approval | [desktop](screenshots/departed-approval-fixture-desktop.png) | [mobile](screenshots/departed-approval-fixture-mobile.png) |
| Successor request has fresh unchecked selection | [desktop](screenshots/successor-request-fixture-desktop.png) | [mobile](screenshots/successor-request-fixture-mobile.png) |
| New request after cancellation has no previous callback | [desktop](screenshots/fresh-after-cancellation-fixture-desktop.png) | [mobile](screenshots/fresh-after-cancellation-fixture-mobile.png) |
| Account replacement clears the predecessor confirmation/error | [desktop](screenshots/replacement-account-fixture-desktop.png) | [mobile](screenshots/replacement-account-fixture-mobile.png) |
| Non-2xx revoke followed by authoritative absence | [desktop](screenshots/partial-revoke-reconciled-fixture-desktop.png) | [mobile](screenshots/partial-revoke-reconciled-fixture-mobile.png) |

The partial-revoke fixture deliberately models the server's revocation-before-vault-cleanup ordering; its synthetic HTTP 503 is a transport failure scenario, not a claim about a production incident. Settings fixture clients are optional, so some screenshots intentionally display the operator setup warning. Desktop/mobile overflow assertions pass. Screenshot review confirms the pending decision, current account, unchecked successor selection, and reconciled error/access state are readable. These captures establish client behavior with fixtures; actual hosted OAuth/MCP client and deployment release checks remain separate.

## Final review and compiled checks

Independent review found no blocker and verified all nine source and twelve screenshot hashes. The duplicate-revoke case was then strengthened to perform a second deliberate POST with the renewed same-account token and verify acknowledged absence; all thirty ownership cases passed again. Product source stayed unchanged.

The first full app/API run passed 960 cases but hit an unchanged native Postgres-wire CONNECT_TIMEOUT plus two late PGlite cleanup errors. That fixture passed all three cases alone. The identical full assertions then passed all 961 cases with two workers and no unhandled errors; no source or timeout was weakened. That full run preceded the final test-only retry strengthening; final-head CI repeats the complete gates before merge.

Eight ownership browser cases passed against an immutable copy of the working compiled app, refreshing ten images. The two account-replacement cases invoke the public SDK through `/src/lib/supabase.ts` and remain labeled dev-app evidence, with their earlier actual AuthProvider/SDK passes. Their two images are retained. `receipt.json` records this distinction, forty-one build artifact hashes, current source/image hashes and new gate-log hashes. A compiled pass is not claimed for the dev-only source import.

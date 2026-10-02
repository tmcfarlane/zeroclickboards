# Unsent AI draft protection

Unsent composer text now participates in the board's existing navigation, sign-out and beforeunload guards. Choosing Stay retains the same text, including after Clear chat or closing the AI panel. A failed explicit sign-out keeps the text and guard available for retry. The leave dialog says “Your unsent AI text will be discarded. Stay to keep it.”

The composer remains local to its account-keyed AI component. The shell receives only a boolean. Same-account token renewal preserves the draft; identity replacement clears the previous account's text and pending decision. Reports from an obsolete account instance cannot clear a successor draft, including an A → B → A sequence.

These are compiled-app Chromium screenshots with disposable desktop/mobile Auth SDK and API transports. The board, unsigned session, prompt and failure response are fixtures. No human account, real board write, AI command execution or deployment was used.

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| Browser Back asks before discarding visible AI text | [Image](visible-draft-warning-desktop.png) | [Image](visible-draft-warning-mobile.png) |
| Stay retains the text and composer focus | [Image](visible-draft-stay-desktop.png) | [Image](visible-draft-stay-mobile.png) |
| Account navigation also protects a closed AI panel's text | [Image](hidden-draft-warning-desktop.png) | [Image](hidden-draft-warning-mobile.png) |
| Failed confirmed sign-out retains text and shows retry feedback | [Image](signout-failure-retained-draft-desktop.png) | [Image](signout-failure-retained-draft-mobile.png) |

## Evidence and scope

The loss baseline is `a507cd0d68c7e880089d350dc026988b3ce24cfc` on `v0.8`. The final combined candidate is the same three-file AI patch on the consent merge `c1b46d5fc246f68edfd4ac42b69b120a73e10bf7`. `verification.json` records the current source, disposable harness, compiled artifact, screenshot and durable log hashes. `combined-source-hashes.json` covers all 265 source/configuration files; they stayed unchanged through these gates.

- Before the repair, the two controlled unit files had ten expected failures and 37 passing controls. All 47 passed after the repair on the AI-only baseline; these checks also passed within the combined full unit run below.
- All ten new desktop/mobile browser cases failed at the missing draft guard or beforeunload assertion on the old product. Their font, runtime and external-transport gates passed. An earlier run with fonts blocked by the worktree dependency symlink was excluded; the corrected clean baseline is preserved in `logs/browser-before-clean.log`.
- The first repaired dev run passed eight cases. The two accepted-submit/quota cases reached the existing upgrade dialog, which the test needed to close before navigating to Account. Both passed after adding that explicit dismissal. The fixture's replacement JWT subject was also aligned with the disposable account; neither adjustment weakens the baseline failing draft assertions.
- After integrating the consent merge, the one full connector browser run passed 218 cases with two existing inapplicable mobile skips: 220 total, one worker, no retries.
- The combined full app/API unit run on local Node 25.6.0 passed 970 cases and failed two unchanged `connector-sql.test.ts` cases with localhost `CONNECT_TIMEOUT`. Teardown then reported three closed-PGlite errors. All three SQL wire-fixture cases passed alone, unchanged, in 4.28 seconds with no unhandled errors. The failed full log is preserved; the cause is unproven, and it is not reported as a clean full run. No assertions or timeouts were changed.
- Nonincremental app and Node TypeScript checks, targeted lint and diff checks passed. The combined production build uses the base Vite configuration with a private cache and development-file allowlist overlay, keeping shared dependency caches separate. All ten focused cases passed against that new compiled bundle in 35.4 seconds, with one worker and no retries. The eight captures above were refreshed from that run.
- Browser coverage includes history Stay/Leave, Clear chat and hidden-panel retention, failed sign-out and explicit retry, installed Auth SDK same-owner renewal/account replacement, composing Enter/keyCode 229, and clearing the guard before an accepted command's held request finishes. The renewal case waits for the updated same-ID fixture account to appear in the menu before checking retention. All navigation cases assert zero AI command requests; the accepted-submit case asserts one POST. Controlled units additionally cover whitespace, hidden quota state, quick actions during processing, network fallback and stale owner callbacks.
- Independent read-only review cleared the production patch and strengthened fixture. Its renewal-acknowledgement and request-count observations were addressed before the combined gates.

After these gates, the candidate fast-forwarded to PR41’s README-only merge `63efb43fe37ddc312a9b76b7ee1f875901389e7f`. All 265 recorded source/configuration hashes stayed unchanged; the compiled evidence above still identifies the tested `c1b46d5` build.

`preintegration-verification.json` and the earlier logs preserve intermediate AI-only evidence. Their older source/build/screenshot hashes are historical; the current images and `verification.json` identify the combined build. Exact committed-head GitHub CI remains the required full-suite gate before merge: Node 20 app/API tests and Node 20/22 MCP tests. This receipt does not claim that pending gate has passed.

## Limits

This protects actual nonempty unsent input in the existing single-line composer. Accepted Send still records the user message and clears the composer before HTTP completion. Submitted chat history and in-flight commands are outside this draft contract, and no automatic restoration or resubmission was added. Timeline editing is unchanged.

The synthetic beforeunload assertion proves the handler prevents a cancelable event for the current account. It does not promise that every browser displays a native prompt. The SDK identity checks use intercepted transports and disposable unsigned sessions rather than a live account.

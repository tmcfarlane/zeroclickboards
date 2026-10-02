# ChatGPT identity sign-in review evidence

These screenshots show the compiled application with disposable, intercepted Supabase transports. They do not show a real OpenAI login or production configuration. Source verification used integrated v0.8 commit `ffa5b962ba5fd078d26a783d3008a50cc19b1713`; the subsequent evidence commit adds only this receipt, screenshots and the browser harness/workflow.

| Check | Result |
| --- | --- |
| Focused auth, sign-out, installed SDK and board-sync tests | 152 passed in 7 files, Node 20.20.2, one worker |
| ESLint and compiled builds | Passed |
| Enabled compiled desktop/mobile browser stories | 14 distinct cases passed; the initial run passed 12, then a test-only trailing-fragment assertion correction passed the remaining 2 |
| Disabled compiled desktop/mobile browser stories | 8 passed; 6 enabled-only cases intentionally skipped |

The corrected harness is committed for a complete CI rerun. Run it locally with `CHATGPT_SIGN_IN_ENABLED=true npx playwright test --config=playwright.chatgpt-auth.config.ts`, then repeat with `false`. CI runs both modes without service credentials. The enabled fixture default belongs only to this isolated suite; the application flag remains disabled by default.

The browser tests exercise the actual installed SDK's provider URL, `openid profile` scopes, initiating return route, explicit link bearer, held authorization response, native callback session processing, retained user ID/email identity, identity-backed linked state and safe cancellation/collision errors. Desktop and emulated mobile layouts were visually inspected. They do not establish native-device keyboard behavior, server-side linking policy or OpenAI token validation.

## Earlier full-suite attempts

The initial pre-integration full run failed: 959 passed, 23 failed, and two PGlite errors followed SQL timeouts. Nine board-sync failures came from its missing `auth.initialize` mock; adding only that mock repaired the fixture and its 70 cases passed.

The integrated full run with two workers was stopped with exit 130 after SQL/setup and UI timeouts. Sixty connector-readiness cases did not execute after their setup timed out. Concurrent unrelated Vitest workers existed, but contention was not established as the sole cause. No timeout or assertion was weakened. The isolated 152-case run above passed; neither earlier attempt is a completed full-suite gate. Review the PR's CI at its published head for the full gate.

## Screenshots

[Desktop sign-in](browser/enabled-desktop-sign-in.png), [mobile sign-in](browser/enabled-mobile-sign-in.png), [explicit linking](browser/enabled-mobile-account-link.png), [identity-backed linked state](browser/enabled-mobile-account-linked.png), [disabled mobile sign-in](browser/disabled-mobile-sign-in.png).

## Live enablement remains pending

Follow [the conditional setup guide](../../chatgpt-sign-in.md). An approved OpenAI website client, compatible secret/token exchange, no-email claim enforcement or another supported explicit-link policy, and real callback/account-preservation verification are required before enabling the provider or build flag. Frontend scopes and these fixtures cannot satisfy that boundary.

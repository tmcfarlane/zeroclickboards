# Sign-out failure and route notification evidence

A rejected Account sign-out keeps the user on Account and displays “Could not sign out. Try again.” An explicit retry succeeds and reaches the signed-out landing page. The public account menu also supports visible failure and keyboard retry. One persistent notification host makes Account billing and public feedback errors visible. The board's existing draft confirmation remains intact.

These are actual compiled-app Chromium captures with disposable desktop/mobile auth and API transports. The email, unsigned session, connector endpoint/client and marketing preview are fixtures. No human session, real board, billing action or feedback submission was used. The failure captures remain at `/account`; retry captures reach `/` with Sign In visible.

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| Failed logout retains Account and retry | [Image](account-failure-desktop.png) | [Image](account-failure-mobile.png) |
| Explicit retry signs out successfully | [Image](account-retry-desktop.png) | [Image](account-retry-mobile.png) |

## Verification

- All ten added desktop/mobile cases failed against archived `ef779c57235d8699cf40feec79e6e66ec68e338d`, then passed with the repair.
- 931 app/API tests passed in one isolated full run. The initial overlapping run had two 5-second PGlite timeouts; it was rerun without concurrent browser/build work.
- Lint, TypeScript and the working fixture build passed. The broader browser suite passed 198 cases, with two existing inapplicable mobile skips.
- All ten sign-out/billing/feedback cases passed against the copied working build. The final two Account cases recaptured the images above; retry uses a viewport capture after the earlier error notification expires.
- Independent read-only review found no product blocker. Its test-option and notification-host reliability observations were corrected. A bounded departure-to-passive-cleanup gap was also hardened with layout cleanup before merge; 13 focused tests, targeted lint, TypeScript/build and all ten compiled desktop/mobile cases passed afterward, refreshing these four captures.

The full local app/API and broader browser results belong to the first candidate `a92589f272eadf863307fbe9f413109a0adc6895`; the final cleanup hardening is covered by the newer focused/compiled checks, and full CI must pass on the final head. `verification.json` records current source, refreshed screenshot, log and copied build hashes with that result scope. The PR description records the final commit identity. CI now includes `v0.8` alongside `main`; this candidate targets the feature branch.

## Remaining limits

The actual production OAuth/MCP service remains the PR 38 merge, `ef779c57235d8699cf40feec79e6e66ec68e338d`. Its 14 deployed semantic checks passed with bounded transport retries only for side-effect-free payload probes. First-attempt upload reliability remains unresolved: an anonymous probe also observed TLS/reset/timeout failures. No cause or transport fix is claimed here. Live ChatGPT client setup and a real user's consent remain unverified; these captures establish the UI failure/retry behavior through disposable transports.

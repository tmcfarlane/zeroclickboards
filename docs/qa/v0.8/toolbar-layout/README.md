# Board toolbar layout QA

At 1280×720 with the 360px AI panel open, the original desktop toolbar compressed Ask AI into two lines and overlapped it with Timeline. This patch changes seven class lines in `KanbanBoard.tsx`: toolbar groups wrap within the available board pane, Ask AI and its icon stay intact, and the search input follows its shrinkable preferred-width wrapper. The mobile header and shared controls are unchanged.

Candidate branch: `codex/gauntlet-toolbar-layout`, base `022803b0760749f12489bcb2c0a6ef017fbc9a6c`. Candidate component SHA-256: `cc6a4b31dd3b59f97b2719cee61bae56de44ac43a045f40e35bb08497e56ae63`; baseline: `6dbde3cc7299915f76a8c14b5080d27f23f4ab33d35a5405466cdde2d17602a8`. See the [exact class diff](harness/toolbar-source.diff), [source manifest](source-manifest.json), [receipt](receipt.json) and [41-file compiled artifact manifest](build-artifacts.json).

| Gate | Result |
| --- | --- |
| Original compiled desktop 1280 AI-open / mobile 390 AI-closed | Intended desktop failure: 2 Ask AI text lines and 36.984375px Timeline overlap; mobile control passed |
| Repaired compiled layout | 6 passed: desktop 1280 open/closed, 1024 open, 1024 long title open, 768 open, mobile 390 closed |
| Exact 640px desktop boundary | 1 passed; search shrank from its preferred 256px to 248px |
| Existing compiled AI draft tests | 6 passed, 3 each desktop/mobile: Back/Stay, hidden draft preservation and same-owner renewal/account replacement |
| Original-settings fixture build, scoped ESLint, diff whitespace check | Passed |

The geometry probes inspect all visible board toolbar controls, require separate rectangles, one Ask AI text line, center hit-testing and actionable trial clicks. They also type in search and open the filters and board-actions menu. All seven repaired layout cases have document/body width equal to viewport width. This verifies toolbar accessibility, without claiming the entire sharing workflow was exercised.

| Compiled capture | Before | After |
| --- | --- | --- |
| Desktop 1280, AI open, no modal | [Image](screenshots/before/desktop-1280-open.png), [measurements](metrics/before/desktop-1280-open.json) | [Image](screenshots/after/desktop-1280-open.png), [measurements](metrics/after/desktop-1280-open.json) |
| Mobile 390, AI closed | [Image](screenshots/before/mobile-390-closed.png), [measurements](metrics/before/mobile-390-closed.json) | [Image](screenshots/after/mobile-390-closed.png), [measurements](metrics/after/mobile-390-closed.json) |
| Desktop 1024, long title, AI open | — | [Image](screenshots/after/desktop-1024-long-open.png), [measurements](metrics/after/desktop-1024-long-open.json) |
| Desktop 640, AI open | — | [Image](screenshots/after/desktop-640-open.png), [measurements](metrics/after/desktop-640-open.json) |

All browser runs used one worker, zero retries, real bundled Geist typography and existing local transport fixtures that block external traffic. The private build imported the unchanged original Vite config; only its cache/output locations and empty-output setting were scoped to a new directory. Package files, dependencies and original Vite/Playwright settings were not changed. Explicit runtime: Node 20.20.2 at `/private/tmp/zeroboard-ai-ci-runtime/node_modules/node/bin/node`. The disposable build environment was `VITE_SUPABASE_URL=https://connector-fixture.invalid` and `VITE_SUPABASE_ANON_KEY=disposable-fixture-public-key`.

The compiled app is frozen separately at `/private/tmp/zeroboard-toolbar-built-smoke/dist`. [Harness copies](harness/playwright-layout.config.mjs.txt) and logs record exact inputs. The baseline uses the preserved pre-patch SDK compiled app; its component hash matches the recorded source snapshot. The first baseline log is retained: an unreachable later filter-popup locator was corrected to the actual “Labels” text, then the final baseline was run with the same six-case harness as the repaired layout run. It again failed only at the intended desktop two-line assertion. A separate seventh case was added afterward to prove actual search shrinking at 640px; it is recorded independently.

This is scoped UI verification. No full app/API/MCP suite, service contact, credential access, grants, deployment, commit or push occurred. The preview server stopped and port 4277 has no remaining listener. The sealed preintegration MCP acceptance harness was preserved unchanged.

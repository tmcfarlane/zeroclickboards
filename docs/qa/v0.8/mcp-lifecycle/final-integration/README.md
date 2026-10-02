# Final combined MCP, auth and toolbar integration

Verified combined HEAD `54a767abfb0dc1fedbe61cb637cebac1ecbd6f1c`: the reviewed lifecycle candidate plus auth owner-layout repair `eabdcb3` and seven toolbar class changes `2650da7`. The original failed 981/1 integration evidence remains unchanged in the sibling `integration/` folder.

| Gate | Actual result |
| --- | --- |
| Full app/API, once, Node 20.20.2, CI=true, maxWorkers=2 | **989/989 pass, 47/47 files**, no retry; wrapper 114.34s, Vitest 113.41s |
| MCP lifecycle cases inside the full gate | 16/16 pass |
| Nonincremental application and API/node types | Pass, sequential |
| Scoped lint | All six lifecycle/auth/toolbar product/test files pass |
| Single original-config fixture build | Pass, 41 artifacts, wrapper 6.72s |
| Compiled setup/consent | **4/4 pass**: setup discovery/copy and selected editable-board approval on desktop and mobile |
| Compiled toolbar geometry | **3/3 pass**: 1280px AI open, 640px AI open, 390px mobile viewport AI closed |
| Source/artifact integrity | All 431 tracked code/config hashes and candidate three hashes unchanged; all 41 built artifacts unchanged after browser checks |

The full test gate retains original Vite settings/setup/include, with only private cacheDir overridden. Types are nonincremental. The build retains the original config/plugins and overrides only private cacheDir/outDir/emptyOutDir. Its exact environment is `VITE_SUPABASE_URL=https://connector-fixture.invalid` and `VITE_SUPABASE_ANON_KEY=disposable-fixture-public-key`. The suite uses the existing placeholder Supabase environment. Installed root dependencies are the validated private AI 6.0.214 / OpenAI adapter 3.0.77 tree; dedicated MCP dependencies remain unchanged. Exact commands, environment, exit codes and timings are captured in execution receipts.

The one immutable compiled graph is `/private/tmp/zeroboard-mcp-final-integrated-built-smoke/dist`. `built-artifact-sha256.json` identifies all 41 artifacts, including `index-CdR62uw8.js` and `AppShell-ChgC_V2i.js`. Asset bytes/names identify the build; no performance or user timing gain is claimed. The usual large-chunk warning remains in the successful build log.

## Browser proof and images

Both gates render this compiled graph using the existing guarded disposable transports from `tests/connector-ui/fixtures.ts`. No production authentication, real boards, provider call, email or hosted deployment is exercised. The connector cases assert actual account-menu navigation, clipboard contents, public client ID, initially disabled approval, unchecked board selection, disabled viewer selection, exact selected-board POST payload and a fixture callback. Desktop/mobile use the existing projects; the mobile connector project emulates iPhone 13 on Chromium.

The toolbar harness preserves the reviewed geometry assertions and adapts only fixture/output paths and scenario selection. It checks loaded Geist font, document/body overflow, control bounds, hit targets, pairwise overlap, single-line Ask AI text, 640px search shrink, trial clicks and actual filter/action menus. Its three scenarios use Chromium with adjusted CSS viewports; the 390px case is a mobile viewport geometry check. Its first invocation selected **zero tests** because my grep expected a bare title. `browser-toolbar/bootstrap-no-tests/` preserves that config, log, result and exit receipt. The corrected suffix filter selected the requested three cases; no toolbar assertion had run before that correction, and no assertion or product source was changed.

Seven fresh fixture screenshots were visually reviewed:

- `browser-connectors/screenshots/setup-desktop.png`
- `browser-connectors/screenshots/setup-mobile.png` (connector card capture)
- `browser-connectors/screenshots/consent-selected-desktop.png`
- `browser-connectors/screenshots/consent-selected-mobile.png`
- `browser-toolbar/artifacts/after-screenshots/desktop-1280-open.png`
- `browser-toolbar/artifacts/after-screenshots/desktop-640-open.png`
- `browser-toolbar/artifacts/after-screenshots/mobile-390-closed.png`

An additional anonymous landing screenshot and agent-browser check document initial preview loading. The page rendered, page errors were empty and no error overlay appeared. The local static preview lacks `/_vercel/insights/script.js`; its analytics 404/notice is explicitly retained. This check does not claim zero console errors or deployed analytics health.

## Identity and limits

`receipt.json` records exact source/config/runtime/dependency and image identity; before/full/final source snapshots preserve all 431 hashes. `manifest.json` hashes every durable file except itself. Executable private harness/config copies use a `.txt` suffix here, preserving captured bytes without adding tests or lint targets to the repository. Passed-test duplicate attachment copies are omitted; all seven canonical fixture PNGs and their result/log receipts are durable.

Run `python3 docs/qa/v0.8/mcp-lifecycle/final-integration/verify-evidence.py` for a read-only durable/source hash check. The original 52 lifecycle evidence files and all 21 prior failed-integration files remain unchanged. All owned HTTP/browser/compiler/lint/build processes exited; local preview port 4262 is closed. No build repeat, full-suite retry, dependency install/target mutation, source edit, commit, push or deployed-service verification was performed by this slice. Parent owns exact-head CI, merge and hosted gates. The lifecycle contract remains bounded to new authority decisions, with no cancellation of already-dispatched tools/SQL or response-emission clock guarantee.

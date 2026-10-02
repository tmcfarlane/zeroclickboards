# AI provider JSON response-reader verification

Baseline: `63efb43fe37ddc312a9b76b7ee1f875901389e7f` (PR #41), October 2, 2026. Candidate branch: `codex/gauntlet-ai-response-limit`. Changes are limited to root AI dependencies, one actual-adapter regression test, and this evidence. Application endpoints and MCP dependencies are unchanged.

The application's authenticated command and board-template endpoints call `generateText` through OpenAI Chat and Responses adapters configured for the Vercel AI Gateway. Their old `@ai-sdk/provider-utils` JSON/error readers are affected by [GHSA-866g-f22w-33x8](https://github.com/advisories/GHSA-866g-f22w-33x8). The upstream response is not a request-selected URL; this verification does not establish attacker control of a production gateway response.

The candidate preserves caret declarations for `ai` 6.0.214 and `@ai-sdk/openai` 3.0.77. Its lock resolves provider-utils 4.0.33, gateway 3.0.139, provider 3.0.12, OIDC 3.2.0 and eventsource-parser 3.1.1. These seven resolved package changes belong to the reviewed AI chain. No override or bulk dependency update is included.

## What the patch bounds

The [maintainer backport](https://github.com/vercel/ai/commit/b30e43a) routes successful JSON and error-body reads through the bounded response reader and cancels a body rejected by its declared size. The reader's default is **2 GiB** (`2147483648` bytes). This is the upstream SDK limit, not a small application memory cap. The public `createOpenAI` and `generateText` settings inspected for these versions provide no supported lower JSON-response byte limit; `experimental_download` concerns files in prompts. No custom runtime fetch wrapper is added.

The test advertises `Content-Length: 2147483649` while supplying a small valid JSON body in a real chunked `ReadableStream`. The declaration intentionally exceeds the actual fixture body. It proves the early header check without allocating or transferring 2 GiB. It does not prove cumulative rejection for a response without that header, or that a function can safely buffer the SDK's default maximum.

## Actual-adapter before and after

[`ai-provider-response-limit.test.ts`](../../../../api/_lib/__tests__/ai-provider-response-limit.test.ts) uses the public `createOpenAI` and `generateText` path in both adapter modes used by the endpoints. Only transport is replaced with an injected synthetic gateway fetch. The SDK's parsers, error handlers, bounded reader and generation remain real. Global fetch rejects unexpected network use, retries are disabled, and every case verifies one injected fetch and no global fetch.

| Gate | Baseline dependency tree | Candidate dependency tree |
| --- | --- | --- |
| Ordinary successful streamed JSON, Chat and Responses | 2 passed | 2 passed |
| Ordinary streamed JSON errors retain message and HTTP status | 2 passed | 2 passed |
| Declared oversized success is rejected before body consumption | 2 expected failures: ordinary generation resolved | 2 passed |
| Declared oversized error is rejected for size before consumption | 2 expected failures: no DownloadError cause | 2 passed |
| Total | 4 passed, 4 expected failures | 8 passed |

All four candidate guard cases assert that an `APICallError` contains the SDK `DownloadError`, zero bytes were delivered, the unread stream was cancelled, and it did not complete. The ordinary controls consume all small fixture bytes and complete. The exact same test SHA-256 was used for both dependency trees. No fixture correction or test relaxation was needed between runs.

Both trees were installed only in this isolated worktree with a private npm cache, no node_modules symlink, and install scripts disabled. Node 25.6.0, npm 11.8.0 and Vitest 4.1.4 were used. The focused command was identical apart from the report destination:

```sh
npm ci --ignore-scripts --no-audit --no-fund --cache /private/tmp/zeroboard-ai-response-limit-npm-cache
./node_modules/.bin/vitest run api/_lib/__tests__/ai-provider-response-limit.test.ts --maxWorkers=1 --reporter=default --reporter=json --outputFile.json=<phase-result.json>
```

The baseline package files were copied from the base commit, and the prepared candidate package files were restored before its installation. [baseline.json](baseline.json) and [candidate.json](candidate.json) retain every case's result; [receipt.json](receipt.json) records source/lock hashes, exact installed versions and log hashes. Raw logs are retained outside the repository in `outputs/gauntlet/eleventh-ai-response-limit-*-test.log`.

## Node 20 compatibility gates

The next released gates used Node **20.20.2**, matching the root-provided CI runtime, with the same private candidate node_modules. All 33 cases across the new adapter regression, existing command-resolution tests and existing AI-assistant tests passed with one worker. Nonincremental app and API/node TypeScript checks and ESLint on the new test passed.

The production build imported the original `vite.config.ts`, retaining its plugins and settings while assigning a private cache/output directory. It used disposable Supabase URL/public-key values, transformed 2,403 modules and completed in 11.54 seconds. It printed the existing Browserslist age notice and large-chunk advisory; no unrelated update or chunk refactor was made. Build artifact hashes and the exact commands are in [receipt.json](receipt.json).

```sh
NODE20=/private/tmp/zeroboard-ai-ci-runtime/node_modules/node/bin/node
$NODE20 node_modules/vitest/vitest.mjs run api/_lib/__tests__/ai-provider-response-limit.test.ts api/_lib/__tests__/resolve-commands.test.ts src/components/ai/__tests__/AIAssistant.test.tsx --maxWorkers=1
$NODE20 node_modules/typescript/bin/tsc --project tsconfig.app.json --incremental false --noEmit
$NODE20 node_modules/typescript/bin/tsc --project tsconfig.node.json --incremental false --noEmit
$NODE20 node_modules/eslint/bin/eslint.js api/_lib/__tests__/ai-provider-response-limit.test.ts
```

[compatibility.json](compatibility.json) records all 33 case results. This candidate check supplements the unchanged Node 25 before/after proof above; the two runtime scopes remain explicit.

## Refreshed production audit

`npm audit --omit=dev --json` with the private cache removed exactly the four AI-family affected package nodes: `ai`, `@ai-sdk/openai`, `@ai-sdk/gateway` and `@ai-sdk/provider-utils`. The affected-node total fell from 10 to 6, with no added or changed remaining findings. [audit.json](audit.json) and [audit-diff.json](audit-diff.json) retain the public results and comparison. Audit exit code remains 1 because the existing Lodash, React Router and Resend/Svix/UUID findings remain; this is not a claim of zero production advisories.

Those remaining package versions and application code are unchanged. The earlier source assessment found no application use of the affected Lodash template/path operations or UUID output-buffer APIs, no Framework/RSC/SSR router deployment, and no untrusted application navigation/redirect target matching the router advisories. Their findings are preserved for separate review rather than folded into this patch. The audit comparison establishes removal of the scoped AI advisory, not proof against every possible dependency exposure.

Full unit, broad browser and MCP suites remain held for the separate shared-host gate. No live AI request, production credential, UI verification or deployment is claimed.

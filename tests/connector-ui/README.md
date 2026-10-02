# Connector browser verification

Run `npx playwright test --config playwright.connector.config.ts` from the repository root.

This suite renders the actual ZeroBoard application in Chromium at desktop and
mobile sizes. It replaces only external HTTP/realtime transports with disposable
fixtures: a local unsigned auth session, Supabase board responses, and connector
API responses. All external requests and Supabase writes are blocked. No account,
subscription, production board, or live ChatGPT connection is changed.

Covered flows include discovery through the account menu, public OAuth client
setup details, endpoint copying and
clipboard fallback, unavailable-service messaging and retry, confirmed revoke
and revoke failure, selected-board OAuth consent and return navigation,
cancellation, expired/unsupported requests, no available boards, approval failure,
unsafe callback rejection, viewer access with a read-only request, signed-out
consent, and mobile horizontal overflow. Hosted OAuth, persistence,
token issuance, and MCP behavior are verified separately by API/server tests.

Screenshots in the Playwright report are labeled as disposable fixtures. To save
stable evidence files outside the report, set `CONNECTOR_SCREENSHOT_DIR` to an
absolute output directory. These screenshots demonstrate the rendered UI and its
tested local states; they do not prove a production OAuth client is configured.

The `ChatGPT connector UI` workflow runs this suite without secrets on every pull
request, including forks.

For manual browser review, start Vite with the same disposable Supabase URL/key
shown in `playwright.connector.config.ts`, then set `CONNECTOR_REUSE_SERVER=1` to
run against that local server. Server reuse is disabled in CI.

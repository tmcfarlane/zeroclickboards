# Independent MCP lifecycle plan review

Read-only review of `work/zeroboard-ai-ci`, branch `codex/gauntlet-mcp-lifecycle`, head `f8cfd718a867e90be26609fd392ec6129d05def9`. The prospective plan is `twelfth-mcp-lifecycle-plan.md`; source and plan hashes are below. No repository edits, tests, builds, services, credentials or runtime configuration were used. Official PostgreSQL documentation was read to verify time/snapshot semantics. The owner is preparing controlled BEFORE evidence; this report reviews the plan and existing source, not unobserved test results.

## Assessment

The proposed two-product-file scope is appropriate for the parent's bounded contract. A fresh validation after awaited account resolution and expiry-aware single-use consumption close the audited boundaries without API, schema, TTL, pool, transaction or cancellation changes. The actual SQL store must remain the concurrency oracle; `TestStore.take` is only a serial fixture and is not atomic across concurrent callers.

One additional controlled case belongs in the approval scope: hold a board-access read after `approveConsent` has resolved the account and accepted `account.expires`, expire that account while held, then release. Current source checks account expiry only before the board awaits (`oauth.ts:100–108`). It can consume a still-valid pending request and issue a success callback with an already-expired grant. Expect zero grant/code writes after the account expires, paired with ordinary approval success. This was sent to the owner before product edits; it extends the already-requested final authority check rather than adding a stronger in-flight policy.

## Smallest reusable method shape

Use one private current-token/grant validator returning the validated stored token and grant together. `verifyAccessToken` formats its result into SDK `AuthInfo`; `accountForToken` calls the same validator before and after `resolveAccount`. Avoid formatting `AuthInfo`, extracting a grant ID, rereading the grant and reimplementing partial expiry predicates in a second path. That current structure is how the final state diverges from the first validator.

The common validator should read the current application clock after its final await, including client lookup, and apply the existing issuer/resource/client/scope/revocation rules together with finite `expires > now` for token and grant. The final account path checks returned user identity and, when present, finite unexpired account-session expiry. The optional `AccountContext.expires` remains optional for existing local adapters. Preserve the account-reference binding used for resolution: if a store can return a different current grant/account reference after resolution, do not use the resolved session as if it authenticated that replacement. Returning the freshly checked grant prevents use of an earlier stale revoked copy.

For pending/code, factor record validation so pre-read and consumed-row checks share the same expiry, resource and configured-callback rules. The atomic `take` result must be retained, validated and used as the consumed record, rather than treated only as a truthy flag while issuance continues from the earlier copy. Callback/resource/client/challenge/scopes/grant linkage should retain their immutable binding across the pre-read/consume pair; reject changed authority bindings rather than silently upgrading a scope after earlier board/PKCE checks. No current production path mutates pending/code bindings after creation, so this is a consistency guard, not a new client-registration feature.

Place the final checks after the last pre-issuance await. Approval rechecks account and consumed pending after board reads and consume settlement before its first grant write. Code exchange also awaits a grant lookup after `take`; checking consumed-code expiry only immediately after `take` would leave the same boundary if that later lookup is held. Validate consumed code and current grant at the final decision before the token write. This does not require a post-write or response-emission deadline guarantee. No retries should recreate a consumed request/code after a denied or ambiguous operation.

## Consumption and clock consistency

Keep the public `OAuthStore.take(kind,key)` signature and return type. Add `expires_at > clock_timestamp()` to the single atomic DELETE/RETURNING statement. Missing/expired rows return undefined; expired retained rows can still be cleaned by the existing cleanup process. Keep provider validation of the returned JSON record because arbitrary local stores need not implement SQL expiry and because consumption may settle after JSON expiry. Reject expiry at equality: use finite positive validity (`expires > now`), equivalently expiry at `<= now`; the current `<` conditions accept the exact application-clock boundary.

`SqlOAuthStore.put` already derives `expires_at` and JSON `value.expires` from the same numeric input. The new SQL predicate guards the database deadline; the returned-record check guards JSON expiry against the current application clock. If those fields diverge or the two clocks disagree, either earlier expiry denies authority. Do not replace the JSON deadline with a fresh TTL from consumption, or describe an exact cross-clock equivalence. No schema change is needed to enforce these two bounded checks.

PostgreSQL `now()`/`transaction_timestamp()` are fixed at transaction start; `statement_timestamp()` is fixed at command receipt. `clock_timestamp()` advances during execution, making it appropriate for a consumption-time expiry predicate. It still measures the instant the predicate is evaluated, not SQL completion or HTTP response time. The post-await application check remains necessary. [PostgreSQL 17 date/time documentation](https://www.postgresql.org/docs/17/functions-datetime.html#FUNCTIONS-DATETIME-CURRENT).

Under Read Committed, target-row discovery uses the statement snapshot. DELETE can wait on a concurrent row owner; if an updated row is committed, PostgreSQL re-evaluates the WHERE condition against that updated version. A final application check covers delayed settlement without claiming that every lock wait automatically evaluates the predicate at response time. No cross-query lock or cancellation is added. [PostgreSQL 17 transaction isolation](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-READ-COMMITTED).

## Focused evidence review

The planned actual runtime/SDK/SqlOAuthStore/vault/PGlite fixture, native loopback HTTP request, held getUser and held executed-DELETE response gates are meaningful. Count actual PostgREST/tool dispatch, not just rejection strings. Retain ordinary valid tool dispatch and grant issuance, fresh post-revoke denial, distinct token/grant/account expiry paths, and one-winner concurrent valid pending/code takes. Capture zero new authority writes for consumed-row settlement expiry, not merely an expired returned token.

Add equality cases at the application clock and the held approval account-expiry case above. Use SQL-column-expired/JSON-future and JSON-expired/SQL-column-future controls if testing the two deadline layers independently; those are deliberately inconsistent private fixtures, not a claim that normal `put` creates them. The existing HTTP `TestStore` can remain unchanged if shared provider guards enforce validity; it must not be used to claim atomic consumption.

An optional no-sleep SQL clock proof can use a real PGlite transaction fixture: create a future-JSON record, set `expires_at=clock_timestamp()` in a later statement, prove that expiry is later than `transaction_timestamp()`, then take through the real store. A `now()` predicate would still accept it; a wall-clock predicate should deny it. This changes only the fixture and does not require a production transaction. Ordinary pre-expired records prove an expiry predicate but do not distinguish its clock function. This suggestion was sent to the owner; no test was run by this reviewer.

## Limits

A final database reread observes revocations committed before that read's snapshot. It is not a linearizable revocation lock spanning construction and remote writes. Authority already dispatched before invalidation is not cancelled. Board membership/RLS checks remain a separate boundary. No rollback, wall-clock response deadline, automatic grant retry or stronger protocol promise is justified by this plan review. The original audit's source-derived sequences are not converted into executed evidence here.

## Captured identity

Captured at 2026-10-02T12:58:16.749496+00:00.

Plan SHA256: `d5b085d91d2a3163947ee5b33b1516717c6b1ee34b3200ba2c6ef2d3fad11f1a`.

| File | SHA256 |
| --- | --- |
| `mcp-server/src/oauth.ts` | `7fb75edb0c68d6508ce763aa70d10fc74c31a05556d81b0d0c7d19ad1006e575` |
| `mcp-server/src/oauth-store.ts` | `a336444c2a02ced5c818f9908ddc5eff45fa0340b51b1e310afd036312079f84` |
| `mcp-server/src/http.ts` | `244d6fe6a62a6b9b4f06e023887a9a8db49d033b3fba2b91d66aa39868151766` |
| `api/_lib/connector-runtime.ts` | `89f955901c3a7c849fb20e8f2356a1fc8099ddf3ce8251d71a067b05bfb592be` |
| `api/_lib/connector-vault.ts` | `e1c78fc671f657d8f0bb93a2f1736d05136c6f43644ba270da0aa3cc31732711` |
| `api/_lib/connector-sql.ts` | `467174f4298ea29b177271c13de5d0ddbea18888f4002a7002b784322c886a0b` |
| `mcp-server/test/oauth-store.test.mjs` | `8f390fcdc2ca25d35e2841ac9d67a2e57e1126e227c2a62fa060f369d4c1e7d6` |
| `mcp-server/test/oauth-http.test.mjs` | `113fd84cf937c87a3df65615a565562e809a89dcf69c3a16d596d5e87b59a9a6` |
| `supabase/migrations/20261001142109_plugin_oauth_records.sql` | `fd03541378a09b10d4f54c5b948aa9aa9500d7dc871e76b36e6b42b73547d2e1` |

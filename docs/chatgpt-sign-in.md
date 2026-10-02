# Sign into ZeroBoard with ChatGPT

This is a disabled integration draft. Keep `VITE_CHATGPT_SIGN_IN_ENABLED=false` until the external registration and checks below pass. An application build or mocked login test does not establish that OpenAI sign-in works.

The intended path uses Supabase Auth's custom OIDC provider, `custom:chatgpt`, to issue the existing ZeroBoard session. Existing Supabase user IDs, board ownership and RLS remain the authorization boundary. This differs from the MCP connection: there, ZeroBoard issues authorization to a ChatGPT client; here, OpenAI supplies identity to ZeroBoard. It does not authorize ChatGPT-plan inference or conversation access. [OpenAI's integration choices and scope guidance](https://developers.openai.com/siwc/quickstart)

## Current readiness

Read-only production inspection on October 2, 2026 found:

- The Vercel production environment has no `VITE_CHATGPT_SIGN_IN_ENABLED` name. Only environment names were inspected; no values were printed or saved.
- Supabase project `lhupamtkfuntxwosogtz` has the custom-provider table, but no `custom:chatgpt` provider row. Only safe provider metadata and credential-presence booleans were queried.
- An approved OpenAI client, its authentication method, callback registration and real identity claims have not been verified. Global Supabase manual-linking and email-confirmation settings were not inspected.

No provider, environment setting or deployment was changed by this inspection.

## Obtain the appropriate OpenAI client

Commercial website sign-in is a limited trial for selected partners. Obtain an approved client through [OpenAI's client request process](https://developers.openai.com/siwc/request-client-id). Do not reuse Codex's client ID or the MCP client's registration.

OpenAI supports public and confidential clients. Its confidential website example uses `client_secret_basic` with PKCE. Supabase's documented custom-provider setup requires a client secret, and the current public Auth server validates that requirement. A public-only registration is therefore not a confirmed fit for this native path; never substitute a dummy secret. Verify that the approved registration and deployed Supabase token exchange use the provisioned method. Store the secret only in Supabase Auth's provider configuration. [OpenAI website authentication](https://developers.openai.com/siwc/website), [Supabase provider validation](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/api/custom_oauth_admin.go#L414)

## Resolve account linking before enabling

OpenAI requires a way to confirm and link an existing account; matching email alone is insufficient ownership proof. Supabase automatically links matching email identities during anonymous OAuth sign-in. The signed-in **Link ChatGPT account** action does not disable that automatic path. [OpenAI account resolution](https://developers.openai.com/siwc/website), [Supabase identity linking](https://supabase.com/docs/guides/auth/auth-identity-linking)

There is no documented per-provider automatic-linking switch in the reviewed native configuration. Current Auth source first resolves an existing provider/subject, then considers verified emails, including emails treated as verified by global email autoconfirm. Its experimental linking-domain configuration still performs email linking within a domain; it is not a verified hosted solution to this requirement. [Supabase's linking decision](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/models/linking.go)

A possible native configuration requests only `openid profile`, with `email_optional:true`, and requires people with existing boards to sign in through their existing method before linking ChatGPT from Account. This reduced-scope configuration needs OpenAI approval and actual-client verification. New identities may have no email address. Existing explicitly linked identities must resolve to the original Supabase user ID and retain its email and boards.

**Mandatory enforcement:** the upstream OpenAI client must prohibit the `email` scope and omit email claims from both ID tokens and UserInfo, including when someone directly requests additional scopes at Supabase's public authorize endpoint. Alternatively, establish a supported server-side claim/account-link policy that requires explicit confirmation. Supabase replaces configured default scopes when the caller supplies `scopes`; neither frontend scope selection nor provider defaults enforce a maximum. `email_optional:true` permits missing email but does not discard returned email. If this boundary cannot be verified, leave the provider and feature off. [Supabase scope handling and callback](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/api/external.go#L705)

## Conditional Supabase setup

After the linking boundary is resolved, create an **Auto-discovery (OIDC)** provider in Supabase Auth Providers using the approved client credentials:

| Setting | Required value or condition |
| --- | --- |
| Identifier | `custom:chatgpt` |
| Name | `ChatGPT` |
| Issuer | `https://auth.openai.com` |
| Discovery | `https://auth.openai.com/.well-known/openid-configuration` |
| Scopes | Proposed `openid profile`, subject to the mandatory upstream enforcement above |
| PKCE | `pkce_enabled:true`; keep S256 protection enabled |
| Nonce | `skip_nonce_check:false`; do not bypass nonce validation |
| Email | Proposed `email_optional:true`; do not map or invent verified email claims |

Supabase handles upstream state, PKCE and OIDC verification. Do not override its reserved transaction parameters or replace the existing application auth/storage configuration to work around a failed exchange. [Custom OAuth/OIDC provider setup](https://supabase.com/docs/guides/auth/custom-oauth-providers)

Copy the dashboard's read-only **Callback URL** into the OpenAI registration exactly. For this project's standard Supabase Auth hostname, it is:

```text
https://lhupamtkfuntxwosogtz.supabase.co/auth/v1/callback
```

Confirm the displayed value before registration: an Auth custom domain or external-URL override can change it. This is the OpenAI-to-Supabase callback. Separately, configure Supabase's allowed application redirects for ZeroBoard's canonical origin, `https://board.zeroclickdev.ai`, and the routes used by sign-in/linking. Test return to the initiating route, including connector state when applicable. Preview and local return URLs require deliberate allowlisting; do not use an unrestricted origin wildcard. [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls)

Review Supabase's email-confirmation configuration separately. Do not enable global `mailer_autoconfirm` to make this integration work: current server code allows that setting to both confirm an unverified provider email and treat it as eligible for automatic linking. Keep any existing email confirmation requirements and verify delivery for the existing sign-up flow. The optional-email proposal does not prove that email claims are absent. [Supabase external account confirmation](https://github.com/supabase/auth/blob/ce9a8eee0cc042be8c7a42981a7ddae631e41d91/internal/api/external.go#L410)

Enable supported manual identity linking in Supabase Auth and verify it with the deployed SDK/server. Link only from an authenticated ZeroBoard account using `linkIdentity` with the fixed provider. Show a conflict if the identity belongs to another user; do not merge boards or rewrite ownership by email. [Supabase manual linking](https://supabase.com/docs/reference/javascript/auth-linkidentity)

## Launch verification and opt-in

Use an explicitly configured test environment for the approved-client checks; keep production off while they are pending. Before setting the production Vite build flag to `true`, record these real results:

- Successful new-user sign-in, sign-out and subsequent sign-in resolve the same Supabase user ID.
- Explicit linking from an existing account preserves its ID, email, boards and RLS access, including when OpenAI has a different email.
- A direct authorize request asking for `email` cannot cause automatic account linking; returned ID-token and UserInfo claims satisfy the enforced policy.
- Cancellation, provider-disabled errors and identity conflicts produce feedback without a false success message.
- Missing/reused state, incorrect PKCE, invalid ID-token issuer/audience/signature/expiry and nonce mismatch are rejected by the deployed flow.
- App return URLs preserve the intended route without leaking provider tokens into diagnostics; no OpenAI client secret appears in browser assets or logs.
- Sign-in uses the approved OpenAI button format and branding. The current website guide illustrates logo-bearing formats; text alone should not be assumed approved.

After those checks, enable the provider and public build flag in the intended environment and rebuild. Keep them off if approval, authentication-method compatibility or linking enforcement remains unresolved. This guide records a conditional setup path, not a completed OpenAI end-to-end verification.

# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in ZeroClickBoards, please report it privately so we can address it before public disclosure.

**Do not open a public GitHub issue for security vulnerabilities.**

### How to Report

Send a report to the maintainer via one of these channels:

- Email the maintainer directly (find contact via the GitHub profile)
- Open a [GitHub Security Advisory](https://github.com/tmcfarlane/zeroclickboards/security/advisories/new) (preferred)

Please include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact (who is affected, what data is at risk)
- Any suggested mitigation

### What to Expect

- **Acknowledgement** within 3 business days
- **Initial assessment** within 7 days
- **Fix or mitigation plan** communicated as soon as feasible based on severity
- **Credit** in the release notes once a fix ships, if you'd like

## Scope

The following are in scope:

- The main application at [boards.zeroclickdev.ai](https://boards.zeroclickdev.ai)
- Code in this repository (frontend + `/api` serverless functions)
- Supabase schema, RLS policies, and database access patterns

Out of scope:

- Denial-of-service attacks against the hosted service
- Social engineering of maintainers or users
- Vulnerabilities in third-party services (Supabase, Vercel, Stripe) — report those upstream

## Supported Versions

Only the `main` branch is actively supported. Please ensure your report reproduces against the latest `main`.

## Safe Harbor

We will not pursue legal action against researchers who:

- Make a good-faith effort to avoid privacy violations, data destruction, and service disruption
- Report the vulnerability privately and give us reasonable time to respond
- Do not exploit the vulnerability beyond what is necessary to demonstrate it

Thank you for helping keep ZeroClickBoards and its users safe.

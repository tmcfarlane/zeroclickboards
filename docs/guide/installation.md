# Installation Guide

Setup instructions for ZeroClickBoards. Each step is tagged:

- **[automatable]** — an AI agent can do this for you (`npm install`, scaffolding files, running commands).
- **[dashboard]** — a human has to click around in Supabase / Google Cloud / Stripe. An agent can tell you what to click and which env var each value maps to, then wait while you edit `.env.local` yourself.
- **[MCP-automatable]** — normally [dashboard], but automatable if your agent has the relevant MCP server ([Supabase MCP](https://github.com/supabase-community/supabase-mcp), [Stripe MCP](https://github.com/stripe/agent-toolkit)) — keys stay inside the MCP boundary, not the chat.

> 🔒 **Keep secrets out of the chat.** For every dashboard step that produces an API key, service-role key, or webhook secret: **you** open `.env.local` and paste the value in, then tell the agent you're done. Don't paste secrets into the agent conversation — they get logged, cached, and potentially sent to the model provider.

If you'd rather hand this to an agent, paste the prompt from the [README](../../README.md#for-humans) into Claude Code, Cursor, Codex, or AmpCode.

## Contents

- [Prerequisites](#prerequisites)
- [Clone and Install](#clone-and-install)
- [1. Supabase](#1-supabase)
- [2. Environment Variables](#2-environment-variables)
- [3. Stripe Webhooks (Local Development)](#3-stripe-webhooks-local-development)
- [4. Run the App](#4-run-the-app)
- [Troubleshooting](#troubleshooting)

## Prerequisites

- **Node.js 18+** — [install via nvm](https://github.com/nvm-sh/nvm) or the [official installer](https://nodejs.org/)
- **npm** (ships with Node.js)
- A free [Supabase](https://supabase.com) account _(sign-up is **[dashboard]**)_
- _Optional:_ [Vercel CLI](https://vercel.com/docs/cli) for running API routes locally (`npm i -g vercel`)
- _Optional:_ [Stripe CLI](https://stripe.com/docs/stripe-cli) if you want to test payments locally
- _Optional:_ An AI provider API key (OpenAI, Anthropic, etc.) if you want the AI assistant

## Clone and Install

> **[automatable]**

```bash
git clone https://github.com/tmcfarlane/zeroclickboards.git
cd zeroclickboards
npm install
```

## 1. Supabase

### 1a. Create the project

> **[dashboard / MCP-automatable]**

Go to [supabase.com](https://supabase.com) and create a new project. _If your agent has the [Supabase MCP](https://github.com/supabase-community/supabase-mcp), it can do this for you — otherwise, sign in and click "New project" yourself._

Once the project is ready, open **Project Settings → API** and copy each value directly into your `.env.local` file. **Don't paste these into the agent chat** — they're secrets.

| Dashboard field       | Goes into `.env.local` as                                                  |
| --------------------- | -------------------------------------------------------------------------- |
| **Project URL**       | `VITE_SUPABASE_URL`                                                        |
| **anon / public key** | `VITE_SUPABASE_ANON_KEY`                                                   |
| **service_role key**  | `SUPABASE_SERVICE_ROLE_KEY` _(server-only — never expose this to the browser)_ |

Once you've saved the file, tell your agent "Supabase keys are in `.env.local`" and it can continue.

### 1b. Run the schema

> **[automatable with Supabase MCP or CLI; otherwise dashboard]**

Run the contents of [`supabase/schema.sql`](../../supabase/schema.sql) to create all tables, RLS policies, and realtime publications.

- **With Supabase MCP:** your agent can apply the migration directly.
- **With Supabase CLI:** `supabase db push` after linking the project.
- **Without either:** paste the file contents into Supabase dashboard → **SQL Editor** → **Run**.

### 1c. Enable auth providers

> **[dashboard]**

In Supabase → **Authentication → Providers**:

- Enable **Email / Password**
- Enable **Google** (optional but recommended — follow Supabase's [Google OAuth guide](https://supabase.com/docs/guides/auth/social-login/auth-google) to get your client ID and secret from Google Cloud Console)

_Google OAuth requires both Supabase dashboard clicks **and** a Google Cloud project. No MCP fully automates this today._

### 1d. Add redirect URLs

> **[dashboard]**

In Supabase → **Authentication → URL Configuration**, add **Redirect URLs**:

- `http://localhost:5173` (local dev)
- `http://localhost:3000` (if you use `vercel dev`)
- Your production URL (e.g. `https://yourdomain.com`)

## 2. Environment Variables

> **[scaffolding: automatable; filling values: you, in your editor]**

Your agent can scaffold the file:

```bash
cp .env.example .env.local
```

**You** fill in the values — don't dictate secrets to the agent. Open `.env.local` in your editor and paste keys directly as you collect them from the Supabase / Stripe dashboards.

| Variable                    | Scope  | Required | Description                                                                  |
| --------------------------- | ------ | -------- | ---------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | Client | ✅       | Supabase project URL                                                         |
| `VITE_SUPABASE_ANON_KEY`    | Client | ✅       | Supabase anon / public key                                                   |
| `SUPABASE_SERVICE_ROLE_KEY` | Server | ✅       | Service role key — used by API routes to bypass RLS where needed             |
| `AI_GATEWAY_API_KEY`        | Server | ⚠️       | AI provider API key — required only if you want the AI assistant             |
| `AI_GATEWAY_MODEL`          | Server | ⚠️       | Model name (e.g. `gpt-4o`, `claude-opus-4-6`)                                |
| `STRIPE_SECRET_KEY`         | Server | ⚠️       | Stripe secret key — required only if you want paid Pro plans                 |
| `STRIPE_PRICE_ID`           | Server | ⚠️       | Stripe price ID for the Pro plan                                             |
| `STRIPE_WEBHOOK_SECRET`     | Server | ⚠️       | Stripe webhook signing secret (see next section)                             |
| `VITE_GITHUB_REPO_URL`      | Client | ❌       | Optional — shows a GitHub link in the header                                 |

> **Never prefix sensitive keys with `VITE_`.** Any variable starting with `VITE_` is bundled into the client JavaScript and visible to anyone with browser devtools.

### Skipping optional features

- **No AI assistant?** Omit the `AI_GATEWAY_*` variables. The board works as a plain Kanban app without them.
- **No paid plans?** Omit the `STRIPE_*` variables. All users will get whatever limits you set in [`api/ai/usage.ts`](../../api/ai/usage.ts) (default: 5 AI queries/day).

## 3. Stripe Webhooks (Local Development)

> **[mostly automatable; `stripe login` is dashboard]**

Only needed if you're testing the Pro subscription flow locally. Skip entirely if you're not charging for anything.

Your agent can install the CLI and run `stripe listen`, but `stripe login` opens a browser for you to authorize the CLI — that part is on you.

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Other platforms: https://stripe.com/docs/stripe-cli#install

stripe login                                         # [dashboard — browser auth]
stripe listen --forward-to localhost:3000/api/stripe/webhook   # [automatable]
```

The `stripe listen` command prints a webhook signing secret that looks like `whsec_...`. **Copy it into `.env.local` yourself** as `STRIPE_WEBHOOK_SECRET` — don't paste it into the agent chat.

Keep `stripe listen` running in a separate terminal while you test checkout.

You'll also need:

- A **Stripe secret key** from **Developers → API keys** → paste into `.env.local` as `STRIPE_SECRET_KEY`.
- A **Pro plan Price** created in the Stripe dashboard (or via the [Stripe MCP](https://github.com/stripe/agent-toolkit)) → paste its ID into `STRIPE_PRICE_ID`.

Tell your agent "Stripe keys are in `.env.local`" when you're done.

## 4. Run the App

> **[automatable]**

You have two options:

### Option A — Vite only (UI, no API routes)

```bash
npm run dev
```

Opens on [http://localhost:5173](http://localhost:5173). Good for frontend work, but `/api/*` calls (AI assistant, Stripe) will fail.

### Option B — Vercel dev (UI + API routes)

```bash
# one-time
npm i -g vercel
vercel link        # link to a Vercel project, or create one

# every time
vercel dev
```

Opens on [http://localhost:3000](http://localhost:3000). This is what you want if you're working on the AI assistant, subscriptions, or anything that hits `/api/*`.

### Production build

```bash
npm run build      # emits to dist/
npm run preview    # serve the production build locally
```

## Troubleshooting

### "Missing Supabase environment variables"

Your `.env.local` isn't being picked up. Make sure:
- The file is named exactly `.env.local` (not `.env` or `env.local`)
- It's in the repo root (same directory as `package.json`)
- You restarted the dev server after editing it

### "Invalid API key" from Supabase

Double-check you copied the **anon / public** key (not the service_role key) for `VITE_SUPABASE_ANON_KEY`. Both start with `eyJ...` so it's easy to mix them up.

### Google OAuth redirects to `localhost` but fails

Make sure the exact URL (including protocol and port) is in your Supabase **Authentication → URL Configuration → Redirect URLs** list.

### AI assistant returns 402 / 429

That's the rate limiter. Check your daily usage in [`api/ai/usage.ts`](../../api/ai/usage.ts) — defaults are 5 queries/day for free users. Adjust or remove the limit if you want.

### `vercel dev` port conflict

By default Vercel tries port 3000. If it's taken:
```bash
vercel dev --listen 3001
```
Then update any Stripe CLI `--forward-to` URLs accordingly.

### Still stuck?

- Open a [GitHub issue](https://github.com/tmcfarlane/zeroclickboards/issues)
- Or paste the error into the "For Humans" agent prompt from the [README](../../README.md#for-humans) and let the agent debug it

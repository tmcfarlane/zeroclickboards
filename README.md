# ZeroBoard

Trello-like Kanban boards with:
- Google (Gmail) login + email/password login (Supabase Auth)
- Boards saved to your account (Supabase Postgres + RLS)
- Drag-and-drop columns/cards (@dnd-kit)
- Card labels, cover images, and archiving
- AI assistant powered by Vercel AI Gateway

## Tech

- Vite + React + TypeScript
- Tailwind + shadcn/ui
- Supabase (Auth + Database + Realtime)
- Vercel (hosting + serverless API for AI)

## Local Development

Prereqs:
- Node 18+
- A Supabase project

1) Install dependencies

```bash
npm install
```

2) Create the database schema

In Supabase: SQL Editor -> run `supabase/schema.sql`.

3) Configure Supabase Auth

In Supabase -> Authentication:
- Enable Email / Password
- Enable Google provider
- Add redirect URLs:
  - `http://localhost:5173`
  - Your Vercel production URL (after deploy)

4) Configure env

Copy `.env.example` to `.env.local` and fill:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_GITHUB_REPO_URL=
```

AI and Stripe are server-side via Vercel functions. For local testing, also add to `.env.local`:

```bash
AI_GATEWAY_API_KEY=
AI_GATEWAY_MODEL=gpt-5.2
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
```

5) Run

- UI only (no API routes):

```bash
npm run dev
```

- UI + local Vercel functions (required for AI assistant and Stripe checkout):

```bash
vercel dev
```

6) Stripe webhooks (local development)

Stripe webhooks need to be forwarded to your local server. In a separate terminal:

```bash
# Install the Stripe CLI: brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

The `stripe listen` command prints a webhook signing secret (`whsec_...`). Add it to your `.env.local` as `STRIPE_WEBHOOK_SECRET`.

## Deploy to Vercel

1) Import the repo in Vercel.

2) Set environment variables in Vercel (Project -> Settings -> Environment Variables):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_GATEWAY_API_KEY`
- `AI_GATEWAY_MODEL`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `VITE_GITHUB_REPO_URL` (optional)

3) Deploy.

Notes:
- `vercel.json` configures SPA rewrites while preserving `/api/*` routes.
- API routes live at `api/ai/command.ts` (AI), `api/ai/usage.ts` (usage tracking), and `api/stripe/*.ts` (payments).
- Free users get 5 AI queries/day (resets at midnight PT). Pro subscribers ($3/month) get unlimited.

## Open Source Link

The site header shows a GitHub icon when `VITE_GITHUB_REPO_URL` is set.

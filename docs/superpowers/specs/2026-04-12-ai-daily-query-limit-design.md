# AI Daily Query Limit — Design Spec

**Date**: 2026-04-12
**Status**: Approved

## Overview

Give free users 5 AI queries per day to try the AI assistant, with warnings at queries 3 and 4, and a hard gate at 5. Paid (Pro) subscribers get unlimited queries. All usage is logged for analytics.

## Decision Record

- **Limit model**: 5 queries/day, flat from day one (no first-week boost)
- **Reset time**: Midnight Pacific (America/Los_Angeles)
- **Warning behavior**: Warnings at query 3 (2 remaining) and query 4 (1 remaining), hard gate at 5
- **Tracking scope**: All users (free and paid), enforce only for free
- **Storage approach**: Dedicated `ai_usage` table (full audit trail)

---

## 1. Database — `ai_usage` Table

```sql
CREATE TABLE ai_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query_text TEXT,
  command_type TEXT,
  token_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_usage_user_created ON ai_usage(user_id, created_at DESC);

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage"
  ON ai_usage FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert"
  ON ai_usage FOR INSERT WITH CHECK (true);
```

**Daily count query**:

```sql
SELECT COUNT(*) FROM ai_usage
WHERE user_id = $1
AND created_at >= (current_date AT TIME ZONE 'America/Los_Angeles')::timestamptz
```

## 2. Backend — API Changes

### `/api/ai/command.ts` — Modified Flow

1. Authenticate user (existing)
2. Check subscription status (existing `hasActiveSubscription`)
3. If no active subscription, check daily usage count:
   - Count >= 5: Return `429` with `{ error: 'AI_DAILY_LIMIT_REACHED', usage: { used: 5, limit: 5 } }`
   - Count is 3 or 4: Proceed, flag `warning: true` in response
4. Call AI gateway (existing)
5. Log query to `ai_usage` table (all users, free and paid)
6. Return response with usage metadata:

```json
{
  "commands": [...],
  "usage": { "used": 3, "limit": 5, "warning": true }
}
```

Paid subscribers skip step 3 but still log in step 5. Their response includes `usage: { used: N, limit: null }`.

### New Endpoint: `GET /api/ai/usage.ts`

Returns current daily usage for the authenticated user:

```json
{
  "used": 3,
  "limit": 5,
  "resetsAt": "2026-04-13T07:00:00Z"
}
```

- `limit` is `null` for paid users
- `resetsAt` is the next midnight Pacific expressed in UTC
- Called on AI assistant mount to show current count

## 3. Frontend — `AIAssistant.tsx` Changes

### Usage Counter Display (free users only)

Subtle counter near the AI input: "3 of 5 AI queries remaining today". Neutral styling that shifts to warning colors as queries deplete.

### Warning Toasts

- **Query 3** (2 remaining): Amber/yellow toast — "You have 2 AI queries remaining today"
- **Query 4** (1 remaining): Orange/red toast — "Last AI query for today! Upgrade to Pro for unlimited"
- Both include a small "Upgrade" link

### Hard Gate at 5

- AI input disabled
- Placeholder replaced with "Daily limit reached — resets at midnight PT"
- Inline upgrade CTA: "Upgrade to Pro for unlimited AI queries" with button triggering existing Stripe checkout
- API 429 responses caught and mapped to the same gate UI

### Paid Users

No counter, no warnings, no gate. Same experience as today.

### Data Fetching

- Call `GET /api/ai/usage` on component mount via React Query
- After each AI query, update count optimistically from the response `usage` field

## 4. Stripe — Product Setup

- **Product**: "ZeroBoard Pro"
- **Price**: $3/month recurring
- Created via Stripe MCP server; price ID used in `/api/stripe/create-checkout.ts`

### Free vs. Paid Determination

No changes to the existing model:

- `hasActiveSubscription(userId)` queries `subscriptions` table for `status = 'active'`
- Free user = no active subscription row
- AI endpoint branches on this check: free users get limit enforcement, paid users don't

## Constants

| Constant | Value | Location |
|----------|-------|----------|
| `FREE_DAILY_AI_LIMIT` | `5` | Shared config |
| `AI_WARNING_THRESHOLD` | `3` | Shared config |
| `AI_RESET_TIMEZONE` | `America/Los_Angeles` | Backend |

## Error Codes

| Code | HTTP Status | Meaning |
|------|-------------|---------|
| `AI_DAILY_LIMIT_REACHED` | 429 | Free user exhausted daily queries |
| `AI_SUBSCRIPTION_REQUIRED` | 403 | Existing — not used after this change (replaced by limit logic) |

Note: After this change, `AI_SUBSCRIPTION_REQUIRED` (403) is no longer returned. Free users without a subscription now get the daily limit flow instead of a hard block.

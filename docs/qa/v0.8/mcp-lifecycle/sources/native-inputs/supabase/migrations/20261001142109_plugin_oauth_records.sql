-- Review before applying. Keep this schema outside the exposed Data API schemas.
create schema if not exists zeroboard_oauth;
revoke all on schema zeroboard_oauth from public, anon, authenticated;
create table if not exists zeroboard_oauth.records (
  kind text not null check (kind in ('pending','code','grant','token')),
  key text not null,
  value jsonb not null,
  expires_at timestamptz not null,
  primary key(kind,key)
);
alter table zeroboard_oauth.records enable row level security;
revoke all on zeroboard_oauth.records from public, anon, authenticated;
create index if not exists oauth_records_expiry on zeroboard_oauth.records(expires_at);
-- Deployment provisions a dedicated server DB role with only this schema/table
-- access and an appropriate backend-only RLS policy. No client API grants.
-- Schedule deletion of expired records; never store raw access/refresh tokens here.

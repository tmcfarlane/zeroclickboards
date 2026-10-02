-- Backend-only encrypted, short-lived account sessions. This schema is not exposed through PostgREST.
create table if not exists zeroboard_oauth.sessions (
  account_ref text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  encrypted_session text not null,
  expires_at timestamptz not null
);
alter table zeroboard_oauth.sessions enable row level security;
revoke all on zeroboard_oauth.sessions from public, anon, authenticated;
create index if not exists connector_sessions_expiry on zeroboard_oauth.sessions(expires_at);
create index if not exists connector_grants_user on zeroboard_oauth.records((value->>'userId')) where kind = 'grant';
-- Deployment grants SELECT/INSERT/UPDATE/DELETE and private-table RLS policies
-- only to a dedicated connector role; do not use browser/API roles or grant it board-table access.
-- Schedule deletion of expired rows from both private tables. Session ciphertext
-- contains the current user access token only; refresh tokens are never accepted or persisted.

-- A passwordless privilege role. Provision a distinct login server-side and grant
-- this role to it; never put its connection string into VITE_ variables.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'zeroboard_connector') then
    create role zeroboard_connector nologin nosuperuser nobypassrls;
  end if;
end $$;
grant usage on schema zeroboard_oauth to zeroboard_connector;
grant select,insert,update,delete on zeroboard_oauth.records,zeroboard_oauth.sessions to zeroboard_connector;
create policy connector_backend_records on zeroboard_oauth.records to zeroboard_connector using (true) with check (true);
create policy connector_backend_sessions on zeroboard_oauth.sessions to zeroboard_connector using (true) with check (true);

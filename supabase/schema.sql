create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.boards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  data jsonb not null default '{"columns": []}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.columns (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  "order" integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  column_id uuid not null references public.columns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  content jsonb,
  target_date date,
  labels text[],
  cover_image text,
  "order" integer not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.card_activities (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.cards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  data jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.boards enable row level security;
alter table public.columns enable row level security;
alter table public.cards enable row level security;
alter table public.card_activities enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "boards_select_own" on public.boards;
drop policy if exists "boards_insert_own" on public.boards;
drop policy if exists "boards_update_own" on public.boards;
drop policy if exists "boards_delete_own" on public.boards;

create policy "boards_select_own" on public.boards
  for select using (auth.uid() = user_id);

create policy "boards_insert_own" on public.boards
  for insert with check (auth.uid() = user_id);

create policy "boards_update_own" on public.boards
  for update using (auth.uid() = user_id);

create policy "boards_delete_own" on public.boards
  for delete using (auth.uid() = user_id);

drop policy if exists "columns_select_own" on public.columns;
drop policy if exists "columns_insert_own" on public.columns;
drop policy if exists "columns_update_own" on public.columns;
drop policy if exists "columns_delete_own" on public.columns;

create policy "columns_select_own" on public.columns
  for select using (auth.uid() = user_id);

create policy "columns_insert_own" on public.columns
  for insert with check (auth.uid() = user_id);

create policy "columns_update_own" on public.columns
  for update using (auth.uid() = user_id);

create policy "columns_delete_own" on public.columns
  for delete using (auth.uid() = user_id);

drop policy if exists "cards_select_own" on public.cards;
drop policy if exists "cards_insert_own" on public.cards;
drop policy if exists "cards_update_own" on public.cards;
drop policy if exists "cards_delete_own" on public.cards;

create policy "cards_select_own" on public.cards
  for select using (auth.uid() = user_id);

create policy "cards_insert_own" on public.cards
  for insert with check (auth.uid() = user_id);

create policy "cards_update_own" on public.cards
  for update using (auth.uid() = user_id);

create policy "cards_delete_own" on public.cards
  for delete using (auth.uid() = user_id);

drop policy if exists "card_activities_select_own" on public.card_activities;
drop policy if exists "card_activities_insert_own" on public.card_activities;

create policy "card_activities_select_own" on public.card_activities
  for select using (auth.uid() = user_id);

create policy "card_activities_insert_own" on public.card_activities
  for insert with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists boards_set_updated_at on public.boards;
create trigger boards_set_updated_at
before update on public.boards
for each row execute function public.set_updated_at();

drop trigger if exists cards_set_updated_at on public.cards;
create trigger cards_set_updated_at
before update on public.cards
for each row execute function public.set_updated_at();

-- Board sharing columns
alter table public.boards add column if not exists is_public boolean not null default false;
alter table public.boards add column if not exists embed_enabled boolean not null default false;

-- Stripe customer ID on profiles
alter table public.profiles add column if not exists stripe_customer_id text;

-- Board members table
create table if not exists public.board_members (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'viewer',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(board_id, user_id)
);

create index if not exists idx_board_members_board on public.board_members(board_id);
create index if not exists idx_board_members_user on public.board_members(user_id);

alter table public.board_members enable row level security;

-- Helper function to get board IDs for a user (SECURITY DEFINER bypasses RLS to avoid recursion)
create or replace function public.get_board_ids_for_user(p_user_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select board_id from public.board_members where user_id = p_user_id;
$$;

drop policy if exists "board_members_select" on public.board_members;
create policy "board_members_select" on public.board_members
  for select using (auth.uid() = user_id);

drop policy if exists "board_members_insert" on public.board_members;
create policy "board_members_insert" on public.board_members
  for insert with check (
    board_id IN (select id from public.boards where user_id = auth.uid())
  );

drop policy if exists "board_members_update" on public.board_members;
create policy "board_members_update" on public.board_members
  for update using (
    board_id IN (select id from public.boards where user_id = auth.uid())
  );

drop policy if exists "board_members_delete" on public.board_members;
create policy "board_members_delete" on public.board_members
  for delete using (
    board_id IN (select id from public.boards where user_id = auth.uid())
  );

-- Subscriptions table
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  status text not null default 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own" on public.subscriptions
  for select using (auth.uid() = user_id);

-- Feedback table
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  title text not null,
  description text not null,
  category text not null default 'feature',
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

drop policy if exists "feedback_insert_authenticated" on public.feedback;
create policy "feedback_insert_authenticated" on public.feedback
  for insert with check (auth.uid() is not null);

drop policy if exists "feedback_select_own" on public.feedback;
create policy "feedback_select_own" on public.feedback
  for select using (auth.uid() = user_id);

-- Updated board policies for sharing
drop policy if exists "boards_select_own" on public.boards;
create policy "boards_select_accessible" on public.boards
  for select using (
    auth.uid() = user_id
    OR id IN (select public.get_board_ids_for_user(auth.uid()))
    OR is_public = true
    OR embed_enabled = true
  );

drop policy if exists "boards_update_own" on public.boards;
create policy "boards_update_accessible" on public.boards
  for update using (
    auth.uid() = user_id
    OR id IN (select public.get_board_ids_for_user(auth.uid()))
  );

-- Updated columns policies for sharing
drop policy if exists "columns_select_own" on public.columns;
create policy "columns_select_accessible" on public.columns
  for select using (
    auth.uid() = user_id
    OR board_id IN (select public.get_board_ids_for_user(auth.uid()))
    OR board_id IN (select id from public.boards where is_public = true)
  );

-- Updated cards policies for sharing
drop policy if exists "cards_select_own" on public.cards;
create policy "cards_select_accessible" on public.cards
  for select using (
    auth.uid() = user_id
    OR board_id IN (select public.get_board_ids_for_user(auth.uid()))
    OR board_id IN (select id from public.boards where is_public = true)
  );

-- Allow authenticated users to search profiles by email (for inviting)
drop policy if exists "profiles_search_by_email" on public.profiles;
create policy "profiles_search_by_email" on public.profiles
  for select using (auth.uid() is not null);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.boards;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.columns;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.cards;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.card_activities;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- AI usage tracking table
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  query_text text,
  command_type text,
  token_count integer,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_usage_user_created on public.ai_usage(user_id, created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage_select_own" on public.ai_usage;
create policy "ai_usage_select_own" on public.ai_usage
  for select using (auth.uid() = user_id);

drop policy if exists "ai_usage_insert_service" on public.ai_usage;
create policy "ai_usage_insert_service" on public.ai_usage
  for insert with check (true);

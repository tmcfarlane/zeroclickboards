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

-- Review before applying: canonical cards/columns are in boards.data JSONB.
drop policy if exists "boards_update_accessible" on public.boards;
drop policy if exists "boards_update_own" on public.boards;
create policy "boards_update_accessible" on public.boards
  for update to authenticated
  using (auth.uid() = user_id OR id IN (select public.get_editable_board_ids_for_user(auth.uid())))
  with check (auth.uid() = user_id OR id IN (select public.get_editable_board_ids_for_user(auth.uid())));

-- Editors may update board content, but never transfer ownership or alter sharing.
create or replace function public.guard_board_access_fields()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is not null then
    if new.user_id is distinct from old.user_id then
      raise exception 'Board ownership cannot be transferred through a board update' using errcode = '42501';
    end if;
    if auth.uid() is distinct from old.user_id and
       (new.is_public is distinct from old.is_public OR new.embed_enabled is distinct from old.embed_enabled) then
      raise exception 'Only the owner can change board sharing' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists boards_guard_access_fields on public.boards;
create trigger boards_guard_access_fields before update on public.boards
for each row execute function public.guard_board_access_fields();

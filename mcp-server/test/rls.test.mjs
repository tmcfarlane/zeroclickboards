import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
const owner = '00000000-0000-0000-0000-000000000001';
const editor = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const stranger = '00000000-0000-0000-0000-000000000004';
test('actual migration: JSONB owner/editor writes; viewer, stranger, anonymous deny; sharing/ownership guard', async (t) => {
  const pg = new PGlite(); t.after(() => pg.close());
  await pg.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table boards (id uuid primary key, user_id uuid, data jsonb, is_public boolean default false, embed_enabled boolean default false);
    create table board_members (board_id uuid, user_id uuid, role text);
    create function get_editable_board_ids_for_user(p_user_id uuid) returns setof uuid language sql stable security definer set search_path = public
      as $$ select board_id from board_members where user_id = p_user_id and role = 'editor' $$;
    alter table boards enable row level security;
    create policy boards_select_accessible on boards for select using (true);
    create policy boards_update_accessible on boards for update using (true);
    grant select, update on boards to authenticated, anon;
    insert into boards values ('10000000-0000-0000-0000-000000000001', '${owner}', '{"columns":[]}', true, false);
    insert into board_members values ('10000000-0000-0000-0000-000000000001','${editor}','editor'), ('10000000-0000-0000-0000-000000000001','${viewer}','viewer');
  `);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  const file = (await readdir(migrations)).find((file) => file.endsWith('plugin_board_editor_enforcement.sql'));
  await pg.exec(await readFile(new URL(file, migrations), 'utf8'));
  for (const [user, role, count] of [[owner,'authenticated',1], [editor,'authenticated',1], [viewer,'authenticated',0], [stranger,'authenticated',0], ['', 'anon', 0]]) {
    await pg.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user}', false);`);
    const updated = await pg.query(`update boards set data = '{"columns":[{"cards":[]}]}' returning id`);
    assert.equal(updated.rows.length, count, `${role}/${user}`);
    await pg.exec('reset role');
  }
  await pg.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${editor}',false);`);
  await assert.rejects(pg.exec('update boards set is_public = false'), /Only the owner/);
  await assert.rejects(pg.exec(`update boards set user_id = '${editor}'`), /ownership cannot be transferred/);
  await pg.exec(`select set_config('request.jwt.claim.sub','${owner}',false);`);
  await pg.exec('update boards set is_public = false');
  await assert.rejects(pg.exec(`update boards set user_id = '${editor}'`), /ownership cannot be transferred/);
});

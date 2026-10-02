import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '00000000-0000-0000-0000-000000000001';
const editor = '00000000-0000-0000-0000-000000000002';
const viewer = '00000000-0000-0000-0000-000000000003';
const stranger = '00000000-0000-0000-0000-000000000004';
const commenter = '00000000-0000-0000-0000-000000000005';
const privateBoard = '10000000-0000-0000-0000-000000000001';
const publicBoard = '10000000-0000-0000-0000-000000000002';
const embeddedBoard = '10000000-0000-0000-0000-000000000003';
const migration = await readFile(new URL('../../supabase/migrations/20261001044235_plugin_board_editor_enforcement.sql', import.meta.url), 'utf8');

async function productionPolicyFixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  // Policy/helper/trigger shapes copied from a read-only production catalog audit.
  // No production connection or row data is used by this test.
  await pg.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    create table public.boards (
      id uuid primary key, user_id uuid not null, name text not null,
      description text, data jsonb not null default '{"columns":[]}',
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      is_public boolean not null default false, embed_enabled boolean not null default false
    );
    create table public.board_members (board_id uuid not null, user_id uuid not null, role text not null default 'viewer');
    create function public.get_board_ids_for_user(p_user_id uuid) returns setof uuid language sql stable security definer set search_path = public
      as $$ select board_id from public.board_members where user_id = p_user_id $$;
    create function public.get_editable_board_ids_for_user(p_user_id uuid) returns setof uuid language sql stable security definer set search_path = public
      as $$ select board_id from public.board_members where user_id = p_user_id and role = 'editor' $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
    create trigger boards_set_updated_at before update on public.boards for each row execute function public.set_updated_at();
    alter table public.boards enable row level security;
    alter table public.board_members enable row level security;
    create policy boards_select_accessible on public.boards for select to public
      using (auth.uid() = user_id OR id IN (select public.get_board_ids_for_user(auth.uid())) OR is_public = true OR embed_enabled = true);
    create policy boards_update_accessible on public.boards for update to public
      using (auth.uid() = user_id OR id IN (select public.get_board_ids_for_user(auth.uid())));
    create policy boards_insert_own on public.boards for insert to public with check (auth.uid() = user_id);
    create policy boards_delete_own on public.boards for delete to public using (auth.uid() = user_id);
    create policy board_members_select on public.board_members for select to public using (
      auth.uid() = user_id OR board_id IN (select id from public.boards where user_id = auth.uid())
      OR board_id IN (select public.get_board_ids_for_user(auth.uid()))
    );
    create policy board_members_insert on public.board_members for insert to public
      with check (board_id IN (select id from public.boards where user_id = auth.uid()));
    create policy board_members_update on public.board_members for update to public
      using (board_id IN (select id from public.boards where user_id = auth.uid()));
    create policy board_members_delete on public.board_members for delete to public
      using (board_id IN (select id from public.boards where user_id = auth.uid()));
    grant select, insert, update, delete on public.boards, public.board_members to authenticated, anon;
    insert into public.boards (id,user_id,name,updated_at,is_public,embed_enabled) values
      ('${privateBoard}','${owner}','Private fixture board','2000-01-01',false,false),
      ('${publicBoard}','${owner}','Public fixture board','2000-01-01',true,false),
      ('${embeddedBoard}','${owner}','Embedded fixture board','2000-01-01',false,true);
    insert into public.board_members values
      ('${privateBoard}','${editor}','editor'), ('${privateBoard}','${viewer}','viewer'), ('${privateBoard}','${commenter}','commenter');
  `);
  return pg;
}

async function asUser(pg, user, operation, role = 'authenticated') {
  await pg.exec(`set role ${role}; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try {
    return await operation();
  } finally {
    await pg.exec("reset role; select set_config('request.jwt.claim.sub', '', false);");
  }
}

async function rolledBack(pg, operation) {
  await pg.exec('begin');
  try {
    return await operation();
  } finally {
    await pg.exec('rollback');
  }
}

test('actual migration closes production viewer writes and preserves owner/editor content saves', async (t) => {
  const pg = await productionPolicyFixture(t);
  const before = await pg.query("select roles, qual, with_check from pg_policies where policyname = 'boards_update_accessible'");
  assert.deepEqual(before.rows[0].roles, ['public']);
  assert.equal(before.rows[0].with_check, null);
  assert.match(before.rows[0].qual, /get_board_ids_for_user/);

  // With no explicit WITH CHECK, PostgreSQL reuses USING. The all-member
  // helper is the vulnerability, including for updates to the resulting row.
  for (const user of [viewer, commenter]) {
    await asUser(pg, user, () => rolledBack(pg, async () => {
      const result = await pg.query(`update public.boards set data = '{"columns":[{"id":"unauthorized"}]}' where id = '${privateBoard}' returning id`);
      assert.equal(result.rows.length, 1, 'non-editor member could change content before migration');
      const accessChanged = await pg.query(`update public.boards set user_id = '${stranger}', is_public = true, embed_enabled = true where id = '${privateBoard}' returning id`);
      assert.equal(accessChanged.rows.length, 1, 'non-editor member could change ownership/sharing before migration');
    }));
  }

  await pg.exec(migration);
  // Reapplying the actual migration must leave one canonical policy/guard.
  await pg.exec(migration);
  const after = await pg.query("select roles, qual, with_check from pg_policies where tablename = 'boards' and cmd in ('UPDATE','ALL')");
  assert.equal(after.rows.length, 1);
  assert.deepEqual(after.rows[0].roles, ['authenticated']);
  assert.match(after.rows[0].qual, /get_editable_board_ids_for_user/);
  assert.equal(after.rows[0].with_check, after.rows[0].qual);
  const triggers = await pg.query("select tgname from pg_trigger where tgrelid = 'public.boards'::regclass and not tgisinternal order by tgname");
  assert.deepEqual(triggers.rows.map(({ tgname }) => tgname), ['boards_guard_access_fields', 'boards_set_updated_at']);

  for (const user of [owner, editor]) {
    await asUser(pg, user, async () => {
      const result = await pg.query(`update public.boards set name = 'Updated fixture board', description = 'Content edits stay allowed', data = '{"columns":[{"cards":[]}]}' where id = '${privateBoard}' returning name,description,data,updated_at,user_id,is_public,embed_enabled`);
      assert.equal(result.rows.length, 1, `${user} can save board content`);
      assert.deepEqual(result.rows[0].data, { columns: [{ cards: [] }] });
      assert.equal(result.rows[0].name, 'Updated fixture board');
      assert.equal(result.rows[0].description, 'Content edits stay allowed');
      assert.equal(result.rows[0].user_id, owner);
      assert.equal(result.rows[0].is_public, false);
      assert.equal(result.rows[0].embed_enabled, false);
      assert.ok(new Date(result.rows[0].updated_at) > new Date('2000-01-01'), 'existing timestamp trigger remains active');
    });
  }

  for (const [user, role, readable] of [[viewer, 'authenticated', 3], [commenter, 'authenticated', 3], [stranger, 'authenticated', 2], ['', 'anon', 2]]) {
    await asUser(pg, user, async () => {
      const visible = await pg.query('select id from public.boards');
      assert.equal(visible.rows.length, readable, 'existing member/public/embed SELECT access stays available');
      const denied = await pg.query("update public.boards set data = '{\"columns\":[{\"id\":\"denied\"}]}' returning id");
      assert.equal(denied.rows.length, 0, `${role}/${user} cannot update even readable boards`);
    }, role);
  }

  await asUser(pg, editor, async () => {
    for (const change of ['is_public = true', 'embed_enabled = true']) {
      await assert.rejects(pg.exec(`update public.boards set ${change} where id = '${privateBoard}'`), /Only the owner can change board sharing/);
    }
    await assert.rejects(pg.exec(`update public.boards set user_id = '${editor}' where id = '${privateBoard}'`), /ownership cannot be transferred/);
    const unchanged = await pg.query(`update public.boards set is_public = is_public, embed_enabled = embed_enabled, user_id = user_id where id = '${privateBoard}' returning id`);
    assert.equal(unchanged.rows.length, 1, 'including unchanged access fields in an editor save is allowed');
    const escalate = await pg.query(`update public.board_members set role = 'editor' where board_id = '${privateBoard}' and user_id = '${viewer}' returning role`);
    assert.equal(escalate.rows.length, 0, 'editor cannot upgrade viewer membership');
  });

  await asUser(pg, owner, async () => {
    const sharing = await pg.query(`update public.boards set is_public = true, embed_enabled = true where id = '${privateBoard}' returning is_public,embed_enabled`);
    assert.deepEqual(sharing.rows, [{ is_public: true, embed_enabled: true }]);
    await assert.rejects(pg.exec(`update public.boards set user_id = '${editor}' where id = '${privateBoard}'`), /ownership cannot be transferred/);
  });
});

test('another permissive UPDATE or ALL policy would bypass editor enforcement', async (t) => {
  const pg = await productionPolicyFixture(t);
  await pg.exec(migration);
  // Deployment preflight must inspect all policies, not just the canonical name.
  for (const command of ['update', 'all']) {
    await pg.exec(`create policy additional_member_access on public.boards for ${command} to authenticated using (id IN (select public.get_board_ids_for_user(auth.uid())))`);
    await asUser(pg, viewer, async () => {
      const result = await pg.query(`update public.boards set data = '{"columns":[]}' where id = '${privateBoard}' returning id`);
      assert.equal(result.rows.length, 1, `additional permissive ${command} policy allows viewer writes`);
    });
    await pg.exec('drop policy additional_member_access on public.boards');
  }
});

test('migration requires the editable-membership helper and sharing columns', async (t) => {
  const pg = await productionPolicyFixture(t);
  await rolledBack(pg, async () => {
    await pg.exec('drop function public.get_editable_board_ids_for_user(uuid)');
    await assert.rejects(pg.exec(migration), /get_editable_board_ids_for_user/);
  });
  // PL/pgSQL accepts the function definition even when a referenced row field
  // is missing; schema preflight must check fields before a production apply.
  await pg.exec('alter table public.boards drop column embed_enabled cascade');
  await pg.exec(`create policy boards_select_accessible on public.boards for select to public
    using (auth.uid() = user_id OR id IN (select public.get_board_ids_for_user(auth.uid())) OR is_public = true)`);
  await pg.exec(migration);
  await asUser(pg, editor, async () => {
    await assert.rejects(pg.exec(`update public.boards set name = 'Fixture update' where id = '${privateBoard}'`), /embed_enabled/);
  });
});

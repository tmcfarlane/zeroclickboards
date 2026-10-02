import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../../supabase/migrations/20261002055310_restrict_definer_function_execution.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-0000-0000-000000000001';
const invitee = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
const board = '10000000-0000-0000-0000-000000000001';
const login = 'zeroboard_connector_fixture_login';

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  // Function bodies, ACLs and installed trigger shapes come from a read-only
  // production catalog audit. All accounts, invitations and rows are local.
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create role ${login} login nosuperuser nobypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
    $$;
    grant usage on schema auth to authenticated, anon;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}');
    create table public.profiles (id uuid primary key, email text, full_name text, avatar_url text, plan text, xp_total integer, streak_days integer);
    create table public.boards (id uuid primary key, user_id uuid not null);
    create table public.board_members (board_id uuid not null, user_id uuid not null, role text not null, invited_by uuid, primary key (board_id,user_id));
    create table public.board_invites (board_id uuid not null, email text not null, role text not null, invited_by uuid);
    create table public.user_settings (id uuid primary key, email text);
    create function public.resolve_pending_invites(p_user_id uuid, p_email text) returns void language plpgsql security definer set search_path = public as $$
    begin
      insert into public.board_members (board_id,user_id,role,invited_by)
      select board_id,p_user_id,role,invited_by from public.board_invites where lower(email)=lower(p_email)
      on conflict (board_id,user_id) do nothing;
      delete from public.board_invites where lower(email)=lower(p_email);
    end;
    $$;
    create function public.resolve_pending_invites_for_current_user() returns void language plpgsql security definer set search_path = public as $$
    declare v_email text;
    begin
      select email into v_email from auth.users where id=auth.uid();
      if v_email is not null then perform public.resolve_pending_invites(auth.uid(),v_email); end if;
    end;
    $$;
    create function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path = public as $$
    begin
      insert into public.profiles (id,email,full_name,avatar_url,plan,xp_total,streak_days)
      values (new.id,new.email,new.raw_user_meta_data->>'full_name',new.raw_user_meta_data->>'avatar_url','starter',0,0)
      on conflict (id) do update set email=excluded.email,
        full_name=coalesce(excluded.full_name,profiles.full_name),avatar_url=coalesce(excluded.avatar_url,profiles.avatar_url);
      perform public.resolve_pending_invites(new.id,new.email);
      return new;
    end;
    $$;
    create function public.sync_user_email() returns trigger language plpgsql security definer as $$
    begin
      if new.email is null then select email into new.email from auth.users where id=new.id; end if;
      return new;
    end;
    $$;
    create function public.get_board_ids_for_user(p_user_id uuid) returns setof uuid language sql stable security definer set search_path=public as $$
      select board_id from public.board_members where user_id=p_user_id
    $$;
    create function public.get_editable_board_ids_for_user(p_user_id uuid) returns setof uuid language sql stable security definer set search_path=public as $$
      select board_id from public.board_members where user_id=p_user_id and role='editor'
    $$;
    grant execute on function public.resolve_pending_invites(uuid,text),public.resolve_pending_invites_for_current_user(),
      public.handle_new_auth_user(),public.sync_user_email(),public.get_board_ids_for_user(uuid),public.get_editable_board_ids_for_user(uuid)
      to anon,authenticated,service_role;
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();
    create trigger sync_user_email_trigger before insert or update on public.user_settings for each row execute function public.sync_user_email();
    alter table public.boards enable row level security;
    create policy boards_select_accessible on public.boards for select to public using (
      auth.uid()=user_id or id in (select public.get_board_ids_for_user(auth.uid())));
    grant select on public.boards to authenticated,anon;
    alter table public.user_settings enable row level security;
    create policy settings_own on public.user_settings to authenticated using (id=auth.uid()) with check (id=auth.uid());
    grant select,insert,update on public.user_settings to authenticated;
    insert into auth.users (id,email) values ('${owner}','owner@fixture.invalid'),('${invitee}','invited@fixture.invalid'),('${other}','other@fixture.invalid');
    insert into public.boards values ('${board}','${owner}');
    insert into public.board_invites values ('${board}','INVITED@fixture.invalid','editor','${owner}');
  `);
  return pg;
}

async function asRole(pg, role, user, operation) {
  await pg.exec(`set role ${role}; select set_config('request.jwt.claim.sub','${user}',false);`);
  try {
    const result = await operation();
    await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false);");
    return result;
  } catch (error) {
    // Preserve the original failure inside an aborted transaction; the outer
    // rollback also restores its SET ROLE and claim changes.
    await pg.exec("reset role; select set_config('request.jwt.claim.sub','',false);").catch(() => {});
    throw error;
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

test('production PUBLIC execution permits direct, forged-session and temporary-trigger paths before migration', async (t) => {
  const pg = await fixture(t);
  assert.equal((await pg.query(`select has_database_privilege('${login}',current_database(),'TEMPORARY') as allowed`)).rows[0].allowed,true);
  assert.equal((await pg.query(`select has_table_privilege('${login}','public.board_members','INSERT') as allowed`)).rows[0].allowed,false);

  for (const role of [login,'anon','authenticated']) {
    await rolledBack(pg, async () => {
      await asRole(pg,role,'',() => pg.exec(`select public.resolve_pending_invites('${other}','invited@fixture.invalid')`));
      assert.deepEqual((await pg.query('select user_id from public.board_members')).rows,[{ user_id: other }]);
    });
  }
  await rolledBack(pg, async () => {
    await asRole(pg,login,invitee,() => pg.exec('select public.resolve_pending_invites_for_current_user()'));
    assert.deepEqual((await pg.query('select user_id from public.board_members')).rows,[{ user_id: invitee }]);
  });
  await rolledBack(pg, async () => {
    await asRole(pg,login,'',() => pg.exec(`
      create temporary table fake_signup (id uuid,email text,raw_user_meta_data jsonb);
      create trigger attach_signup after insert on fake_signup for each row execute function public.handle_new_auth_user();
      insert into fake_signup values ('${other}','invited@fixture.invalid','{"full_name":"Spoofed fixture profile"}');
    `));
    assert.deepEqual((await pg.query('select user_id from public.board_members')).rows,[{ user_id: other }]);
    assert.equal((await pg.query(`select email from public.profiles where id='${other}'`)).rows[0].email,'invited@fixture.invalid');
  });
  await rolledBack(pg, async () => {
    const result = await asRole(pg,login,'',async () => {
      await pg.exec(`create temporary table fake_settings (id uuid,email text);
        create trigger attach_email before insert on fake_settings for each row execute function public.sync_user_email();`);
      return pg.query(`insert into fake_settings values ('${invitee}',null) returning email`);
    });
    assert.equal(result.rows[0].email,'invited@fixture.invalid');
  });
});

test('actual migration is repeatable and removes inherited execution without removing intended RLS grants', async (t) => {
  const pg = await fixture(t);
  await pg.exec(migration);
  await pg.exec(migration);
  const functions = ['resolve_pending_invites(uuid,text)','resolve_pending_invites_for_current_user()',
    'handle_new_auth_user()','sync_user_email()','get_board_ids_for_user(uuid)','get_editable_board_ids_for_user(uuid)'];
  for (const fn of functions) {
    assert.equal((await pg.query(`select has_function_privilege('${login}','public.${fn}','EXECUTE') as allowed`)).rows[0].allowed,false,fn);
  }
  for (const role of [login,'anon','authenticated']) {
    await asRole(pg,role,'',async () => {
      await assert.rejects(pg.exec(`select public.resolve_pending_invites('${other}','invited@fixture.invalid')`),/permission denied for function resolve_pending_invites/);
    });
  }
  for (const role of [login,'anon','service_role']) {
    await asRole(pg,role,invitee,async () => {
      await assert.rejects(pg.exec('select public.resolve_pending_invites_for_current_user()'),/permission denied for function resolve_pending_invites_for_current_user/);
    });
  }
  for (const role of [login,'anon','authenticated','service_role']) {
    await asRole(pg,role,'',async () => {
      await pg.exec('create temporary table denied_signup (id uuid,email text,raw_user_meta_data jsonb); create temporary table denied_settings (id uuid,email text);');
      await assert.rejects(pg.exec('create trigger denied_signup after insert on denied_signup for each row execute function public.handle_new_auth_user()'),/permission denied for function (public\.)?handle_new_auth_user/);
      await assert.rejects(pg.exec('create trigger denied_email before insert on denied_settings for each row execute function public.sync_user_email()'),/permission denied for function (public\.)?sync_user_email/);
      await pg.exec('drop table denied_signup,denied_settings');
    });
  }
  assert.equal((await pg.query('select count(*)::integer as count from public.board_invites')).rows[0].count,1);
  assert.equal((await pg.query('select count(*)::integer as count from public.board_members')).rows[0].count,0);
  for (const role of ['anon','authenticated','service_role']) {
    for (const fn of ['get_board_ids_for_user(uuid)','get_editable_board_ids_for_user(uuid)']) {
      assert.equal((await pg.query(`select has_function_privilege('${role}','public.${fn}','EXECUTE') as allowed`)).rows[0].allowed,true);
    }
  }
  await asRole(pg,'authenticated',other,() => pg.exec('select public.resolve_pending_invites_for_current_user()'));
  assert.equal((await pg.query('select count(*)::integer as count from public.board_invites')).rows[0].count,1,'wrapper only resolves current user email');
  await asRole(pg,'authenticated',invitee,() => pg.exec('select public.resolve_pending_invites_for_current_user()'));
  assert.deepEqual((await pg.query('select user_id,role from public.board_members')).rows,[{ user_id: invitee,role: 'editor' }]);
  const readable = await asRole(pg,'authenticated',invitee,() => pg.query('select id from public.boards'));
  assert.deepEqual(readable.rows,[{ id: board }]);
  const anonymous = await asRole(pg,'anon','',() => pg.query('select id from public.boards'));
  assert.deepEqual(anonymous.rows,[],'anonymous RLS can still call explicit-grant helper');
  await pg.exec(`insert into public.board_invites values ('${board}','other@fixture.invalid','viewer','${owner}');`);
  await asRole(pg,'service_role','',() => pg.exec(`select public.resolve_pending_invites('${other}','other@fixture.invalid')`));
  assert.equal((await pg.query(`select role from public.board_members where user_id='${other}'`)).rows[0].role,'viewer');
});

test('installed signup and settings triggers still execute after caller privileges are revoked', async (t) => {
  const pg = await fixture(t);
  await pg.exec(migration);
  const signup = '00000000-0000-0000-0000-000000000004';
  await pg.exec(`
    insert into public.board_invites values ('${board}','signup@fixture.invalid','editor','${owner}');
    insert into auth.users (id,email,raw_user_meta_data) values ('${signup}','signup@fixture.invalid','{"full_name":"Fixture Signup"}');
  `);
  assert.deepEqual((await pg.query(`select email,full_name from public.profiles where id='${signup}'`)).rows,[{ email: 'signup@fixture.invalid',full_name: 'Fixture Signup' }]);
  assert.deepEqual((await pg.query(`select user_id,role from public.board_members where user_id='${signup}'`)).rows,[{ user_id: signup,role: 'editor' }]);
  const settings = await asRole(pg,'authenticated',signup,() => pg.query(`insert into public.user_settings (id) values ('${signup}') returning email`));
  assert.deepEqual(settings.rows,[{ email: 'signup@fixture.invalid' }]);
  const updated = await asRole(pg,'authenticated',signup,() => pg.query(`update public.user_settings set email=null where id='${signup}' returning email`));
  assert.deepEqual(updated.rows,[{ email: 'signup@fixture.invalid' }]);
});

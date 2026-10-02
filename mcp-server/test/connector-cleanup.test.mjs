import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const directory = new URL('../../supabase/migrations/', import.meta.url);
const migration = await readFile(new URL('20261002060649_connector_expiry_cleanup.sql', directory), 'utf8');
// PGlite cannot load the native pg_cron worker. A local schedule registry
// captures the actual migration command, which these tests execute in Postgres.
// Production must separately confirm an actual successful scheduled run.
const scheduleSql = migration.replace(/create extension if not exists pg_cron with schema pg_catalog;/i, '');
assert.notEqual(scheduleSql, migration, 'only the native extension installation is omitted locally');
const user = '11111111-1111-4111-8111-111111111111';

async function fixture(t) {
  const pg = new PGlite();
  t.after(() => pg.close());
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${user}');`);
  for (const file of ['20261001142109_plugin_oauth_records.sql', '20261002030041_plugin_connector_vault.sql']) {
    await pg.exec(await readFile(new URL(file, directory), 'utf8'));
  }
  await pg.exec(`
    create role zeroboard_cleanup_login login nosuperuser nobypassrls;
    grant zeroboard_connector to zeroboard_cleanup_login;
    create schema cron;
    create table cron.job (
      jobid bigserial primary key, jobname text not null, schedule text not null,
      command text not null, username name not null default current_user,
      database name not null default current_database(), active boolean not null default true,
      unique(jobname,username)
    );
    create table cron.job_run_details (runid bigint primary key,jobid bigint not null,end_time timestamptz);
    create function cron.schedule(job_name text,job_schedule text,job_command text) returns bigint language plpgsql as $$
    declare result bigint;
    begin
      insert into cron.job (jobname,schedule,command) values (job_name,job_schedule,job_command)
      on conflict(jobname,username) do update set schedule=excluded.schedule,command=excluded.command
      returning jobid into result;
      return result;
    end;
    $$;
  `);
  return pg;
}

async function seedExpiryRows(pg) {
  for (const kind of ['pending', 'code', 'grant', 'token']) {
    await pg.query(`insert into zeroboard_oauth.records(kind,key,value,expires_at) values
      ($1,'expired','{"fixture":true}',now()-interval '1 minute'),
      ($1,'boundary','{"fixture":true}',now()),
      ($1,'active','{"fixture":true}',now()+interval '10 minutes')`, [kind]);
  }
  await pg.query(`insert into zeroboard_oauth.sessions(account_ref,user_id,encrypted_session,expires_at) values
    ('expired',$1,'fixture-ciphertext',now()-interval '1 minute'),
    ('boundary',$1,'fixture-ciphertext',now()),
    ('active',$1,'fixture-ciphertext',now()+interval '10 minutes')`, [user]);
}

test('actual migration captures one bounded named job and grants no scheduler access', async (t) => {
  const pg = await fixture(t);
  await pg.exec(scheduleSql);
  const before = (await pg.query("select * from cron.job where jobname='zeroboard-connector-expiry'")).rows[0];
  await pg.exec(scheduleSql);
  const jobs = (await pg.query('select * from cron.job')).rows;
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].jobid, before.jobid, 'same owner and name replace the job rather than duplicating');
  assert.equal(jobs[0].username, 'postgres');
  assert.equal(jobs[0].database, (await pg.query('select current_database() as name')).rows[0].name);
  assert.equal(jobs[0].schedule, '*/5 * * * *');
  assert.equal(jobs[0].active, true);
  assert.match(jobs[0].command, /lock_timeout\s*=\s*'2s'/);
  assert.match(jobs[0].command, /statement_timeout\s*=\s*'30s'/);
  for (const role of ['zeroboard_cleanup_login', 'anon', 'authenticated']) {
    assert.equal((await pg.query(`select has_schema_privilege('${role}','cron','USAGE') as allowed`)).rows[0].allowed, false);
    await pg.exec(`set role ${role}`);
    await assert.rejects(pg.exec("select cron.schedule('not-allowed','* * * * *','select 1')"), /permission denied for schema cron/);
    await pg.exec('reset role');
  }
});

test('actual job SQL expires every record kind and vault row while retaining active data and other jobs history', async (t) => {
  const pg = await fixture(t);
  await seedExpiryRows(pg);
  await pg.exec(scheduleSql);
  const job = (await pg.query("select * from cron.job where jobname='zeroboard-connector-expiry'")).rows[0];
  await pg.exec(`insert into cron.job(jobname,schedule,command) values ('shared-fixture','* * * * *','select 1');
    insert into cron.job(jobname,schedule,command,username) values ('zeroboard-connector-expiry','* * * * *','select 1','other_fixture_owner');`);
  await pg.query(`insert into cron.job_run_details(runid,jobid,end_time) values
    (1,$1,now()-interval '8 days'),(2,$1,now()-interval '1 day'),(3,$1,null)`, [job.jobid]);
  await pg.exec(`insert into cron.job_run_details(runid,jobid,end_time)
    select case when jobname='shared-fixture' then 4 else 5 end,jobid,now()-interval '8 days'
    from cron.job where jobname='shared-fixture' or username='other_fixture_owner';`);
  await pg.exec(job.command);
  const records = (await pg.query('select kind,key from zeroboard_oauth.records order by kind')).rows;
  assert.deepEqual(records, ['code', 'grant', 'pending', 'token'].map(kind => ({ kind, key: 'active' })));
  assert.deepEqual((await pg.query('select account_ref from zeroboard_oauth.sessions')).rows, [{ account_ref: 'active' }]);
  assert.deepEqual((await pg.query('select runid from cron.job_run_details order by runid')).rows.map(row => row.runid), [2, 3, 4, 5]);
  assert.equal((await pg.query('select count(*)::integer as count from cron.job')).rows[0].count, 3);
  // Repeated cleanup is harmless and preserves the remaining active fixtures.
  await pg.exec(job.command);
  assert.equal((await pg.query('select count(*)::integer as count from zeroboard_oauth.records')).rows[0].count, 4);
});

test('the job transaction rolls back prior deletions when a later cleanup step fails', async (t) => {
  const pg = await fixture(t);
  await seedExpiryRows(pg);
  await pg.exec(scheduleSql);
  const command = (await pg.query('select command from cron.job')).rows[0].command;
  await pg.exec('alter table zeroboard_oauth.sessions rename column expires_at to missing_fixture_field');
  await assert.rejects(pg.exec(command), /expires_at.*does not exist/);
  await pg.exec('rollback');
  assert.equal((await pg.query('select count(*)::integer as count from zeroboard_oauth.records')).rows[0].count, 12);
  assert.equal((await pg.query('select count(*)::integer as count from zeroboard_oauth.sessions')).rows[0].count, 3);
});

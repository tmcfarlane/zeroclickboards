-- Private storage and the dedicated privilege role must already be provisioned.
-- The administrator owns this job; connector/browser roles get no cron access.
create extension if not exists pg_cron with schema pg_catalog;

-- A stable name updates this owner's existing job instead of duplicating it.
-- Indexes on both expires_at columns keep the short-lived storage bounded.
select cron.schedule(
  'zeroboard-connector-expiry',
  '*/5 * * * *',
  $job$
    begin;
    set local lock_timeout = '2s';
    set local statement_timeout = '30s';
    delete from zeroboard_oauth.records where expires_at <= now();
    delete from zeroboard_oauth.sessions where expires_at <= now();
    -- Keep this job's recent diagnostics without changing other jobs' history.
    delete from cron.job_run_details
      where jobid in (
        select jobid from cron.job
        where jobname = 'zeroboard-connector-expiry' and username = current_user
      ) and end_time < now() - interval '7 days';
    commit;
  $job$
);

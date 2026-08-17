-- Enables pg_cron and registers a periodic job that drains the fsm dispatch
-- queue via fsm_core.schedule_all_pending() on a 5s interval, replacing the
-- standing fsmscheduler TS process's near-instant pg_notify dispatch with a
-- short periodic sweep. See spec-003-pgcron-fsm-scheduler.md (Option C) —
-- verified locally against pg_cron 1.6, which supports the sub-minute
-- ('N seconds') schedule syntax used below.
--
-- Interval and stale threshold are changeable without a code deploy, e.g.:
--   SELECT cron.alter_job(
--     (SELECT jobid FROM cron.job WHERE jobname = 'fsm_schedule_all_pending'),
--     schedule => '10 seconds'
--   );
--
-- Job run history (successes and failures) is queryable via the built-in
-- cron.job_run_details table; wiring that into ops-facing alerting is out of
-- scope for this migration.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- cron.schedule() errors on a duplicate jobname (unique per jobname+username),
-- so unschedule any pre-existing job with this name before re-registering —
-- keeps this file safe to apply more than once.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fsm_schedule_all_pending') THEN
    PERFORM cron.unschedule('fsm_schedule_all_pending');
  END IF;
END;
$$;

SELECT cron.schedule(
  'fsm_schedule_all_pending',
  '5 seconds',
  $$SELECT fsm_core.schedule_all_pending();$$
);

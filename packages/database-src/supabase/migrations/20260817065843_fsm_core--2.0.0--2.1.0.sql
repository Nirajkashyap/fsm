create extension if not exists "pg_cron" with schema "pg_catalog";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION fsm_core.schedule_all_pending(input_stale_threshold_seconds integer DEFAULT 30)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  WHILE fsm_core.schedule_next_pending(input_stale_threshold_seconds) LOOP
    NULL;
  END LOOP;
END;
$function$
;

-- migra's structural diff only picks up DDL (the extension + function
-- above) — cron.schedule() is a data-level side effect (a row insert into
-- cron.job), so it has to be added by hand. Kept in sync with
-- supabase/schemas/35_fsm_sync_operation_worker_v1/20260817065414_fsm_schedule_all_pending_pg_cron_job.sql.
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



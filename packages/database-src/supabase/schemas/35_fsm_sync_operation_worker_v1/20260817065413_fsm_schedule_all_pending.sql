-- fsm_core.schedule_all_pending
-- Drains the fsm dispatch queue: calls schedule_next_pending() repeatedly
-- until it returns false (queue empty or no capable fsmlet remains),
-- mirroring the TS fsmscheduler's runCycle loop. Intended as the command a
-- pg_cron job invokes on a fixed interval (see the migration that registers
-- the job) — see spec-003-pgcron-fsm-scheduler.md.

CREATE OR REPLACE FUNCTION fsm_core.schedule_all_pending(
  input_stale_threshold_seconds int DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  WHILE fsm_core.schedule_next_pending(input_stale_threshold_seconds) LOOP
    NULL;
  END LOOP;
END;
$$;

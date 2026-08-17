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



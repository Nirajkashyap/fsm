-- Shared queue-naming logic for the promise-actor identity -> PGMQ queue
-- name mapping used by both ensure_promise_queue_for_worker_v2 (this file)
-- and claim_pending_promise_events_for_workers_v2
-- (20260806173833_claim_pending_promise_events_for_workers.sql) -- factored
-- out so the two functions can't drift out of sync on the naming rule,
-- which has already changed twice.
--
-- fsm_type is shortened to its first character (e.g. "internalAsyncOperation"
-- -> "i") in all cases, and, specifically when fsm_type =
-- 'internalAsyncOperation', two further reductions to help fit PGMQ's length
-- limit (see below): fsm_version is dropped entirely, and fsm_language is
-- also shortened to its first character.
--
--   fsm_type = 'internalAsyncOperation':
--     <parentFsmName>_<parentFsmVersion>_<fsmType[0]>_<fsmName>_<fsmLanguage[0]>
--   otherwise (e.g. 'sharedAsyncOperation'):
--     <parentFsmName>_<parentFsmVersion>_<fsmType[0]>_<fsmName>_<fsmVersion>_<fsmLanguage>
--
-- unlike the existing 'sharedPromise_<fsmName>_<fsmVersion>' convention (see
-- archive_from_fsm_instance_worker_v2.sql), this one is unique per actor
-- identity including language, matching sidecar/protocol.ts's actorKey() --
-- two workers of different languages serving the "same" actor never share a
-- queue (in the fsm_type = 'internalAsyncOperation' case, this still holds
-- since fsm_language is shortened, not dropped -- two languages sharing the
-- same first letter would collide, but none do among
-- typescript/python/rust/go today: t/p/r/g).
--
-- PGMQ caps queue names at 48 characters -- see CLI-USAGE.md's note on this
-- limit. Still not guaranteed to fit for long parentFsmName/fsmName
-- combinations even with these reductions.
CREATE OR REPLACE FUNCTION fsm_core.compute_promise_queue_name_v2(
    input_parent_fsm_name text,
    input_parent_fsm_version text,
    input_fsm_type text,
    input_fsm_name text,
    input_fsm_version text,
    input_fsm_language text
)
RETURNS text
AS $$
BEGIN
    IF input_fsm_type = 'internalAsyncOperation' THEN
        RETURN input_parent_fsm_name || '_' || input_parent_fsm_version
            || '_' || LEFT(input_fsm_type, 1) || '_' || input_fsm_name || '_'
            || LEFT(input_fsm_language, 1);
    ELSE
        RETURN input_parent_fsm_name || '_' || input_parent_fsm_version
            || '_' || LEFT(input_fsm_type, 1) || '_' || input_fsm_name || '_'
            || input_fsm_version || '_' || input_fsm_language;
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Ensures a PGMQ queue exists for a promise-actor identity, called when
-- fsm-core-async-op-worker's SidecarGateway registers a worker (see
-- ensureQueueOnRegister in gatewayServer.ts / GOAL.md).
--
-- pgmq.create() is already fully idempotent (CREATE TABLE/INDEX IF NOT
-- EXISTS, INSERT ... ON CONFLICT DO NOTHING internally -- see
-- pgmq.create_non_partitioned()), so the only reason this function checks
-- pgmq.meta first is to report whether it already existed, not for
-- correctness -- concurrent calls for the same queue name are already safe
-- without this function's own check.
CREATE OR REPLACE FUNCTION fsm_core.ensure_promise_queue_for_worker_v2(
    input_parent_fsm_name text,
    input_parent_fsm_version text,
    input_fsm_type text,
    input_fsm_name text,
    input_fsm_version text,
    input_fsm_language text
)
RETURNS jsonb
AS $$
DECLARE
    computed_queue_name text;
    already_existed boolean;
BEGIN
    computed_queue_name := fsm_core.compute_promise_queue_name_v2(
        input_parent_fsm_name, input_parent_fsm_version, input_fsm_type,
        input_fsm_name, input_fsm_version, input_fsm_language
    );

    SELECT EXISTS (
        SELECT 1 FROM pgmq.meta WHERE queue_name = computed_queue_name
    ) INTO already_existed;

    IF NOT already_existed THEN
        PERFORM pgmq.create(computed_queue_name);
    END IF;

    RETURN jsonb_build_object(
        'queue_name', computed_queue_name,
        'already_existed', already_existed
    );
END;
$$ LANGUAGE plpgsql;

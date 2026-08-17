-- fsm-core-async-op-worker's 30-second poll loop calls this with its
-- currently-registered worker identities:
--   [{parent_fsm_name, parent_fsm_version, fsm_type, fsm_name, fsm_version,
--     fsm_language}, ...]
-- (no "handler" -- that's an in-process function reference, not
-- serializable to Postgres).
--
-- For each worker identity: computes its queue name (same rule as
-- ensure_promise_queue_for_worker_v2, via the shared
-- fsm_core.compute_promise_queue_name_v2 -- see that function's own doc
-- comment in 20260806201803_ensure_promise_queue_for_worker.sql), skips it
-- if that queue doesn't exist yet (no queue = definitely nothing pending,
-- and pgmq.read() on a nonexistent queue would error rather than return
-- empty), and otherwise reads up to one message from it (qty=1, vt=30s --
-- matches this codebase's existing one-message-at-a-time PGMQ read
-- convention).
--
-- Each claimed row is built with camelCase keys, not the snake_case this
-- file's own parameters use -- matching the convention already established
-- by send_event_to_promise_queue_with_event_logs_v2's own pgmq message
-- payload (jsonb *content* consumed directly by TS is camelCase in this
-- codebase; snake_case is for PG function parameter/column names, a
-- different thing). This is what
-- fsm-core-async-op-worker/src/asyncOpPollLoop.ts's parseClaimedPromiseEvent
-- expects field-for-field -- see that file for the full row shape.
--
-- Identity fields (parentFsmName etc.) come from the *worker* being
-- iterated, not the message itself -- the message payload
-- (send_event_to_promise_queue_with_event_logs_v2's queue_msg_data) never
-- carried the full 6-field actor identity, only a parent FSM instance id
-- (sendToParentQueueId) and queue metadata. instanceId is mapped from
-- sendToParentQueueId (the FSM instance that will receive the completion
-- event); correlationId is the message's own msg_id, stringified, since the
-- stored message has no separate correlation id field.
--
-- Does NOT compute a "xstate.done.actor."/"xstate.error.actor."-prefixed
-- eventName based on invoke outcome -- eventName here is always the raw
-- sendToParentQueueIdEventName from the message. Whether/how to
-- outcome-prefix it is a dispatchAndArchive()-side concern (TS), out of
-- scope for this change.
CREATE OR REPLACE FUNCTION fsm_core.claim_pending_promise_events_for_workers_v2(
    input_workers jsonb
)
RETURNS SETOF jsonb
AS $$
DECLARE
    worker jsonb;
    computed_queue_name text;
    queue_exists boolean;
    msg pgmq.message_record;
BEGIN
    FOR worker IN SELECT * FROM jsonb_array_elements(input_workers)
    LOOP
        computed_queue_name := fsm_core.compute_promise_queue_name_v2(
            worker->>'parent_fsm_name', worker->>'parent_fsm_version',
            worker->>'fsm_type', worker->>'fsm_name',
            worker->>'fsm_version', worker->>'fsm_language'
        );

        SELECT EXISTS (
            SELECT 1 FROM pgmq.meta WHERE queue_name = computed_queue_name
        ) INTO queue_exists;

        IF NOT queue_exists THEN
            CONTINUE;
        END IF;

        FOR msg IN
            SELECT * FROM pgmq.read(computed_queue_name, 30, 1)
        LOOP
            RETURN NEXT jsonb_build_object(
                'parentFsmName', worker->>'parent_fsm_name',
                'parentFsmVersion', worker->>'parent_fsm_version',
                'fsmType', worker->>'fsm_type',
                'fsmName', worker->>'fsm_name',
                'fsmVersion', worker->>'fsm_version',
                'fsmLanguage', worker->>'fsm_language',
                'input', msg.message->'eventData'->'eventPayload',
                'instanceId', msg.message->>'sendToParentQueueId',
                'correlationId', msg.msg_id::text,
                'promiseQueueName', computed_queue_name,
                'promiseQueueType', worker->>'fsm_type',
                'promiseQueueVersion', worker->>'fsm_version',
                'msgId', msg.msg_id,
                'eventName', msg.message->>'sendToParentQueueIdEventName',
                'eventActionType', msg.message->'eventData'->>'actionType',
                'eventDelay', COALESCE((msg.message->>'queueMsgDelay')::integer, 0),
                'sendToParentQueueId', msg.message->>'sendToParentQueueId',
                'sendToParentQueueIdEventName', msg.message->>'sendToParentQueueIdEventName'
            );
        END LOOP;
    END LOOP;

    RETURN;
END;
$$ LANGUAGE plpgsql;

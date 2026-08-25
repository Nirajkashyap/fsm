create type "fsm_core"."async_operation_language" as enum ('typescript', 'python', 'rust', 'go', 'llm');

create type "fsm_core"."async_operation_type" as enum ('internalAsyncOperation', 'sharedAsyncOperation', 'fsm');

drop function if exists "fsm_core"."compute_promise_queue_name_v2"(input_parent_fsm_name text, input_parent_fsm_version text, input_fsm_type text, input_fsm_name text, input_fsm_version text, input_fsm_language text);

drop function if exists "fsm_core"."ensure_promise_queue_for_worker_v2"(input_parent_fsm_name text, input_parent_fsm_version text, input_fsm_type text, input_fsm_name text, input_fsm_version text, input_fsm_language text);

drop type "fsm_core"."fsm_language";

drop type "fsm_core"."fsm_type";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION fsm_core.compute_promise_queue_name_v2(input_parent_fsm_name text, input_parent_fsm_version text, input_async_operation_type text, input_async_operation_name text, input_async_operation_version text, input_async_operation_language text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
BEGIN
    IF input_async_operation_type = 'internalAsyncOperation' THEN
        RETURN input_parent_fsm_name || '_' || input_parent_fsm_version
            || '_' || LEFT(input_async_operation_type, 1) || '_' || input_async_operation_name || '_'
            || LEFT(input_async_operation_language, 1);
    ELSIF input_async_operation_type = 'sharedAsyncOperation' THEN
        RETURN LEFT(input_parent_fsm_name, 1) || '_' || input_parent_fsm_version
            || '_' || LEFT(input_async_operation_type, 1) || '_' || input_async_operation_name || '_'
            || input_async_operation_language;
    ELSE
        RAISE EXCEPTION 'compute_promise_queue_name_v2: unsupported input_async_operation_type: %', input_async_operation_type;
    END IF;
END;
$function$
;

CREATE OR REPLACE FUNCTION fsm_core.ensure_promise_queue_for_worker_v2(input_parent_fsm_name text, input_parent_fsm_version text, input_async_operation_type text, input_async_operation_name text, input_async_operation_version text, input_async_operation_language text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    computed_queue_name text;
    already_existed boolean;
BEGIN
    computed_queue_name := fsm_core.compute_promise_queue_name_v2(
        input_parent_fsm_name, input_parent_fsm_version, input_async_operation_type,
        input_async_operation_name, input_async_operation_version, input_async_operation_language
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
$function$
;

CREATE OR REPLACE FUNCTION fsm_core.claim_pending_promise_events_for_workers_v2(input_workers jsonb)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
AS $function$
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
            worker->>'async_operation_type', worker->>'async_operation_name',
            worker->>'async_operation_version', worker->>'async_operation_language'
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
                'asyncOperationType', worker->>'async_operation_type',
                'asyncOperationName', worker->>'async_operation_name',
                'asyncOperationVersion', worker->>'async_operation_version',
                'asyncOperationLanguage', worker->>'async_operation_language',
                'input', msg.message->'eventData'->'eventPayload',
                'instanceId', msg.message->>'sendToParentQueueId',
                'correlationId', msg.msg_id::text,
                'promiseQueueName', computed_queue_name,
                'promiseQueueType', worker->>'async_operation_type',
                'promiseQueueVersion', worker->>'async_operation_version',
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
$function$
;

CREATE OR REPLACE FUNCTION fsm_core.fsm_json_schema()
 RETURNS json
 LANGUAGE sql
 IMMUTABLE
AS $functionx$ SELECT '{"type":"object","$schema":"http://json-schema.org/draft-07/schema","$defs":{"actionObject":{"type":"object","properties":{"type":{"type":"string","description":"The action type"},"delayActionName":{"type":"string","description":"Required when type is xstate.raise or xstate.cancel"},"delayActionEventType":{"type":"string","description":"The event type for the delay action"}},"additionalProperties":true,"required":["type"],"if":{"properties":{"type":{"enum":["xstate.raise","xstate.cancel"]}},"required":["type"]},"then":{"properties":{"delayActionName":{"type":"string","description":"Required when type is xstate.raise or xstate.cancel"},"delayActionEventType":{"type":"string","description":"The event type for the delay action"}},"required":["delayActionName","delayActionEventType"]}},"baseStateNode":{"type":"object","properties":{"id":{"type":"string"},"key":{"type":"string"},"type":{"type":"string","enum":["atomic","compound","parallel","final","history"]},"order":{"$ref":"#/$defs/order"},"description":{"type":"string","description":"The description of the state node, in Markdown"}},"required":["id","key","type"]},"compoundStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"const":"compound"},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"initial":{"$ref":"#/$defs/initialTransitionObject"},"invoke":{"$ref":"#/$defs/invokeArray"},"on":{"$ref":"#/$defs/transitionsObject"},"states":{"$ref":"#/$defs/statesObject"}},"required":["states"]}]},"parallelStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"const":"parallel"},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"invoke":{"$ref":"#/$defs/invokeArray"},"on":{"$ref":"#/$defs/transitionsObject"},"states":{"$ref":"#/$defs/statesObject"}},"required":["states"]}]},"atomicStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"const":"atomic"},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"invoke":{"$ref":"#/$defs/invokeArray"},"on":{"$ref":"#/$defs/transitionsObject"}},"required":["on"]}]},"historyStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"const":"history"},"history":{"type":"string","enum":["shallow","deep"]}},"required":["history"]}]},"finalStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"const":"final"},"data":{"type":"object","additionalProperties":true}}}]},"statesObject":{"type":"object","patternProperties":{"^.*$":{"oneOf":[{"$ref":"#/$defs/atomicStateNode"},{"$ref":"#/$defs/compoundStateNode"},{"$ref":"#/$defs/parallelStateNode"},{"$ref":"#/$defs/historyStateNode"},{"$ref":"#/$defs/finalStateNode"}]}}},"initialTransitionObject":{"type":"object","properties":{"actions":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"source":{"type":"string"},"target":{"type":"array","items":{"type":"string"},"minItems":1},"eventType":{"anyOf":[{"type":"string"},{"type":"null"}]}},"required":["actions","source","target"]},"transitionsObject":{"type":"object","patternProperties":{"^.*$":{"type":"array","items":{"$ref":"#/$defs/transitionObject"}}}},"transitionObject":{"type":"object","properties":{"actions":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"cond":{"type":"object","additionalProperties":true,"description":"Legacy guard payload consumed by the PostgreSQL extension''s transition loader (transition->''cond''). Not emitted by this compiler, which emits `guard` instead."},"guard":{"type":"string","description":"Name of the guard function to evaluate for this transition."},"delay":{"anyOf":[{"type":"string"},{"type":"integer"}],"description":"Delay identifier (xstate.after.* transitions) or duration in ms."},"eventType":{"type":"string"},"source":{"type":"string"},"target":{"type":"array","items":{"type":"string"}}},"required":["actions","eventType","source","target"]},"invokeObject":{"type":"object","properties":{"type":{"type":"string"},"id":{"type":"string"},"src":{"type":"string"},"asyncOperationType":{"type":"string","default":"internalAsyncOperation","enum":["internalAsyncOperation","sharedAsyncOperation","fsm"],"description":"The type of the invoked service. internalAsyncOperation for a new async operation, sharedAsyncOperation for an existing async operation but shared with other FSMs, and fsm for another finite state machine."},"asyncOperationVersion":{"type":"string","description":"The version of the FSM being invoked."},"asyncOperationLanguage":{"type":"string","default":"typescript","enum":["typescript","python","rust","go","llm"],"description":"Language runtime that executes the invoked service. Defaults to typescript. Aligns with the actor folder convention (typescript/, python/, rust/, go/, llm/)."}},"required":["type","id","src","asyncOperationType","asyncOperationVersion"],"additionalProperties":false},"invokeArray":{"type":"array","items":{"$ref":"#/$defs/invokeObject"}},"functionObject":{"type":"object","properties":{"$function":{"type":"string"}}},"order":{"type":"integer"}},"properties":{"id":{"title":"ID","type":"string"},"initial":{"$ref":"#/$defs/initialTransitionObject"},"key":{"type":"string"},"type":{"type":"string","enum":["compound","parallel"]},"context":{"type":"object","additionalProperties":true},"states":{"$ref":"#/$defs/statesObject"},"on":{"$ref":"#/$defs/transitionsObject"},"transitions":{"type":"array","items":{"$ref":"#/$defs/transitionObject"}},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"order":{"$ref":"#/$defs/order"},"invoke":{"$ref":"#/$defs/invokeArray"},"version":{"type":"string"}},"required":["id","key","type","states"]}'::json $functionx$
;



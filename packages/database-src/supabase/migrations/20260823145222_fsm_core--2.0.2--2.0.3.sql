create type "fsm_core"."fsm_history_type" as enum ('shallow', 'deep');

create type "fsm_core"."fsm_language" as enum ('typescript', 'python', 'rust', 'go', 'llm');

create type "fsm_core"."fsm_root_type" as enum ('compound', 'parallel');

create type "fsm_core"."fsm_type" as enum ('internalAsyncOperation', 'sharedAsyncOperation', 'fsm');

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION fsm_core.compute_promise_queue_name_v2(input_parent_fsm_name text, input_parent_fsm_version text, input_fsm_type text, input_fsm_name text, input_fsm_version text, input_fsm_language text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION fsm_core.create_promise_queue_and_send_event_from_fsm_instance_id_v2(event_name text, event_input jsonb, id text, action_type text, src text, fsmname text, fsmtype text, fsmversion text, parentfsmname text, parentfsmversion text, fsmlanguage text, from_source_fsm_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    promise_queue_name text;
    queue_exists boolean := false;
    start_queue_worker boolean := false;
    send_result jsonb;
BEGIN
    IF fsmType NOT IN ('internalAsyncOperation', 'sharedAsyncOperation') THEN
        RAISE EXCEPTION 'create_promise_queue_and_send_event_from_fsm_instance_id_v2: unsupported fsmType: %', fsmType;
    END IF;

    promise_queue_name := fsm_core.compute_promise_queue_name_v2(
        parentFsmName, parentFsmVersion, fsmType, fsmName, fsmVersion, fsmLanguage
    );

    SELECT EXISTS (
        SELECT 1 FROM pgmq.list_queues() WHERE queue_name = promise_queue_name
    ) INTO queue_exists;

    IF NOT queue_exists THEN
        PERFORM pgmq.create(queue_name := promise_queue_name);
        start_queue_worker := true;
    END IF;

    send_result := fsm_core.send_event_to_promise_queue_with_event_logs_v2(
        input_promise_queue_name := promise_queue_name,
        input_promise_fn_name := fsmName,
        input_promise_queue_type := fsmType,
        input_promise_queue_version := fsmVersion,
        input_send_to_parent_queue_id := from_source_fsm_instance_id,
        input_send_to_parent_queue_type := 'FSM',
        input_send_to_parent_queue_id_event_name := id,
        input_event_name := event_name,
        input_event_action_type := action_type,
        input_event_data := event_input,
        input_event_delay := 0,
        input_event_status := 'pomise_started',
        input_event_output := '{}'::jsonb,
        input_error_message := NULL
    );

    RETURN send_result || jsonb_build_object('start_queue_worker', start_queue_worker);
END;
$function$
;

CREATE OR REPLACE FUNCTION fsm_core.fsm_json_schema()
 RETURNS json
 LANGUAGE sql
 IMMUTABLE
AS $functionx$ SELECT '{"type":"object","$schema":"http://json-schema.org/draft-07/schema","$defs":{"actionObject":{"type":"object","properties":{"type":{"type":"string","description":"The action type"}},"additionalProperties":true,"required":["type"]},"baseStateNode":{"type":"object","properties":{"id":{"type":"string"},"key":{"type":"string"},"type":{"type":"string","enum":["atomic","compound","parallel","final","history"]},"order":{"$ref":"#/$defs/order"},"description":{"type":"string","description":"The description of the state node, in Markdown"}},"required":["id","key","type"]},"compoundStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"type":"string","pattern":"compound"},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"initial":{"$ref":"#/$defs/initialTransitionObject"},"invoke":{"$ref":"#/$defs/invokeArray"},"on":{"$ref":"#/$defs/transitionsObject"},"states":{"$ref":"#/$defs/statesObject"}},"required":["states"]}]},"parallelStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"type":"string","pattern":"parallel"},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"invoke":{"$ref":"#/$defs/invokeArray"},"on":{"$ref":"#/$defs/transitionsObject"},"states":{"$ref":"#/$defs/statesObject"}},"required":["states"]}]},"atomicStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"type":"string","pattern":"atomic"},"entry":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"exit":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"invoke":{"$ref":"#/$defs/invokeArray"},"on":{"$ref":"#/$defs/transitionsObject"}},"required":["on"]}]},"historyStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"type":"string","pattern":"history"},"history":{"type":"string","enum":["shallow","deep"]}},"required":["history"]}]},"finalStateNode":{"allOf":[{"$ref":"#/$defs/baseStateNode"},{"type":"object","properties":{"type":{"type":"string","pattern":"final"},"data":{"type":"object"}}}]},"statesObject":{"type":"object","patternProperties":{"^.*$":{"oneOf":[{"$ref":"#/$defs/atomicStateNode"},{"$ref":"#/$defs/compoundStateNode"},{"$ref":"#/$defs/parallelStateNode"},{"$ref":"#/$defs/historyStateNode"},{"$ref":"#/$defs/finalStateNode"}]}}},"initialTransitionObject":{"type":"object","properties":{"actions":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"source":{"type":"string"},"target":{"type":"array","items":{"type":"string"},"minItems":1}},"required":["actions","source","target"]},"transitionsObject":{"type":"object","patternProperties":{"^.*$":{"type":"array","items":{"$ref":"#/$defs/transitionObject"}}}},"transitionObject":{"type":"object","properties":{"actions":{"type":"array","items":{"$ref":"#/$defs/actionObject"}},"cond":{"type":"object"},"eventType":{"type":"string"},"source":{"type":"string"},"target":{"type":"array","items":{"type":"string"}}},"required":["actions","eventType","source","target"]},"invokeObject":{"type":"object","properties":{"type":{"type":"string"},"id":{"type":"string"},"src":{"type":"string"},"fsmType":{"type":"string","default":"internalAsyncOperation","enum":["internalAsyncOperation","sharedAsyncOperation","fsm"],"description":"The type of the invoked service. internalAsyncOperation for a new async operation, sharedAsyncOperation for an existing async operation but shared with other FSMs, and fsm for another finite state machine."},"fsmVersion":{"type":"string","description":"The version of the FSM being invoked, required if fsmType is fsm or sharedPromise"}},"required":["type","id","src","fsmType","fsmVersion"],"additionalProperties":false},"invokeArray":{"type":"array","items":{"$ref":"#/$defs/invokeObject"}},"functionObject":{"type":"object","properties":{"$function":{"type":"string"}}},"order":{"type":"integer"}},"properties":{"id":{"title":"ID","type":"string"},"initial":{"$ref":"#/$defs/initialTransitionObject"},"key":{"type":"string"},"type":{"type":"string","enum":["compound","parallel"]},"context":{"type":"object"},"states":{"$ref":"#/$defs/statesObject"},"on":{"$ref":"#/$defs/transitionsObject"},"transitions":{"type":"array","items":{"$ref":"#/$defs/transitionObject"}},"entry":{"type":"array"},"exit":{"type":"array"},"order":{"$ref":"#/$defs/order"},"invoke":{"$ref":"#/$defs/invokeArray"},"version":{"type":"string"}},"required":["id","key","type","states"]}'::json $functionx$
;

CREATE OR REPLACE FUNCTION fsm_core.send_event_to_queue_from_fsm_instance_id_v2(event_name text, event_input jsonb, id text, action_type text, src text, fsmname text, fsmtype text, fsmversion text, parentfsmname text, parentfsmversion text, fsmlanguage text, from_source_fsm_instance_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF fsmType = 'internalAsyncOperation' OR fsmType = 'sharedAsyncOperation' THEN
        RETURN fsm_core.create_promise_queue_and_send_event_from_fsm_instance_id_v2(
            event_name := event_name,
            event_input := event_input,
            id := id,
            action_type := action_type,
            src := src,
            fsmName := fsmName,
            fsmType := fsmType,
            fsmVersion := fsmVersion,
            parentFsmName := parentFsmName,
            parentFsmVersion := parentFsmVersion,
            fsmLanguage := fsmLanguage,
            from_source_fsm_instance_id := from_source_fsm_instance_id
        );
    ELSIF fsmType = 'childFsm' THEN
        RETURN fsm_core.create_fsm_queue_and_send_event_from_fsm_instance_id_v2(
            event_name := event_name,
            event_input := event_input,
            id := id,
            action_type := action_type,
            src := src,
            fsmName := fsmName,
            fsmType := fsmType,
            fsmVersion := fsmVersion,
            parentFsmName := parentFsmName,
            parentFsmVersion := parentFsmVersion,
            from_source_fsm_instance_id := from_source_fsm_instance_id
        );
    ELSE
        RAISE EXCEPTION 'Unsupported fsmType: %', fsmType;
    END IF;
END;
$function$
;



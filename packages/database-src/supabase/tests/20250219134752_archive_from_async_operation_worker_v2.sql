begin;
select plan(5);

select has_function('fsm_core', 'archive_event_from_fsm_async_operation_type_worker_v2',
  ARRAY['text', 'text', 'text', 'bigint', 'text', 'text', 'jsonb', 'integer', 'uuid', 'text', 'timestamptz', 'integer', 'timestamptz', 'text', 'jsonb', 'text'],
  'archive_event_from_fsm_async_operation_type_worker_v2(...) exists');

delete from fsm_core.fsm_async_operation_queue_event_logs where async_operation_queue_name = 'archAsyncOpQ1';
delete from fsm_core.fsm_instance_queue_event_logs
  where fsm_instance_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;
delete from fsm_core.fsm_instance where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid;
insert into fsm_core.fsm_instance (id, fsm_name, fsm_version)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'archFsm', 'v1');
select pgmq.create(queue_name := 'dddddddd-dddd-dddd-dddd-dddddddddddd');
select pgmq.create(queue_name := 'archAsyncOpQ1');
select pgmq.send(queue_name := 'archAsyncOpQ1', msg := '{"foo": "bar"}'::jsonb);

select results_eq(
  $$ select (r->>'async_operation_queue_archive_result')::boolean, (r->>'async_operation_queue_name'),
            (r->>'async_operation_queue_msg_id')::bigint, (r->'send_to_parent_result'->'queue_data'->'eventData'->>'eventType')
     from fsm_core.archive_event_from_fsm_async_operation_type_worker_v2(
       'archAsyncOpQ1', 'internalAsyncOperation', 'v1', 1::bigint,
       'asyncOpDone', 'async_operation', '{"result": "ok"}'::jsonb, 0,
       'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'asyncOpDoneEvt',
       now(), NULL, now(), 'success', '{"result": "ok"}'::jsonb, NULL) r $$,
  $$ values (true, 'archAsyncOpQ1'::text, 1::bigint, 'asyncOpDone'::text) $$,
  'archiving a completed async-operation event: message archived, and forwarded to the parent FSM queue'
);
select results_eq(
  $$ select event_name, event_data, event_status from fsm_core.fsm_async_operation_queue_event_logs
     where async_operation_queue_name = 'archAsyncOpQ1' $$,
  $$ values ('asyncOpDone'::text, '{"result": "ok"}'::jsonb, 'success'::text) $$,
  'the archive is logged in fsm_async_operation_queue_event_logs'
);
select results_eq(
  $$ select event_name, event_data, event_status from fsm_core.fsm_instance_queue_event_logs
     where fsm_instance_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid $$,
  $$ values ('asyncOpDone'::text, '{"result": "ok"}'::jsonb, 'success'::text) $$,
  'the forwarded event is also logged against the parent fsm_instance queue'
);

select throws_ok(
  $$ select fsm_core.archive_event_from_fsm_async_operation_type_worker_v2(
       'neverCreatedAsyncOpQ', 'internalAsyncOperation', 'v1', 1::bigint,
       'asyncOpDone', 'async_operation', '{}'::jsonb, 0,
       'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid, 'asyncOpDoneEvt',
       now(), NULL, now(), 'success', '{}'::jsonb, NULL) $$,
  '42P01',
  'relation "pgmq.q_nevercreatedasyncopq" does not exist',
  'archiving from a queue that was never created raises the raw pgmq relation-not-found error (not wrapped)'
);

select * from finish();
rollback;

begin;
select plan(5);

select has_function('fsm_core', 'send_event_to_async_operation_queue_with_event_logs_v2',
  ARRAY['text', 'text', 'text', 'text', 'uuid', 'text', 'text', 'text', 'text', 'jsonb', 'integer', 'text', 'jsonb', 'text', 'timestamptz', 'integer', 'timestamptz'],
  'send_event_to_async_operation_queue_with_event_logs_v2(...) exists');

select throws_ok(
  $$ select fsm_core.send_event_to_async_operation_queue_with_event_logs_v2(
       NULL, 'myFn', 'internalAsyncOperation', 'v1', gen_random_uuid(), 'sys', 'evt', 'NEXT', 'system', '{}'::jsonb) $$,
  'P0001',
  'async_operation_queue_name is NULL',
  'a NULL async_operation_queue_name is rejected up front'
);
select throws_ok(
  $$ select fsm_core.send_event_to_async_operation_queue_with_event_logs_v2(
       'asyncOpQ1', 'myFn', 'internalAsyncOperation', 'v1', gen_random_uuid(), 'sys', 'evt', 'NEXT', 'system', '{}'::jsonb) $$,
  'P0001',
  'pgmq.send failed for queue asyncOpQ1: relation "pgmq.q_asyncopq1" does not exist',
  'sending to a queue that was never created raises a wrapped pgmq error'
);

delete from fsm_core.fsm_async_operation_queue_event_logs where async_operation_queue_name = 'asyncOpQ1';
select pgmq.create(queue_name := 'asyncOpQ1');

select results_eq(
  $$ select (r->>'event_status'), (r->'queue_data'->>'queueId'), (r->'queue_data'->'eventData'->>'eventType')
     from fsm_core.send_event_to_async_operation_queue_with_event_logs_v2(
       'asyncOpQ1', 'myFn', 'internalAsyncOperation', 'v1', NULL, 'sys', 'evt', 'NEXT', 'system', '{"foo": "bar"}'::jsonb) r $$,
  $$ values ('ACTIVE'::text, 'asyncOpQ1'::text, 'NEXT'::text) $$,
  'a successful send returns ACTIVE status, the queue id, and the event type'
);
select results_eq(
  $$ select async_operation_fn_name, event_name, event_data, event_status
     from fsm_core.fsm_async_operation_queue_event_logs
     where async_operation_queue_name = 'asyncOpQ1' $$,
  $$ values ('myFn'::text, 'NEXT'::text, '{"foo": "bar"}'::jsonb, 'ACTIVE'::text) $$,
  'a successful send is also logged in fsm_async_operation_queue_event_logs'
);

select * from finish();
rollback;

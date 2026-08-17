begin;
select plan(8);

select has_function('fsm_core', 'schedule_all_pending', ARRAY['integer'],
  'schedule_all_pending(integer) exists');

-- Isolate from any pre-existing rows in the shared local dev database.
delete from fsm_core.fsm_instance_and_fsm_workerlet;
delete from fsm_core.fsm_workerlet;

select lives_ok(
  $$ select fsm_core.schedule_all_pending() $$,
  'empty dispatch queue: drains without error'
);

-- A capable, fresh fsmlet with room for far more than we're about to enqueue.
insert into fsm_core.fsm_workerlet
  (fsm_workerlet_id, fsm_workerlet_pid, fsm_modules, max_concurrency, active_workers, last_heartbeat)
values
  ('55555555-5555-5555-5555-555555555555'::uuid, 'pid-drain',
   '[{"fsm_name": "drainFsm", "fsm_version": "1"}]'::jsonb, 8, 0, now());

insert into fsm_core.fsm_instance_and_fsm_workerlet (fsm_instance_id, fsm_name, fsm_version)
values
  ('66666666-6666-6666-6666-666666666666'::uuid, 'drainFsm', '1'),
  ('77777777-7777-7777-7777-777777777777'::uuid, 'drainFsm', '1'),
  ('88888888-8888-8888-8888-888888888888'::uuid, 'drainFsm', '1');

select lives_ok(
  $$ select fsm_core.schedule_all_pending() $$,
  'three pending entries: drains without error'
);

select results_eq(
  $$ select count(*) from fsm_core.fsm_instance_and_fsm_workerlet
     where status = 'scheduled' and fsm_workerlet_id = '55555555-5555-5555-5555-555555555555'::uuid $$,
  $$ values (3::bigint) $$,
  'a single call drains all three pending entries, unlike schedule_next_pending which does one'
);

-- A pending entry with only a stale fsmlet available.
insert into fsm_core.fsm_workerlet
  (fsm_workerlet_id, fsm_workerlet_pid, fsm_modules, max_concurrency, active_workers, last_heartbeat)
values
  ('99999999-9999-9999-9999-999999999999'::uuid, 'pid-stale',
   '[{"fsm_name": "staleFsm", "fsm_version": "1"}]'::jsonb, 8, 0, now() - interval '60 seconds');

insert into fsm_core.fsm_instance_and_fsm_workerlet (fsm_instance_id, fsm_name, fsm_version)
values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 'staleFsm', '1');

select lives_ok(
  $$ select fsm_core.schedule_all_pending(30) $$,
  'stale-only fsmlet, default 30s threshold: drains without error'
);
select results_eq(
  $$ select status from fsm_core.fsm_instance_and_fsm_workerlet
     where fsm_instance_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  $$ values ('pending'::text) $$,
  'entry remains pending: the only available fsmlet is stale under the 30s threshold'
);

select lives_ok(
  $$ select fsm_core.schedule_all_pending(90) $$,
  'same entry, 90s threshold: drains without error'
);
select results_eq(
  $$ select status, fsm_workerlet_id from fsm_core.fsm_instance_and_fsm_workerlet
     where fsm_instance_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid $$,
  $$ values ('scheduled'::text, '99999999-9999-9999-9999-999999999999'::uuid) $$,
  'entry gets scheduled once the staleness threshold widens to 90s'
);

select * from finish();
rollback;

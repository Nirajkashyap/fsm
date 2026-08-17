import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA } from "../const.ts";

const ASYNC_OP_SCHEDULE_NEXT_PENDING_FN =
  `${FSM_SCHEMA}.async_operation_schedule_next_pending`;

/**
 * Atomically claims the oldest pending async-operation dispatch entry, assigns it
 * to the best available workerlet, and fires pg_notify to wake that workerlet.
 * Returns true if an entry was scheduled, false if the queue is empty or no
 * workerlet has capacity. Safe to call from multiple scheduler replicas concurrently.
 */
export async function asyncOperationScheduleNextPending(
  deps: DBDeps,
  staleThresholdSeconds = 30,
): Promise<boolean> {
  const res = await deps.db.query<{ result: boolean }>(
    `SELECT ${ASYNC_OP_SCHEDULE_NEXT_PENDING_FN}($1::int) AS result`,
    [staleThresholdSeconds],
  );
  return res.rows[0].result;
}

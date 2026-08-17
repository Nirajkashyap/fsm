import { getLogger } from "@logtape/logtape";
import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA } from "../const.ts";

const logger = getLogger(["@pgfsm/db", "fsm-sync-operation-scheduler"]);

const SCHEDULE_NEXT_PENDING_FN = `${FSM_SCHEMA}.schedule_next_pending`;

/**
 * Thin wrapper around fsm_core.schedule_next_pending().
 * All scheduling logic (claim, filter+score fsmlets, assign, notify) runs
 * inside the PG function in a single transaction.
 * Returns true if an entry was scheduled, false if queue is empty or no
 * capable fsmlet is available.
 */
export async function scheduleNextPending(
  deps: DBDeps,
  staleThresholdSeconds = 30,
): Promise<boolean> {
  const res = await deps.db.query<{ schedule_next_pending: boolean }>(
    `SELECT ${SCHEDULE_NEXT_PENDING_FN}($1)`,
    [staleThresholdSeconds],
  );
  const scheduled = res.rows[0]?.schedule_next_pending ?? false;
  if (scheduled) {
    logger.info("schedule_next_pending: entry scheduled");
  }
  return scheduled;
}

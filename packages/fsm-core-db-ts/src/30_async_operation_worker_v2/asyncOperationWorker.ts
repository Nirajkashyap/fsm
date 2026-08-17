import { getLogger } from "@logtape/logtape";
import type { Json } from "../database.types.ts";
import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA, FSM_SCHEMA_FN_VERSION } from "../const.ts";
import { toJsonbParam } from "../pg-utils.ts";

const logger = getLogger(["@pgfsm/db", "async-operation-worker"]);

const CLAIM_PENDING_PROMISE_EVENTS_FOR_WORKERS_FN =
  `${FSM_SCHEMA}.claim_pending_promise_events_for_workers_${FSM_SCHEMA_FN_VERSION}`;
const ENSURE_PROMISE_QUEUE_FOR_WORKER_FN =
  `${FSM_SCHEMA}.ensure_promise_queue_for_worker_${FSM_SCHEMA_FN_VERSION}`;

/**
 * A registered promise-actor identity, as sent to
 * `claimPendingPromiseEventsForWorkers` — mirrors
 * `@pgfsm/async-op-worker-gateway`'s `SidecarGateway`-registered actor shape
 * minus `handler` (an in-process function reference, not serializable to
 * Postgres).
 */
export interface PromiseWorkerIdentity {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: string;
  fsmName: string;
  fsmVersion: string;
  fsmLanguage: string;
}

/**
 * Thin wrapper around `claim_pending_promise_events_for_workers_v2()` — takes
 * the caller's currently-registered worker identities (no `handler`) and
 * returns pending promise-queue work matching them: for each identity, reads
 * up to one message (if any) from that identity's PGMQ queue, skipping
 * identities with no queue yet. See that function's own comment (and
 * `packages/fsm-core-async-op-worker/docs/guides/CLI-USAGE.md`'s "PGMQ
 * message payload shape" section) for the row shape returned.
 */
export async function claimPendingPromiseEventsForWorkers(
  deps: DBDeps,
  workers: PromiseWorkerIdentity[],
): Promise<Json[]> {
  try {
    const text =
      `SELECT * FROM ${CLAIM_PENDING_PROMISE_EVENTS_FOR_WORKERS_FN}($1::jsonb);`;
    const values = [
      toJsonbParam(
        workers.map((w) => ({
          parent_fsm_name: w.parentFsmName,
          parent_fsm_version: w.parentFsmVersion,
          fsm_type: w.fsmType,
          fsm_name: w.fsmName,
          fsm_version: w.fsmVersion,
          fsm_language: w.fsmLanguage,
        })),
      ),
    ];
    const res = await deps.db.query<{
      claim_pending_promise_events_for_workers_v2: Json;
    }>(text, values);
    return res.rows.map((row) =>
      row.claim_pending_promise_events_for_workers_v2
    );
  } catch (err) {
    logger.error("Error in claimPendingPromiseEventsForWorkers: {error}", {
      error: err,
    });
    throw new Error("Failed to claim pending promise events for workers", {
      cause: err,
    });
  }
}

export interface EnsurePromiseQueueForWorkerResult {
  queueName: string;
  alreadyExisted: boolean;
}

/**
 * Thin wrapper around `ensure_promise_queue_for_worker_v2()` -- ensures a
 * PGMQ queue exists for one promise-actor identity. fsmType is always
 * shortened to its first character; when fsmType is exactly `"promise"`,
 * fsmVersion is dropped entirely and fsmLanguage is also shortened to its
 * first character (both to help fit PGMQ's length limit -- see below):
 *
 * - `fsmType === "promise"`:
 *   `<parentFsmName>_<parentFsmVersion>_<fsmType[0]>_<fsmName>_<fsmLanguage[0]>`
 * - otherwise (e.g. `"sharedPromise"`):
 *   `<parentFsmName>_<parentFsmVersion>_<fsmType[0]>_<fsmName>_<fsmVersion>_<fsmLanguage>`
 *
 * Idempotent: safe to call every time a worker registers this actor, not
 * just the first time (see fsm-core-async-op-worker's
 * `ensureQueueOnRegister` option).
 *
 * PGMQ enforces a hard 48-character queue name limit (`pgmq.validate_queue_name`)
 * -- this call throws if the computed name exceeds it. The `fsmType ===
 * "promise"` shortening above is enough for typical identities (verified:
 * `creditCheck_v01_p_checkReportsTable_t` = 37 chars for a long real
 * example), but long parentFsmName/fsmName values can still exceed it, and
 * the non-`"promise"` path (still carrying full fsmVersion + fsmLanguage)
 * remains more exposed to this limit.
 */
export async function ensurePromiseQueueForWorker(
  deps: DBDeps,
  identity: PromiseWorkerIdentity,
): Promise<EnsurePromiseQueueForWorkerResult> {
  try {
    const text =
      `SELECT * FROM ${ENSURE_PROMISE_QUEUE_FOR_WORKER_FN}($1::text, $2::text, $3::text, $4::text, $5::text, $6::text) AS result;`;
    const values = [
      identity.parentFsmName,
      identity.parentFsmVersion,
      identity.fsmType,
      identity.fsmName,
      identity.fsmVersion,
      identity.fsmLanguage,
    ];
    const res = await deps.db.query<
      { result: { queue_name: string; already_existed: boolean } }
    >(text, values);
    const result = res.rows?.[0]?.result;
    if (!result) {
      throw new Error("ensure_promise_queue_for_worker_v2 returned no rows");
    }
    return {
      queueName: result.queue_name,
      alreadyExisted: result.already_existed,
    };
  } catch (err) {
    logger.error("Error in ensurePromiseQueueForWorker: {error}", {
      error: err,
    });
    throw new Error("Failed to ensure promise queue for worker", {
      cause: err,
    });
  }
}

import { getLogger } from "@logtape/logtape";
import type { Database as DatabaseGenerated } from "./database.types.ts";
import type { DBDeps } from "./custom.types.ts";
import type { PromiseWorkerIdentity } from "./fsm-instance.ts";

const logger = getLogger(["@pgfsm/db", "queue"]);

import { FSM_SCHEMA, FSM_SCHEMA_FN_VERSION, QUEUE_SCHEMA } from "./const.ts";

const CREATE_QUEUE_FN = `${QUEUE_SCHEMA}.create`;
const DELETE_QUEUE_FN = `${QUEUE_SCHEMA}.delete`;
const ARCHIVE_QUEUE_FN = `${QUEUE_SCHEMA}.archive`;
const LIST_QUEUES_FN = `${QUEUE_SCHEMA}.list_queues`;
const ENSURE_PROMISE_QUEUE_FOR_WORKER_FN =
  `${FSM_SCHEMA}.ensure_promise_queue_for_worker_${FSM_SCHEMA_FN_VERSION}`;

export async function createPgmqQueue(
  deps: DBDeps,
  queueName: string,
): Promise<void> {
  const text = `SELECT ${CREATE_QUEUE_FN}($1)`;
  await deps.db.query(text, [queueName]);
}

export async function readMessage(
  deps: DBDeps,
  queueName: string,
  vt: number,
): Promise<DatabaseGenerated["pgmq"]["CompositeTypes"]["message_record"][]> {
  try {
    const READ_QUEUE_FN = `${QUEUE_SCHEMA}.read`;
    const qty = 1; // Read one message at a time for processing
    const text = `
      SELECT * FROM ${READ_QUEUE_FN}(
        $1::text,
        $2::integer,
        $3::integer
      );
    `;
    const res = await deps.db.query<
      DatabaseGenerated["pgmq"]["CompositeTypes"]["message_record"]
    >(text, [queueName, vt, qty]);
    return res.rows ?? [];
  } catch (err) {
    logger.error("Error in readMessage: {error}", { error: err });
    return [];
  }
}

export async function deleteMessage(
  deps: DBDeps,
  queueName: string,
  msgId: number,
): Promise<void> {
  try {
    const text = `
      SELECT * FROM ${DELETE_QUEUE_FN}(
        $1::text,
        $2::bigint
      );
    `;
    await deps.db.query(text, [queueName, msgId]);
  } catch (err) {
    logger.error("Error in deleteMessage: {error}", { error: err });
  }
}

export async function archiveMessage(
  deps: DBDeps,
  queueName: string,
  msgId: number,
): Promise<void> {
  try {
    const text = `
      SELECT * FROM ${ARCHIVE_QUEUE_FN}(
        $1::text,
        $2::bigint
      );
    `;
    await deps.db.query(text, [queueName, msgId]);
  } catch (err) {
    logger.error("Error in archiveMessage: {error}", { error: err });
  }
}

export async function sendMessage(
  deps: DBDeps,
  queueName: string,
  message: unknown,
): Promise<bigint | null> {
  try {
    const text = `SELECT ${QUEUE_SCHEMA}.send($1::text, $2::jsonb) AS msg_id`;
    const res = await deps.db.query<{ msg_id: bigint }>(text, [
      queueName,
      JSON.stringify(message),
    ]);
    return res.rows?.[0]?.msg_id ?? null;
  } catch (err) {
    logger.error("Error in sendMessage: {error}", { error: err });
    throw new Error("Failed to send message to queue", { cause: err });
  }
}

export async function pgmqQueueExists(
  deps: DBDeps,
  queueName: string,
): Promise<boolean> {
  if (!queueName) return false;
  try {
    const text = `
      SELECT * FROM ${LIST_QUEUES_FN}();
    `;
    const res = await deps.db.query<
      DatabaseGenerated["pgmq"]["CompositeTypes"]["queue_record"]
    >(text);
    const rows: DatabaseGenerated["pgmq"]["CompositeTypes"]["queue_record"][] =
      res.rows ?? [];
    return rows.some((r) => r?.queue_name === queueName);
  } catch (err) {
    logger.error("Error in pgmqQueueExists: {error}", { error: err });
    return false;
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

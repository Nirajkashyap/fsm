import { getLogger } from "@logtape/logtape";
import type { Database as DatabaseGenerated, Json } from "../database.types.ts";
import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA, FSM_SCHEMA_FN_VERSION } from "../const.ts";
import { toJsonbParam } from "../pg-utils.ts";

const logger = getLogger(["@pgfsm/db", "async-operation-ctl"]);

const ARCHIVE_EVENT_FROM_FSM_PROMISE_TYPE_WORKER_FN =
  `${FSM_SCHEMA}.archive_event_from_fsm_promise_type_worker_${FSM_SCHEMA_FN_VERSION}`;

type ArchivePromiseWorkerArgs = DatabaseGenerated["fsm_core"]["Functions"][
  "archive_event_from_fsm_promise_type_worker_v2"
]["Args"];

export async function archiveEventFromFsmPromiseTypeWorker(
  deps: DBDeps,
  promise_queue_name: ArchivePromiseWorkerArgs["input_promise_queue_name"],
  promise_queue_type: ArchivePromiseWorkerArgs["input_promise_queue_type"],
  promise_queue_version:
    ArchivePromiseWorkerArgs["input_promise_queue_version"],
  promise_queue_msg_id: ArchivePromiseWorkerArgs["input_promise_queue_msg_id"],
  event_name: ArchivePromiseWorkerArgs["input_event_name"],
  event_action_type: ArchivePromiseWorkerArgs["input_event_action_type"],
  event_data: ArchivePromiseWorkerArgs["input_event_data"],
  event_delay: ArchivePromiseWorkerArgs["input_event_delay"],
  send_to_parent_queue_id:
    ArchivePromiseWorkerArgs["input_send_to_parent_queue_id"],
  send_to_parent_queue_id_event_name:
    ArchivePromiseWorkerArgs["input_send_to_parent_queue_id_event_name"],
  execution_started_at: ArchivePromiseWorkerArgs["input_execution_started_at"],
  execution_duration: ArchivePromiseWorkerArgs["input_execution_duration"],
  execution_finished_at:
    ArchivePromiseWorkerArgs["input_execution_finished_at"],
  event_status: ArchivePromiseWorkerArgs["input_event_status"],
  event_output: ArchivePromiseWorkerArgs["input_event_output"],
  error_message: ArchivePromiseWorkerArgs["input_error_message"] | null,
): Promise<Json> {
  try {
    const text = `
      SELECT * FROM ${ARCHIVE_EVENT_FROM_FSM_PROMISE_TYPE_WORKER_FN}(
        $1::text,
        $2::text,
        $3::text,
        $4::bigint,
        $5::text,
        $6::text,
        $7::jsonb,
        $8::integer,
        $9::uuid,
        $10::text,
        $11::timestamptz,
        $12::integer,
        $13::timestamptz,
        $14::text,
        $15::jsonb,
        $16::text
      ) AS result;
    `;
    const values = [
      promise_queue_name,
      promise_queue_type,
      promise_queue_version,
      promise_queue_msg_id,
      event_name,
      event_action_type,
      toJsonbParam(event_data),
      event_delay,
      send_to_parent_queue_id,
      send_to_parent_queue_id_event_name,
      execution_started_at,
      execution_duration,
      execution_finished_at,
      event_status,
      toJsonbParam(event_output),
      error_message,
    ];
    const res = await deps.db.query<{ result: Json }>(text, values);
    return res.rows?.[0]?.result ?? null;
  } catch (err) {
    logger.error("Error in archiveEventFromFsmPromiseTypeWorker: {error}", {
      error: err,
    });
    throw new Error("Failed to archive event from FSM promise type worker", {
      cause: err,
    });
  }
}

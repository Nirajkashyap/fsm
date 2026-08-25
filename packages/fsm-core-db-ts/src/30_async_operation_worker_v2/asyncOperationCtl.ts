import { getLogger } from "@logtape/logtape";
import type { Database as DatabaseGenerated, Json } from "../database.types.ts";
import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA, FSM_SCHEMA_FN_VERSION } from "../const.ts";
import { toJsonbParam } from "../pg-utils.ts";

const logger = getLogger(["@pgfsm/db", "async-operation-ctl"]);

const ARCHIVE_EVENT_FROM_FSM_ASYNC_OPERATION_TYPE_WORKER_FN =
  `${FSM_SCHEMA}.archive_event_from_fsm_async_operation_type_worker_${FSM_SCHEMA_FN_VERSION}`;

type ArchiveAsyncOperationWorkerArgs =
  DatabaseGenerated["fsm_core"]["Functions"][
    "archive_event_from_fsm_async_operation_type_worker_v2"
  ]["Args"];

export async function archiveEventFromFsmAsyncOperationTypeWorker(
  deps: DBDeps,
  async_operation_queue_name:
    ArchiveAsyncOperationWorkerArgs["input_async_operation_queue_name"],
  async_operation_queue_type:
    ArchiveAsyncOperationWorkerArgs["input_async_operation_queue_type"],
  async_operation_queue_version:
    ArchiveAsyncOperationWorkerArgs["input_async_operation_queue_version"],
  async_operation_queue_msg_id:
    ArchiveAsyncOperationWorkerArgs["input_async_operation_queue_msg_id"],
  event_name: ArchiveAsyncOperationWorkerArgs["input_event_name"],
  event_action_type: ArchiveAsyncOperationWorkerArgs["input_event_action_type"],
  event_data: ArchiveAsyncOperationWorkerArgs["input_event_data"],
  event_delay: ArchiveAsyncOperationWorkerArgs["input_event_delay"],
  send_to_parent_queue_id:
    ArchiveAsyncOperationWorkerArgs["input_send_to_parent_queue_id"],
  send_to_parent_queue_id_event_name:
    ArchiveAsyncOperationWorkerArgs["input_send_to_parent_queue_id_event_name"],
  execution_started_at:
    ArchiveAsyncOperationWorkerArgs["input_execution_started_at"],
  execution_duration:
    ArchiveAsyncOperationWorkerArgs["input_execution_duration"],
  execution_finished_at:
    ArchiveAsyncOperationWorkerArgs["input_execution_finished_at"],
  event_status: ArchiveAsyncOperationWorkerArgs["input_event_status"],
  event_output: ArchiveAsyncOperationWorkerArgs["input_event_output"],
  error_message: ArchiveAsyncOperationWorkerArgs["input_error_message"] | null,
): Promise<Json> {
  try {
    const text = `
      SELECT * FROM ${ARCHIVE_EVENT_FROM_FSM_ASYNC_OPERATION_TYPE_WORKER_FN}(
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
      async_operation_queue_name,
      async_operation_queue_type,
      async_operation_queue_version,
      async_operation_queue_msg_id,
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
    logger.error(
      "Error in archiveEventFromFsmAsyncOperationTypeWorker: {error}",
      {
        error: err,
      },
    );
    throw new Error(
      "Failed to archive event from FSM async-operation type worker",
      {
        cause: err,
      },
    );
  }
}

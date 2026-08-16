import { getLogger } from "@logtape/logtape";
import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA } from "../const.ts";

const logger = getLogger(["@pgfsm/db", "async-operation"]);

const ASYNC_OP_DISPATCH_TABLE =
  `${FSM_SCHEMA}.async_operation_instance_and_async_operation_workerlet`;
const ASYNC_OPERATION_META_TABLE = `${FSM_SCHEMA}.async_operation_meta`;
const CREATE_ASYNC_OPERATION_INSTANCE_AND_NOTIFY_ASYNC_OPERATION_SCHEDULER_WORK_FN =
  `${FSM_SCHEMA}.create_async_operation_instance_and_notify_async_operation_scheduler_work`;

export type AsyncOperationInstanceRow = {
  async_operation_instance_and_async_operation_workerlet_id: string;
  async_operation_instance_id: string;
  async_operation_workerlet_id: string | null;
  async_operation_name: string;
  async_operation_version: string;
  async_operation_type: string;
  parent_fsm_name: string;
  parent_fsm_version: string;
  async_operation_language: string;
  status: string;
  created_at: string;
  scheduled_at: string | null;
};

export type AsyncOperationMetaRow = {
  async_operation_meta_id: string;
  async_operation_name: string;
  async_operation_type: string;
  async_operation_version: string;
  parent_fsm_name: string;
  parent_fsm_version: string;
  max_concurrency: number;
  async_operation_language: string;
  updated_at: string;
  updated_by_pid: string;
};

export type AsyncOperationDispatchInput = {
  asyncOperationInstanceId: string;
  asyncOperationName: string;
  asyncOperationVersion: string;
  asyncOperationType: string;
  parentFsmName: string;
  parentFsmVersion: string;
  asyncOperationLanguage: string;
};

/**
 * Thin wrapper around fsm_core.create_async_operation_instance_and_notify_async_operation_scheduler_work().
 * Inserts a pending dispatch entry into async_operation_instance_and_async_operation_workerlet
 * and wakes the async-operation scheduler via pg_notify — insert + notify run
 * atomically inside the PG function.
 */
export async function createAsyncOperationInstanceAndNotifyAsyncOperationSchedulerWork(
  deps: DBDeps,
  input: AsyncOperationDispatchInput,
): Promise<void> {
  await deps.db.query(
    `SELECT ${CREATE_ASYNC_OPERATION_INSTANCE_AND_NOTIFY_ASYNC_OPERATION_SCHEDULER_WORK_FN}($1::uuid, $2, $3, $4, $5, $6, $7)`,
    [
      input.asyncOperationInstanceId,
      input.asyncOperationName,
      input.asyncOperationVersion,
      input.asyncOperationType,
      input.parentFsmName,
      input.parentFsmVersion,
      input.asyncOperationLanguage,
    ],
  );
  logger.debug(
    "Created async operation {instanceId} ({name}@{version}, type={type}, lang={lang})",
    {
      instanceId: input.asyncOperationInstanceId,
      name: input.asyncOperationName,
      version: input.asyncOperationVersion,
      type: input.asyncOperationType,
      lang: input.asyncOperationLanguage,
    },
  );
}

/**
 * Lists every row in async_operation_instance_and_async_operation_workerlet —
 * dispatch entries for async-operation instances, whether still 'pending' or
 * already 'scheduled' to a workerlet.
 */
export async function listAsyncOperationInstances(
  deps: DBDeps,
): Promise<AsyncOperationInstanceRow[]> {
  const res = await deps.db.query<AsyncOperationInstanceRow>(
    `SELECT * FROM ${ASYNC_OP_DISPATCH_TABLE} ORDER BY created_at DESC`,
  );
  return res.rows;
}

/**
 * Lists every row in async_operation_meta — validated async-operation
 * metadata loaded by asyncOperationWorkerlet instances at startup.
 */
export async function listAsyncOperationMeta(
  deps: DBDeps,
): Promise<AsyncOperationMetaRow[]> {
  const res = await deps.db.query<AsyncOperationMetaRow>(
    `SELECT * FROM ${ASYNC_OPERATION_META_TABLE} ORDER BY updated_at DESC`,
  );
  return res.rows;
}

import { getLogger } from "@logtape/logtape";
import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA, FSM_SCHEMA_FN_VERSION } from "../const.ts";
import type { Json } from "../database.types.ts";

const logger = getLogger(["@pgfsm/db", "async-operation-meta"]);

export async function loadAsyncOperation(
  deps: DBDeps,
  input_async_operation_name: string,
  input_async_operation_version: string,
  input_async_operation_type: string,
  input_async_operation_language: string,
  input_parent_fsm_name: string,
  input_parent_fsm_version: string,
  input_updated_by_pid: string,
): Promise<Json> {
  try {
    const LOAD_ASYNC_OP_META_FN =
      `${FSM_SCHEMA}.load_async_operation_meta_${FSM_SCHEMA_FN_VERSION}`;
    const text = `
      SELECT ${LOAD_ASYNC_OP_META_FN}(
        $1::text,
        $2::text,
        $3::text,
        $4::text,
        $5::text,
        $6::text,
        $7::text
      ) AS result;
    `;
    const values = [
      input_async_operation_name,
      input_async_operation_version,
      input_async_operation_type,
      input_async_operation_language,
      input_parent_fsm_name,
      input_parent_fsm_version,
      input_updated_by_pid,
    ];
    const res = await deps.db.query<{ result: Json }>(text, values);
    return res.rows?.[0]?.result ?? null;
  } catch (err) {
    logger.error("Error in loadAsyncOperation: {error}", { error: err });
    throw new Error("Failed to load async operation", { cause: err });
  }
}

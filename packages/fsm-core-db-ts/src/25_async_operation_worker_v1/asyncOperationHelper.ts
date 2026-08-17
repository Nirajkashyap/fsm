import type { DBDeps } from "../custom.types.ts";
import { FSM_SCHEMA } from "../const.ts";

const CHECK_REGISTRY_FOR_ASYNC_ACTORS_FN =
  `${FSM_SCHEMA}.check_registry_for_async_actors`;
const CHECK_REGISTRY_AND_WORKING_FOR_ASYNC_ACTORS_FN =
  `${FSM_SCHEMA}.check_registry_and_working_for_async_actors_for_fsm_instance_and_worklet`;

export type AsyncActor = {
  src: string;
  fsmVersion: string;
};

export type CheckRegistryForAsyncActorsResult = {
  all_registered: boolean;
  missing_actors: AsyncActor[];
  fsm_name: string;
  fsm_version: string;
};

export type CheckRegistryAndWorkingForAsyncActorsResult = {
  all_working: boolean;
  non_working_actors: AsyncActor[];
  fsm_name: string;
  fsm_version: string;
};

/**
 * Checks async_operation_instance_and_async_operation_workerlet to verify
 * every actor in asyncActors has an active (pending/scheduled) dispatch entry
 * for the given FSM. Returns which actors are not working, if any.
 */
export async function checkRegistryAndWorkingForAsyncActors(
  deps: DBDeps,
  asyncActors: AsyncActor[],
  fsmName: string,
  fsmVersion: string,
): Promise<CheckRegistryAndWorkingForAsyncActorsResult> {
  const res = await deps.db.query<
    { result: CheckRegistryAndWorkingForAsyncActorsResult }
  >(
    `SELECT ${CHECK_REGISTRY_AND_WORKING_FOR_ASYNC_ACTORS_FN}($1::jsonb, $2, $3) AS result`,
    [JSON.stringify(asyncActors), fsmName, fsmVersion],
  );
  return res.rows[0].result;
}

/**
 * Checks async_operation_meta to verify every actor in asyncActors is
 * registered for the given FSM. Returns which actors are missing, if any.
 */
export async function checkRegistryForAsyncActors(
  deps: DBDeps,
  asyncActors: AsyncActor[],
  fsmName: string,
  fsmVersion: string,
): Promise<CheckRegistryForAsyncActorsResult> {
  const res = await deps.db.query<
    { result: CheckRegistryForAsyncActorsResult }
  >(
    `SELECT ${CHECK_REGISTRY_FOR_ASYNC_ACTORS_FN}($1::jsonb, $2, $3) AS result`,
    [JSON.stringify(asyncActors), fsmName, fsmVersion],
  );
  return res.rows[0].result;
}

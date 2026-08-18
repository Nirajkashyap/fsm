// 30-second poll loop implementing GOAL.md's steps 3-7: every tick, ask
// Postgres (via claimPendingPromiseEventsForWorkers) for pending work
// matching this gateway's currently-registered worker identities, dispatch
// each claimed event via the sidecar's gRPC/IPC invoke path, and archive
// the result.
//
// This package is a standalone alternative to fsm-async-worker-ts, not
// something layered on top of it -- it owns this poll/dispatch/archive loop
// end to end, including its own Postgres connection (DBDeps), rather than
// being invoked by an external orchestrator's poll/claim/archive loop.

import { getLogger } from "@logtape/logtape";
import type { DBDeps, Json, PromiseWorkerIdentity } from "@pgfsm/db";
import {
  archiveEventFromFsmPromiseTypeWorker,
  claimPendingPromiseEventsForWorkers,
} from "@pgfsm/db";
import { ActivityInvokeError, type SidecarGateway } from "./sidecar/gateway.ts";

const logger = getLogger([
  "@pgfsm/worker",
  "async-op-worker-gateway",
  "poll-loop",
]);

export interface AsyncOpPollLoopOptions {
  /** How often to poll, in ms. Default 30_000 (30 seconds), per GOAL.md. */
  intervalMs?: number;
  /** Per-invoke timeout passed to SidecarGateway.invoke(). Default 10_000. */
  invokeTimeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_INVOKE_TIMEOUT_MS = 10_000;

/**
 * Shape of one claimed pending-work row, returned by
 * `claim_pending_promise_events_for_workers_v2` (see that function's own
 * doc comment for the PGMQ message payload it's derived from) -- carries
 * enough to both dispatch (identity + input + instance/correlation ids) and
 * archive (queue name/type/version + msg id + event routing fields) the
 * result.
 */
interface ClaimedPromiseEvent {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: string;
  fsmName: string;
  fsmVersion: string;
  fsmLanguage: string;
  input: unknown;
  instanceId: string;
  correlationId: string;
  promiseQueueName: string;
  promiseQueueType: string;
  promiseQueueVersion: string;
  msgId: number;
  eventName: string;
  eventActionType: string;
  eventDelay: number;
  sendToParentQueueId: string;
  sendToParentQueueIdEventName: string;
}

const REQUIRED_CLAIMED_EVENT_KEYS: (keyof ClaimedPromiseEvent)[] = [
  "parentFsmName",
  "parentFsmVersion",
  "fsmType",
  "fsmName",
  "fsmVersion",
  "fsmLanguage",
  "instanceId",
  "correlationId",
  "promiseQueueName",
  "promiseQueueType",
  "promiseQueueVersion",
  "msgId",
  "eventName",
  "eventActionType",
  "sendToParentQueueId",
  "sendToParentQueueIdEventName",
];

export function parseClaimedPromiseEvent(
  row: unknown,
): ClaimedPromiseEvent | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  for (const key of REQUIRED_CLAIMED_EVENT_KEYS) {
    if (!(key in r)) return null;
  }
  return {
    ...(r as unknown as ClaimedPromiseEvent),
    input: r.input ?? null,
    eventDelay: typeof r.eventDelay === "number" ? r.eventDelay : 0,
  };
}

function actorKeyOf(
  event: Pick<
    ClaimedPromiseEvent,
    | "parentFsmName"
    | "parentFsmVersion"
    | "fsmType"
    | "fsmName"
    | "fsmVersion"
    | "fsmLanguage"
  >,
): string {
  return [
    event.parentFsmName,
    event.parentFsmVersion,
    event.fsmType,
    event.fsmName,
    event.fsmVersion,
    event.fsmLanguage,
  ].join("@");
}

/**
 * Dispatches one claimed event via the sidecar's gRPC/IPC invoke path, then
 * archives the result (goal steps 5-6). Never throws — dispatch and archive
 * failures are both logged and swallowed, so one bad event can't take down
 * the poll loop or block any other event's dispatch.
 */
export async function dispatchAndArchive(
  sidecar: SidecarGateway,
  deps: DBDeps,
  event: ClaimedPromiseEvent,
  invokeTimeoutMs: number,
): Promise<void> {
  const executionStartedAt = new Date();
  let eventOutput: Json = null;
  let eventStatus = "succeeded";
  let errorMessage: string | null = null;

  try {
    const result = await sidecar.invoke(
      {
        parentFsmName: event.parentFsmName,
        parentFsmVersion: event.parentFsmVersion,
        fsmType: event.fsmType,
        fsmName: event.fsmName,
        fsmVersion: event.fsmVersion,
        fsmLanguage: event.fsmLanguage,
        input: event.input,
        instanceId: event.instanceId,
        correlationId: event.correlationId,
      },
      invokeTimeoutMs,
    );
    eventOutput = (result.output ?? null) as Json;
  } catch (error) {
    eventStatus = "failed";
    errorMessage = error instanceof ActivityInvokeError
      ? error.message
      : (error instanceof Error ? error.message : String(error));
    eventOutput = { error: errorMessage };
  }

  const executionFinishedAt = new Date();

  // Outcome-dependent prefix, matching fsm-async-worker-ts's working
  // convention exactly (fsmpromiseworker-helper.ts's
  // send_event_name_to_parent_queue_id): the fsmlet only recognizes
  // "xstate.done.actor.<base>" / "xstate.error.actor.<base>" as a valid
  // transition event -- the claimed row's raw eventName (the un-prefixed
  // state-node id the fsmlet itself sent, e.g.
  // "0.(machine).creditCheck.Verifying Credentials") never matches any
  // transition on its own, which used to leave the FSM stuck at that state
  // forever even though the actor invoke above succeeded.
  const prefixedEventName = `${
    eventStatus === "succeeded" ? "xstate.done.actor." : "xstate.error.actor."
  }${event.eventName}`;

  logger.info(
    "Dispatch result for actor {actorKey}, event {eventName}: status={status}, output={output}, error={error}",
    {
      actorKey: actorKeyOf(event),
      eventName: prefixedEventName,
      status: eventStatus,
      output: eventOutput,
      error: errorMessage,
    },
  );
  try {
    await archiveEventFromFsmPromiseTypeWorker(
      deps,
      event.promiseQueueName,
      event.promiseQueueType,
      event.promiseQueueVersion,
      event.msgId,
      prefixedEventName,
      event.eventActionType,
      eventOutput,
      event.eventDelay,
      event.sendToParentQueueId,
      event.sendToParentQueueIdEventName,
      executionStartedAt.toISOString(),
      executionFinishedAt.getTime() - executionStartedAt.getTime(),
      executionFinishedAt.toISOString(),
      eventStatus,
      eventOutput,
      errorMessage,
    );
  } catch (archiveError) {
    logger.error("Failed to archive event for actor {actorKey}: {error}", {
      actorKey: actorKeyOf(event),
      error: archiveError,
    });
  }
}

async function pollOnce(
  sidecar: SidecarGateway,
  deps: DBDeps,
  invokeTimeoutMs: number,
): Promise<void> {
  const workers: PromiseWorkerIdentity[] = sidecar
    .listRegisteredActorIdentities();
  if (workers.length === 0) {
    logger.info("No registered workers; skipping poll tick");
    return;
  }

  let claimed: Json[];
  try {
    claimed = await claimPendingPromiseEventsForWorkers(deps, workers);
  } catch (error) {
    logger.error("claimPendingPromiseEventsForWorkers failed: {error}", {
      error,
    });
    return;
  }
  logger.info("Claimed {count} pending events for {workerCount} workers", {
    count: claimed.length,
    workerCount: workers.length,
  });
  for (const row of claimed) {
    const event = parseClaimedPromiseEvent(row);
    if (!event) {
      logger.error("Skipping unparseable claimed event row: {row}", {
        row,
      });
      continue;
    }
    // Fire-and-forget: one actor's dispatch never blocks another's, or the
    // next poll tick.
    dispatchAndArchive(sidecar, deps, event, invokeTimeoutMs).catch(
      (error) => {
        logger.error("dispatchAndArchive threw unexpectedly: {error}", {
          error,
        });
      },
    );
  }
}

/**
 * Starts the repeating poll loop (goal step 7). Each tick fetches the
 * sidecar's currently-registered worker identities, asks Postgres for
 * pending work matching them, and dispatches+archives every claimed event
 * without blocking the next tick. Runs until `options.signal` aborts.
 */
export function startAsyncOpPollLoop(
  sidecar: SidecarGateway,
  deps: DBDeps,
  options: AsyncOpPollLoopOptions = {},
): void {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const invokeTimeoutMs = options.invokeTimeoutMs ?? DEFAULT_INVOKE_TIMEOUT_MS;

  (async () => {
    while (!options.signal?.aborted) {
      await pollOnce(sidecar, deps, invokeTimeoutMs);
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  })();

  logger.info("Async-op poll loop started (interval={intervalMs}ms)", {
    intervalMs,
  });
}

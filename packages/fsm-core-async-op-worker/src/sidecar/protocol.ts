// Wire protocol for the gateway <-> per-language worker sidecar connection.
// Ported from the polygot-lang-ipc-worker prototype's
// server/src/sidecar/protocol.ts, with the invoke/result/error bodies
// reshaped to carry the activity contract from KB-001 §3.2 (extended with
// the ActorPluginValidationResult identity fields, since a bare
// {actor, version} pair isn't unique across FSM types/versions — see
// `actorKey()`) instead of the prototype's generic {function_name,
// payload_json}.

export type WireType =
  | "register"
  | "register_ack"
  | "invoke"
  | "invoke_result"
  | "invoke_error"
  | "heartbeat"
  | "cancel"
  | "unregister";

export interface WireEnvelope {
  v: "1.0";
  id: string;
  type: WireType;
  ts_unix_ms: number;
  source: string;
  target: string;
  trace_id?: string;
  body: Record<string, unknown>;
}

// One actor entrypoint a worker process serves, e.g. a single Rust function
// behind an FSM promise-actor. Mirrors ActorPluginValidationResult's identity
// fields (see @pgfsm/compiler's util.ts) — `actorKey()` is what the gateway
// routes on. `fsmLanguage` is part of the key (not just a display field)
// because the identity fields alone aren't guaranteed unique across
// languages — two workers of different languages could otherwise register
// the same parentFsmName/parentFsmVersion/fsmType/fsmName/fsmVersion tuple
// and silently overwrite each other's route (last register wins, see
// gateway.ts's registerWorker).
export interface RegisteredActor {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: string;
  fsmName: string;
  fsmVersion: string;
  fsmLanguage: string;
  timeout_ms?: number;
  description?: string;
}

export function actorKey(
  parentFsmName: string,
  parentFsmVersion: string,
  fsmType: string,
  fsmName: string,
  fsmVersion: string,
  fsmLanguage: string,
): string {
  return `${parentFsmName}@${parentFsmVersion}@${fsmType}@${fsmName}@${fsmVersion}@${fsmLanguage}`;
}

export interface RegisterBody {
  worker_id: string;
  language: string;
  protocol_version: "1.0";
  actors: RegisteredActor[];
}

export interface RegisterAckBody {
  accepted: boolean;
  gateway_protocol_version: "1.0";
  registered_actors: string[];
  rejected_actors: string[];
}

export interface InvokeBody {
  invoke_id: string;
  parent_fsm_name: string;
  parent_fsm_version: string;
  fsm_type: string;
  fsm_name: string;
  fsm_version: string;
  fsm_language: string;
  input: unknown;
  instance_id: string;
  correlation_id: string;
  timeout_ms: number;
  deadline_unix_ms: number;
}

export interface InvokeResultBody {
  invoke_id: string;
  output: unknown;
  duration_ms?: number;
}

export interface InvokeErrorBody {
  invoke_id: string;
  error: {
    code: string;
    message: string;
    retriable?: boolean;
    details?: Record<string, unknown>;
  };
  duration_ms?: number;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function makeEnvelope(
  type: WireType,
  source: string,
  target: string,
  body: Record<string, unknown>,
  traceId?: string,
): WireEnvelope {
  return {
    v: "1.0",
    id: crypto.randomUUID(),
    type,
    ts_unix_ms: Date.now(),
    source,
    target,
    trace_id: traceId,
    body,
  };
}

// Length-prefixed JSON framing (4-byte big-endian length + UTF-8 JSON body)
// over the Unix socket — chosen over newline/stdio framing so an actor's own
// stdout logging can never corrupt the RPC channel (see SPEC-001, Decision
// driver 4 in the original Option C text; still true for the sidecar leg
// under Option B).
export async function writeFrame(
  conn: Deno.Conn,
  envelope: WireEnvelope,
): Promise<void> {
  const payload = textEncoder.encode(JSON.stringify(envelope));
  const lengthPrefix = new Uint8Array(4);
  new DataView(lengthPrefix.buffer).setUint32(0, payload.byteLength, false);

  await conn.write(lengthPrefix);
  await conn.write(payload);
}

async function readExact(
  conn: Deno.Conn,
  size: number,
): Promise<Uint8Array | null> {
  const buffer = new Uint8Array(size);
  let offset = 0;

  while (offset < size) {
    const chunk = await conn.read(buffer.subarray(offset));
    if (chunk === null) {
      return null;
    }
    offset += chunk;
  }

  return buffer;
}

export async function readFrame(
  conn: Deno.Conn,
): Promise<WireEnvelope | null> {
  const prefix = await readExact(conn, 4);
  if (!prefix) {
    return null;
  }

  const length = new DataView(
    prefix.buffer,
    prefix.byteOffset,
    prefix.byteLength,
  ).getUint32(0, false);
  const payload = await readExact(conn, length);
  if (!payload) {
    return null;
  }

  return JSON.parse(textDecoder.decode(payload)) as WireEnvelope;
}

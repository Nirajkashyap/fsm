// Thin gRPC client for the Activity Gateway. Intended caller: the
// "rust"/"go" branch of startPromiseWorkerForLang in
// asyncOperationWorkerlet.ts, once that wiring is implemented per SPEC-001 —
// this file is base scaffolding, not yet integrated there.
//
// The orchestrator keeps owning PGMQ poll/claim/archive; this client is only
// the invocation leg, one call per claimed message.

import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { dirname, fromFileUrl, join } from "@std/path";

const __dirname = dirname(fromFileUrl(import.meta.url));
const protoPath = join(__dirname, "proto", "activity-gateway.proto");

export interface ActivityGatewayClientOptions {
  /** e.g. "unix:/tmp/pgfsm-activity-gateway.sock" or "127.0.0.1:50061" */
  target: string;
}

export interface InvokeActorRequest {
  parentFsmName: string;
  parentFsmVersion: string;
  fsmType: string;
  fsmName: string;
  fsmVersion: string;
  fsmLanguage: string;
  input: unknown;
  instanceId: string;
  correlationId: string;
  timeoutMs: number;
}

export interface InvokeActorResult {
  output: unknown;
}

export class ActivityGatewayInvokeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retriable: boolean,
  ) {
    super(message);
    this.name = "ActivityGatewayInvokeError";
  }
}

type RawInvokeResponse = {
  ok: boolean;
  output_json: string;
  error_code: string;
  error_message: string;
  retriable: boolean;
};

export class ActivityGatewayClient {
  private readonly client: grpc.Client & {
    invoke: (
      request: Record<string, unknown>,
      callback: (
        error: grpc.ServiceError | null,
        response?: RawInvokeResponse,
      ) => void,
    ) => void;
    listRegisteredActors: (
      request: Record<string, never>,
      callback: (
        error: grpc.ServiceError | null,
        response?: { actor_keys: string[] },
      ) => void,
    ) => void;
  };

  constructor(options: ActivityGatewayClientOptions) {
    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });
    const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
      pgfsm: {
        activitygateway: { ActivityGateway: grpc.ServiceClientConstructor };
      };
    };

    this.client = new loaded.pgfsm.activitygateway.ActivityGateway(
      options.target,
      grpc.credentials.createInsecure(),
    ) as unknown as typeof this.client;
  }

  invokeActor(request: InvokeActorRequest): Promise<InvokeActorResult> {
    return new Promise((resolve, reject) => {
      this.client.invoke(
        {
          parent_fsm_name: request.parentFsmName,
          parent_fsm_version: request.parentFsmVersion,
          fsm_type: request.fsmType,
          fsm_name: request.fsmName,
          fsm_version: request.fsmVersion,
          fsm_language: request.fsmLanguage,
          input_json: JSON.stringify(request.input ?? null),
          instance_id: request.instanceId,
          correlation_id: request.correlationId,
          timeout_ms: request.timeoutMs,
        },
        (error, response) => {
          if (error) {
            reject(error);
            return;
          }
          if (!response?.ok) {
            reject(
              new ActivityGatewayInvokeError(
                response?.error_message ?? "activity gateway invoke failed",
                response?.error_code ?? "UNKNOWN",
                response?.retriable ?? false,
              ),
            );
            return;
          }
          resolve({ output: JSON.parse(response.output_json || "null") });
        },
      );
    });
  }

  listRegisteredActors(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.client.listRegisteredActors({}, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response?.actor_keys ?? []);
      });
    });
  }

  close(): void {
    this.client.close();
  }
}

/**
 * `@directive-run/core/worker` on core-next: not built yet (the worker client
 * and its module registry).
 * 1.35's exports with 1.35's names and signatures, taken from
 * packages/conformance/contracts/api-surface.json. Each function throws
 * `featureMissing` (code E_FEATURE_MISSING) when called; the entry arrives
 * in layer 13. Generated for the alpha.0 tarball (slice P3-F5).
 */
import { featureMissing } from "./api/missing.js";
import type { Requirement } from "./types/requirements.js";
import type { ModuleSchema } from "./types/schema.js";
import type {
  DistributableSnapshot,
  DistributableSnapshotOptions,
  SystemInspection,
} from "./types/system.js";

// 1.35 declares this here without exporting it.
type ModuleRegistry = Map<string, any>;

export type TypedWorkerClient<M extends ModuleSchema> = Omit<
  WorkerClient,
  "setFact" | "setFacts" | "dispatch"
> & {
  setFact<K extends keyof M["facts"]>(
    key: K,
    value: M["facts"][K] extends {
      _type: infer T;
    }
      ? T
      : M["facts"][K],
  ): void;
  setFacts(
    facts: Partial<{
      [K in keyof M["facts"]]: M["facts"][K] extends {
        _type: infer T;
      }
        ? T
        : M["facts"][K];
    }>,
  ): void;
  dispatch(
    event: M["events"] extends Record<string, unknown>
      ? {
          [K in keyof M["events"]]: {
            type: K;
          } & M["events"][K];
        }[keyof M["events"]]
      : {
          type: string;
        },
  ): void;
};

export interface WorkerClient {
  init(config: WorkerSystemConfig): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
  setFact(key: string, value: unknown): void;
  setFacts(facts: Record<string, unknown>): void;
  dispatch(event: {
    type: string;
    [key: string]: unknown;
  }): void;
  getSnapshot(
    options?: DistributableSnapshotOptions,
    timeoutMs?: number,
  ): Promise<DistributableSnapshot>;
  inspect(timeoutMs?: number): Promise<SystemInspection>;
  settle(timeout?: number, timeoutMs?: number): Promise<void>;
  terminate(): void;
}

export interface WorkerClientOptions {
  worker: Worker;
  onFactChange?: (key: string, value: unknown, prev: unknown) => void;
  onDerivationChange?: (key: string, value: unknown) => void;
  onRequirementCreated?: (
    requirement: Requirement & {
      id: string;
    },
  ) => void;
  onRequirementMet?: (requirementId: string, resolverId: string) => void;
  onError?: (error: string, source?: string) => void;
}

export type WorkerInboundMessage =
  | {
      type: "INIT";
      config: WorkerSystemConfig;
    }
  | {
      type: "START";
    }
  | {
      type: "STOP";
    }
  | {
      type: "DESTROY";
    }
  | {
      type: "SET_FACT";
      key: string;
      value: unknown;
    }
  | {
      type: "SET_FACTS";
      facts: Record<string, unknown>;
    }
  | {
      type: "DISPATCH";
      event: {
        type: string;
        [key: string]: unknown;
      };
    }
  | {
      type: "GET_SNAPSHOT";
      options?: DistributableSnapshotOptions;
      requestId: string;
    }
  | {
      type: "INSPECT";
      requestId: string;
    }
  | {
      type: "SETTLE";
      timeout?: number;
      requestId: string;
    };

export type WorkerOutboundMessage =
  | {
      type: "READY";
    }
  | {
      type: "STARTED";
    }
  | {
      type: "STOPPED";
    }
  | {
      type: "DESTROYED";
    }
  | {
      type: "FACT_CHANGED";
      key: string;
      value: unknown;
      prev: unknown;
    }
  | {
      type: "DERIVATION_CHANGED";
      key: string;
      value: unknown;
    }
  | {
      type: "REQUIREMENT_CREATED";
      requirement: Requirement & {
        id: string;
      };
    }
  | {
      type: "REQUIREMENT_MET";
      requirementId: string;
      resolverId: string;
    }
  | {
      type: "ERROR";
      error: string;
      source?: string;
    }
  | {
      type: "SNAPSHOT_RESULT";
      requestId: string;
      snapshot: DistributableSnapshot;
    }
  | {
      type: "INSPECT_RESULT";
      requestId: string;
      inspection: SystemInspection;
    }
  | {
      type: "SETTLE_RESULT";
      requestId: string;
      success: boolean;
      error?: string;
    };

export interface WorkerSystemConfig {
  moduleNames: string[];
  history?:
    | boolean
    | {
        maxSnapshots?: number;
      };
}

export function createWorkerClient(options: WorkerClientOptions): WorkerClient;
export function createWorkerClient(): never {
  return featureMissing("createWorkerClient", 13);
}

export function getWorkerModuleRegistry(): ModuleRegistry;
export function getWorkerModuleRegistry(): never {
  return featureMissing("getWorkerModuleRegistry", 13);
}

export function handleWorkerMessages(): void;
export function handleWorkerMessages(): never {
  return featureMissing("handleWorkerMessages", 13);
}

export function registerWorkerModule(name: string, module: any): void;
export function registerWorkerModule(): never {
  return featureMissing("registerWorkerModule", 13);
}

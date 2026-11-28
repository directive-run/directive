/**
 * `@directive-run/core/worker` on core-next (layer 13, W1 to W7 of the L13
 * RFC): a system run in a Web Worker and mirrored to the page. Ported line
 * for line from 1.35's packages/core/src/adapters/worker.ts; the message
 * protocol is unchanged (names, fields, `"module::fact"` keys, the batch fold
 * and the `ERROR` texts).
 *
 * The page side, `createWorkerClient`, imports no engine. The worker side
 * imports `createSystem` lazily, as 1.35 does, so a page bundle that imports
 * only the client carries no engine.
 *
 * A message that arrives before `INIT` or after `DESTROY` is dropped with no
 * reply, as 1.35 (row (cc) of the RFC was declined).
 *
 * The types below are 1.35's, as packages/conformance/contracts/api-surface.json
 * records them.
 */
import type { FactChange } from "../types/facts.js";
import type { Requirement } from "../types/requirements.js";
import type { ModuleSchema } from "../types/schema.js";
import type {
  DistributableSnapshot,
  DistributableSnapshotOptions,
  SystemInspection,
} from "../types/system.js";

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

export function createWorkerClient(options: WorkerClientOptions): WorkerClient {
  const {
    worker,
    onFactChange,
    onDerivationChange,
    onRequirementCreated,
    onRequirementMet,
    onError,
  } = options;

  // Pending request callbacks. Each entry MAY hold a timeout handle so we
  // can clear it on resolve/reject without leaking the timer.
  const pendingRequests = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timeoutHandle?: ReturnType<typeof setTimeout>;
    }
  >();
  let requestIdCounter = 0;

  /** Default per-request timeout (ms). 0 / Infinity = disabled. */
  const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

  function clearPendingTimeout(requestId: string): void {
    const pending = pendingRequests.get(requestId);
    if (pending?.timeoutHandle !== undefined) {
      clearTimeout(pending.timeoutHandle);
    }
  }

  // Promise resolvers for lifecycle events
  let initResolve: (() => void) | null = null;
  let startResolve: (() => void) | null = null;
  let stopResolve: (() => void) | null = null;
  let destroyResolve: (() => void) | null = null;

  // ---- Outbound message handlers ----

  function resolveLifecycle(resolve: (() => void) | null): (() => void) | null {
    resolve?.();

    return null;
  }

  function resolvePendingRequest(requestId: string, value: unknown): void {
    const pending = pendingRequests.get(requestId);
    if (pending) {
      clearPendingTimeout(requestId);
      pending.resolve(value);
      pendingRequests.delete(requestId);
    }
  }

  function handleReady(): void {
    initResolve = resolveLifecycle(initResolve);
  }

  function handleStarted(): void {
    startResolve = resolveLifecycle(startResolve);
  }

  function handleStopped(): void {
    stopResolve = resolveLifecycle(stopResolve);
  }

  function handleDestroyed(): void {
    destroyResolve = resolveLifecycle(destroyResolve);
  }

  function handleFactChanged(
    message: Extract<WorkerOutboundMessage, { type: "FACT_CHANGED" }>,
  ): void {
    onFactChange?.(message.key, message.value, message.prev);
  }

  function handleDerivationChanged(
    message: Extract<WorkerOutboundMessage, { type: "DERIVATION_CHANGED" }>,
  ): void {
    onDerivationChange?.(message.key, message.value);
  }

  function handleRequirementCreated(
    message: Extract<WorkerOutboundMessage, { type: "REQUIREMENT_CREATED" }>,
  ): void {
    onRequirementCreated?.(message.requirement);
  }

  function handleRequirementMet(
    message: Extract<WorkerOutboundMessage, { type: "REQUIREMENT_MET" }>,
  ): void {
    onRequirementMet?.(message.requirementId, message.resolverId);
  }

  function handleError(
    message: Extract<WorkerOutboundMessage, { type: "ERROR" }>,
  ): void {
    onError?.(message.error, message.source);
  }

  function handleSnapshotResult(
    message: Extract<WorkerOutboundMessage, { type: "SNAPSHOT_RESULT" }>,
  ): void {
    resolvePendingRequest(message.requestId, message.snapshot);
  }

  function handleInspectResult(
    message: Extract<WorkerOutboundMessage, { type: "INSPECT_RESULT" }>,
  ): void {
    resolvePendingRequest(message.requestId, message.inspection);
  }

  function handleSettleResult(
    message: Extract<WorkerOutboundMessage, { type: "SETTLE_RESULT" }>,
  ): void {
    const pending = pendingRequests.get(message.requestId);
    if (pending) {
      clearPendingTimeout(message.requestId);
      if (message.success) {
        pending.resolve(undefined);
      } else {
        pending.reject(new Error(message.error || "Settle failed"));
      }
      pendingRequests.delete(message.requestId);
    }
  }

  // Handle messages from worker
  worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
    const message = event.data;

    switch (message.type) {
      case "READY":
        return handleReady();
      case "STARTED":
        return handleStarted();
      case "STOPPED":
        return handleStopped();
      case "DESTROYED":
        return handleDestroyed();
      case "FACT_CHANGED":
        return handleFactChanged(message);
      case "DERIVATION_CHANGED":
        return handleDerivationChanged(message);
      case "REQUIREMENT_CREATED":
        return handleRequirementCreated(message);
      case "REQUIREMENT_MET":
        return handleRequirementMet(message);
      case "ERROR":
        return handleError(message);
      case "SNAPSHOT_RESULT":
        return handleSnapshotResult(message);
      case "INSPECT_RESULT":
        return handleInspectResult(message);
      case "SETTLE_RESULT":
        return handleSettleResult(message);
    }
  };

  worker.onerror = (event) => {
    const msg =
      event && typeof event === "object" && "message" in event
        ? String((event as { message?: unknown }).message ?? "unknown error")
        : "unknown error";
    // Reject ALL pending requests so they don't leak when the worker dies.
    if (pendingRequests.size > 0) {
      const err = new Error(`[Directive] worker errored: ${msg}`);
      for (const [, pending] of pendingRequests) {
        if (pending.timeoutHandle !== undefined) {
          clearTimeout(pending.timeoutHandle);
        }
        pending.reject(err);
      }
      pendingRequests.clear();
    }
    onError?.(msg, "worker");
  };

  function send(message: WorkerInboundMessage): void {
    worker.postMessage(message);
  }

  function request<T>(
    message: WorkerInboundMessage & { requestId: string },
    timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const entry: {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timeoutHandle?: ReturnType<typeof setTimeout>;
      } = {
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      // Only arm the timer if a finite positive timeout was requested.
      if (Number.isFinite(timeoutMs) && (timeoutMs as number) > 0) {
        entry.timeoutHandle = setTimeout(() => {
          if (pendingRequests.has(message.requestId)) {
            pendingRequests.delete(message.requestId);
            reject(
              new Error(
                `[Directive] worker request timed out after ${timeoutMs}ms`,
              ),
            );
          }
        }, timeoutMs);
      }

      pendingRequests.set(message.requestId, entry);
      send(message);
    });
  }

  return {
    init(config: WorkerSystemConfig): Promise<void> {
      return new Promise((resolve) => {
        initResolve = resolve;
        send({ type: "INIT", config });
      });
    },

    start(): Promise<void> {
      return new Promise((resolve) => {
        startResolve = resolve;
        send({ type: "START" });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        stopResolve = resolve;
        send({ type: "STOP" });
      });
    },

    destroy(): Promise<void> {
      return new Promise((resolve) => {
        destroyResolve = resolve;
        send({ type: "DESTROY" });
      });
    },

    setFact(key: string, value: unknown): void {
      send({ type: "SET_FACT", key, value });
    },

    setFacts(facts: Record<string, unknown>): void {
      send({ type: "SET_FACTS", facts });
    },

    dispatch(event: { type: string; [key: string]: unknown }): void {
      send({ type: "DISPATCH", event });
    },

    getSnapshot(
      options?: DistributableSnapshotOptions,
      timeoutMs?: number,
    ): Promise<DistributableSnapshot> {
      const requestId = `snapshot-${++requestIdCounter}`;
      return request(
        { type: "GET_SNAPSHOT", options, requestId },
        timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      );
    },

    inspect(timeoutMs?: number): Promise<SystemInspection> {
      const requestId = `inspect-${++requestIdCounter}`;
      return request(
        { type: "INSPECT", requestId },
        timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      );
    },

    settle(timeout?: number, timeoutMs?: number): Promise<void> {
      const requestId = `settle-${++requestIdCounter}`;
      return request(
        { type: "SETTLE", timeout, requestId },
        timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      );
    },

    terminate(): void {
      worker.terminate();
    },
  };
}

// ============================================================================
// Worker-Side API
// ============================================================================

/**
 * Module registration for worker-side systems.
 * Since functions can't be serialized, modules must be registered in the worker.
 */
type ModuleRegistry = Map<string, any>;

let workerModuleRegistry: ModuleRegistry | null = null;

/**
 * Get or create the module registry for worker-side modules.
 */
export function getWorkerModuleRegistry(): ModuleRegistry {
  if (!workerModuleRegistry) {
    workerModuleRegistry = new Map();
  }
  return workerModuleRegistry;
}

/**
 * Register a module for use in workers.
 * Call this in your worker script before handling INIT messages.
 *
 * @example
 * ```typescript
 * // directive.worker.ts
 * import { registerWorkerModule, handleWorkerMessages } from '@directive-run/core/worker';
 * import { myModule } from './modules/my-module';
 *
 * registerWorkerModule('myModule', myModule);
 * handleWorkerMessages();
 * ```
 */
export function registerWorkerModule(name: string, module: any): void {
  getWorkerModuleRegistry().set(name, module);
}

/**
 * Handler for worker-side message processing.
 * Sets up the message listener and creates/manages the Directive system.
 *
 * @example
 * ```typescript
 * // directive.worker.ts
 * import { registerWorkerModule, handleWorkerMessages } from '@directive-run/core/worker';
 *
 * registerWorkerModule('myModule', myModule);
 * handleWorkerMessages();
 * ```
 */
export function handleWorkerMessages(): void {
  // Dynamic import to avoid issues in non-worker contexts
  // The actual system creation happens when messages are received
  type WorkerSystem = Awaited<ReturnType<typeof createWorkerSystem>>;
  let system: WorkerSystem | null = null;

  // ---- Inbound message handlers ----

  async function handleInit(
    message: Extract<WorkerInboundMessage, { type: "INIT" }>,
  ): Promise<WorkerSystem> {
    const created = await createWorkerSystem(message.config);
    postMessage({ type: "READY" } satisfies WorkerOutboundMessage);

    return created;
  }

  function handleStart(sys: WorkerSystem): void {
    sys.start();
    postMessage({ type: "STARTED" } satisfies WorkerOutboundMessage);
  }

  function handleStop(sys: WorkerSystem): void {
    sys.stop();
    postMessage({ type: "STOPPED" } satisfies WorkerOutboundMessage);
  }

  function handleDestroy(sys: WorkerSystem): void {
    sys.destroy();
    postMessage({ type: "DESTROYED" } satisfies WorkerOutboundMessage);
  }

  function handleGetSnapshot(
    sys: WorkerSystem,
    message: Extract<WorkerInboundMessage, { type: "GET_SNAPSHOT" }>,
  ): void {
    const snapshot = sys.getSnapshot(message.options);
    postMessage({
      type: "SNAPSHOT_RESULT",
      requestId: message.requestId,
      snapshot,
    } satisfies WorkerOutboundMessage);
  }

  function handleInspect(
    sys: WorkerSystem,
    message: Extract<WorkerInboundMessage, { type: "INSPECT" }>,
  ): void {
    const inspection = sys.inspect();
    postMessage({
      type: "INSPECT_RESULT",
      requestId: message.requestId,
      inspection,
    } satisfies WorkerOutboundMessage);
  }

  async function handleSettle(
    sys: WorkerSystem,
    message: Extract<WorkerInboundMessage, { type: "SETTLE" }>,
  ): Promise<void> {
    try {
      await sys.settle(message.timeout);
      postMessage({
        type: "SETTLE_RESULT",
        requestId: message.requestId,
        success: true,
      } satisfies WorkerOutboundMessage);
    } catch (error) {
      postMessage({
        type: "SETTLE_RESULT",
        requestId: message.requestId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies WorkerOutboundMessage);
    }
  }

  // ---- Message dispatch ----

  async function dispatchMessage(message: WorkerInboundMessage): Promise<void> {
    if (message.type === "INIT") {
      system = await handleInit(message);

      return;
    }

    if (!system) {
      return;
    }

    switch (message.type) {
      case "START":
        handleStart(system);
        break;
      case "STOP":
        handleStop(system);
        break;
      case "DESTROY":
        handleDestroy(system);
        system = null;
        break;
      case "SET_FACT":
        system.setFact(message.key, message.value);
        break;
      case "SET_FACTS":
        system.setFacts(message.facts);
        break;
      case "DISPATCH":
        system.dispatch(message.event);
        break;
      case "GET_SNAPSHOT":
        handleGetSnapshot(system, message);
        break;
      case "INSPECT":
        handleInspect(system, message);
        break;
      case "SETTLE":
        await handleSettle(system, message);
        break;
    }
  }

  self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
    try {
      await dispatchMessage(event.data);
    } catch (error) {
      postMessage({
        type: "ERROR",
        error: error instanceof Error ? error.message : String(error),
        source: event.data.type,
      } satisfies WorkerOutboundMessage);
    }
  };
}

/**
 * Internal: Create a system inside the worker.
 */
/** The separator between a module name and a fact name. */
const NAMESPACE_SEPARATOR = "::";

/**
 * Write one fact into a worker system, through the module that owns it.
 *
 * A worker always builds a namespaced system, whose top-level facts object
 * exposes a namespace per module and refuses a flat `module::fact` assignment —
 * correctly, since that name belongs to a module rather than to the system. It
 * was being assigned flat anyway, so the proxy rejected it and every write into
 * a worker failed, for every worker, with no test covering either message.
 *
 * A key naming no module says so rather than being dropped: these arrive from
 * the other side of a thread boundary, where a typo has nothing else to
 * announce it.
 */
function writeFact(
  system: { facts: unknown },
  key: string,
  value: unknown,
): void {
  const separatorAt = key.indexOf(NAMESPACE_SEPARATOR);
  if (separatorAt <= 0) {
    throw new Error(
      `[Directive] worker: fact key "${key}" names no module. Use "<module>${NAMESPACE_SEPARATOR}<fact>".`,
    );
  }
  const moduleName = key.slice(0, separatorAt);
  const factName = key.slice(separatorAt + NAMESPACE_SEPARATOR.length);
  const owner = (system.facts as Record<string, unknown>)[moduleName] as
    | Record<string, unknown>
    | undefined;
  if (owner === undefined || typeof owner !== "object") {
    throw new Error(
      `[Directive] worker: no module named "${moduleName}" in this system, so "${key}" was not written.`,
    );
  }
  owner[factName] = value;
}

async function createWorkerSystem(config: WorkerSystemConfig) {
  // Dynamically import createSystem to avoid circular dependencies
  const { createSystem } = await import("../api/system.js");

  const registry = getWorkerModuleRegistry();
  const modules: Record<string, unknown> = {};

  for (const name of config.moduleNames) {
    const module = registry.get(name);
    if (!module) {
      throw new Error(
        `[Directive Worker] Module "${name}" not registered. ` +
          `Call registerWorkerModule('${name}', module) before handling messages.`,
      );
    }
    modules[name] = module;
  }

  // Create tracking plugin to notify main thread
  const mirrorFactChange = (key: string, value: unknown, prev: unknown) => {
    postMessage({
      type: "FACT_CHANGED",
      key,
      value,
      prev,
    } satisfies WorkerOutboundMessage);
  };

  const trackingPlugin = {
    name: "__worker-tracking__",
    onFactSet: mirrorFactChange,
    // Batched writes reach a different hook, and this message is the only path
    // a fact value has across the boundary — there is no wholesale sync behind
    // it. Watching only the unbatched hook meant the main thread missed every
    // write an event handler made, which is most of them, and its view drifted
    // from the worker's with nothing reporting it.
    //
    // Derived values are not gated the same way, so the mirror could be told a
    // computed value changed while never being told the fact it is computed
    // from had — two numbers on screen that contradict each other, both
    // delivered by a healthy-looking channel.
    onFactsBatch: (changes: FactChange[]) => {
      // Coalesced per run of consecutive writes to a key, the same way the
      // observation stream does it, because this is the same problem and two
      // policies for one stream is how the original defect happened.
      //
      // Every message here is a structured clone across a thread boundary and
      // a render on the other side. A handler writing one key a thousand times
      // in a batch would post a thousand of them carrying nine hundred and
      // ninety-nine values the main thread can never observe — it only ever
      // sees the last. Cut at a change of key so the pairs still chain.
      let open: { key: string; value: unknown; prev: unknown } | null = null;
      const flushOpen = () => {
        if (open === null) return;
        mirrorFactChange(open.key, open.value, open.prev);
        open = null;
      };
      for (const change of changes) {
        const value = change.type === "delete" ? undefined : change.value;
        if (open !== null && open.key === change.key) {
          open.value = value;
          continue;
        }
        flushOpen();
        open = { key: change.key, value, prev: change.prev };
      }
      flushOpen();
    },
    onDerivationCompute: (id: string, value: unknown) => {
      postMessage({
        type: "DERIVATION_CHANGED",
        key: id,
        value,
      } satisfies WorkerOutboundMessage);
    },
    onRequirementCreated: (req: { id: string; requirement: Requirement }) => {
      postMessage({
        type: "REQUIREMENT_CREATED",
        requirement: { ...req.requirement, id: req.id },
      } satisfies WorkerOutboundMessage);
    },
    onRequirementMet: (req: { id: string }, resolverId: string) => {
      postMessage({
        type: "REQUIREMENT_MET",
        requirementId: req.id,
        resolverId,
      } satisfies WorkerOutboundMessage);
    },
  };

  const system = createSystem({
    modules: modules as any,
    plugins: [trackingPlugin],
    history: config.history,
  });

  return {
    start: () => system.start(),
    stop: () => system.stop(),
    destroy: () => system.destroy(),
    setFact: (key: string, value: unknown) => {
      writeFact(system, key, value);
    },
    setFacts: (facts: Record<string, unknown>) => {
      // One batch, so a set of facts that belong together arrive together —
      // the reconcile sees them as one transition rather than as several, and
      // the mirror coalesces them into one message per key.
      system.batch(() => {
        for (const [key, value] of Object.entries(facts)) {
          writeFact(system, key, value);
        }
      });
    },
    dispatch: (event: { type: string }) => {
      (system as any).dispatch(event);
    },
    getSnapshot: (options?: DistributableSnapshotOptions) => {
      return system.getDistributableSnapshot(options);
    },
    inspect: () => system.inspect(),
    settle: (timeout?: number) => system.settle(timeout),
  };
}

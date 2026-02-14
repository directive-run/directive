/**
 * Web Worker Adapter - Run Directive engine off the main thread
 *
 * Features:
 * - Run computations in a dedicated worker
 * - Synchronized state between main thread and worker
 * - Automatic serialization of facts and derivations
 * - Event-based communication
 */

import type {
	DistributableSnapshot,
	DistributableSnapshotOptions,
	ModuleSchema,
	Requirement,
	SystemInspection,
} from "../core/types.js";

// ============================================================================
// Message Types
// ============================================================================

/** Messages sent from main thread to worker */
export type WorkerInboundMessage =
	| { type: "INIT"; config: WorkerSystemConfig }
	| { type: "START" }
	| { type: "STOP" }
	| { type: "DESTROY" }
	| { type: "SET_FACT"; key: string; value: unknown }
	| { type: "SET_FACTS"; facts: Record<string, unknown> }
	| { type: "DISPATCH"; event: { type: string; [key: string]: unknown } }
	| { type: "GET_SNAPSHOT"; options?: DistributableSnapshotOptions; requestId: string }
	| { type: "INSPECT"; requestId: string }
	| { type: "SETTLE"; timeout?: number; requestId: string };

/** Messages sent from worker to main thread */
export type WorkerOutboundMessage =
	| { type: "READY" }
	| { type: "STARTED" }
	| { type: "STOPPED" }
	| { type: "DESTROYED" }
	| { type: "FACT_CHANGED"; key: string; value: unknown; prev: unknown }
	| { type: "DERIVATION_CHANGED"; key: string; value: unknown }
	| { type: "REQUIREMENT_CREATED"; requirement: Requirement & { id: string } }
	| { type: "REQUIREMENT_MET"; requirementId: string; resolverId: string }
	| { type: "ERROR"; error: string; source?: string }
	| { type: "SNAPSHOT_RESULT"; requestId: string; snapshot: DistributableSnapshot }
	| { type: "INSPECT_RESULT"; requestId: string; inspection: SystemInspection }
	| { type: "SETTLE_RESULT"; requestId: string; success: boolean; error?: string };

// ============================================================================
// Worker System Config
// ============================================================================

/**
 * Configuration for creating a system inside a worker.
 * Note: Functions cannot be serialized, so modules must be defined
 * in the worker script itself using createWorkerModule.
 */
export interface WorkerSystemConfig {
	/** Module names to initialize (modules must be registered in worker) */
	moduleNames: string[];
	/** Debug configuration */
	debug?: {
		timeTravel?: boolean;
		maxSnapshots?: number;
	};
}

// ============================================================================
// Main Thread API
// ============================================================================

/**
 * Options for creating a worker client.
 */
export interface WorkerClientOptions {
	/** The web worker instance */
	worker: Worker;
	/** Callback when a fact changes in the worker */
	onFactChange?: (key: string, value: unknown, prev: unknown) => void;
	/** Callback when a derivation changes in the worker */
	onDerivationChange?: (key: string, value: unknown) => void;
	/** Callback when a requirement is created */
	onRequirementCreated?: (requirement: Requirement & { id: string }) => void;
	/** Callback when a requirement is met */
	onRequirementMet?: (requirementId: string, resolverId: string) => void;
	/** Callback when an error occurs */
	onError?: (error: string, source?: string) => void;
}

/**
 * Client for interacting with a Directive system running in a Web Worker.
 */
export interface WorkerClient {
	/** Initialize the worker system */
	init(config: WorkerSystemConfig): Promise<void>;
	/** Start the worker system */
	start(): Promise<void>;
	/** Stop the worker system */
	stop(): Promise<void>;
	/** Destroy the worker system and terminate the worker */
	destroy(): Promise<void>;
	/** Set a single fact */
	setFact(key: string, value: unknown): void;
	/** Set multiple facts at once */
	setFacts(facts: Record<string, unknown>): void;
	/** Dispatch an event */
	dispatch(event: { type: string; [key: string]: unknown }): void;
	/** Get a distributable snapshot */
	getSnapshot(options?: DistributableSnapshotOptions): Promise<DistributableSnapshot>;
	/** Inspect the system state */
	inspect(): Promise<SystemInspection>;
	/** Wait for the system to settle */
	settle(timeout?: number): Promise<void>;
	/** Terminate the worker */
	terminate(): void;
}

/**
 * Create a client for communicating with a Directive worker.
 *
 * @example
 * ```typescript
 * // main.ts
 * const worker = new Worker(new URL('./directive.worker.ts', import.meta.url));
 * const client = createWorkerClient({
 *   worker,
 *   onFactChange: (key, value) => console.log(`Fact ${key} = ${value}`),
 * });
 *
 * await client.init({ moduleNames: ['myModule'] });
 * await client.start();
 * client.setFact('userId', '123');
 * ```
 */
export function createWorkerClient(options: WorkerClientOptions): WorkerClient {
	const {
		worker,
		onFactChange,
		onDerivationChange,
		onRequirementCreated,
		onRequirementMet,
		onError,
	} = options;

	// Pending request callbacks
	const pendingRequests = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	let requestIdCounter = 0;

	// Promise resolvers for lifecycle events
	let initResolve: (() => void) | null = null;
	let startResolve: (() => void) | null = null;
	let stopResolve: (() => void) | null = null;
	let destroyResolve: (() => void) | null = null;

	// Handle messages from worker
	worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
		const message = event.data;

		switch (message.type) {
			case "READY":
				initResolve?.();
				initResolve = null;
				break;

			case "STARTED":
				startResolve?.();
				startResolve = null;
				break;

			case "STOPPED":
				stopResolve?.();
				stopResolve = null;
				break;

			case "DESTROYED":
				destroyResolve?.();
				destroyResolve = null;
				break;

			case "FACT_CHANGED":
				onFactChange?.(message.key, message.value, message.prev);
				break;

			case "DERIVATION_CHANGED":
				onDerivationChange?.(message.key, message.value);
				break;

			case "REQUIREMENT_CREATED":
				onRequirementCreated?.(message.requirement);
				break;

			case "REQUIREMENT_MET":
				onRequirementMet?.(message.requirementId, message.resolverId);
				break;

			case "ERROR":
				onError?.(message.error, message.source);
				break;

			case "SNAPSHOT_RESULT": {
				const pending = pendingRequests.get(message.requestId);
				if (pending) {
					pending.resolve(message.snapshot);
					pendingRequests.delete(message.requestId);
				}
				break;
			}

			case "INSPECT_RESULT": {
				const pending = pendingRequests.get(message.requestId);
				if (pending) {
					pending.resolve(message.inspection);
					pendingRequests.delete(message.requestId);
				}
				break;
			}

			case "SETTLE_RESULT": {
				const pending = pendingRequests.get(message.requestId);
				if (pending) {
					if (message.success) {
						pending.resolve(undefined);
					} else {
						pending.reject(new Error(message.error || "Settle failed"));
					}
					pendingRequests.delete(message.requestId);
				}
				break;
			}
		}
	};

	worker.onerror = (event) => {
		onError?.(event.message, "worker");
	};

	function send(message: WorkerInboundMessage): void {
		worker.postMessage(message);
	}

	function request<T>(
		message: WorkerInboundMessage & { requestId: string },
	): Promise<T> {
		return new Promise((resolve, reject) => {
			pendingRequests.set(message.requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
			});
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

		getSnapshot(options?: DistributableSnapshotOptions): Promise<DistributableSnapshot> {
			const requestId = `snapshot-${++requestIdCounter}`;
			return request({ type: "GET_SNAPSHOT", options, requestId });
		},

		inspect(): Promise<SystemInspection> {
			const requestId = `inspect-${++requestIdCounter}`;
			return request({ type: "INSPECT", requestId });
		},

		settle(timeout?: number): Promise<void> {
			const requestId = `settle-${++requestIdCounter}`;
			return request({ type: "SETTLE", timeout, requestId });
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
// biome-ignore lint/suspicious/noExplicitAny: Module types vary
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
// biome-ignore lint/suspicious/noExplicitAny: Module type varies
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
	let system: Awaited<ReturnType<typeof createWorkerSystem>> | null = null;

	self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
		const message = event.data;

		try {
			switch (message.type) {
				case "INIT": {
					system = await createWorkerSystem(message.config);
					postMessage({ type: "READY" } satisfies WorkerOutboundMessage);
					break;
				}

				case "START": {
					if (system) {
						system.start();
						postMessage({ type: "STARTED" } satisfies WorkerOutboundMessage);
					}
					break;
				}

				case "STOP": {
					if (system) {
						system.stop();
						postMessage({ type: "STOPPED" } satisfies WorkerOutboundMessage);
					}
					break;
				}

				case "DESTROY": {
					if (system) {
						system.destroy();
						system = null;
						postMessage({ type: "DESTROYED" } satisfies WorkerOutboundMessage);
					}
					break;
				}

				case "SET_FACT": {
					if (system) {
						system.setFact(message.key, message.value);
					}
					break;
				}

				case "SET_FACTS": {
					if (system) {
						system.setFacts(message.facts);
					}
					break;
				}

				case "DISPATCH": {
					if (system) {
						system.dispatch(message.event);
					}
					break;
				}

				case "GET_SNAPSHOT": {
					if (system) {
						const snapshot = system.getSnapshot(message.options);
						postMessage({
							type: "SNAPSHOT_RESULT",
							requestId: message.requestId,
							snapshot,
						} satisfies WorkerOutboundMessage);
					}
					break;
				}

				case "INSPECT": {
					if (system) {
						const inspection = system.inspect();
						postMessage({
							type: "INSPECT_RESULT",
							requestId: message.requestId,
							inspection,
						} satisfies WorkerOutboundMessage);
					}
					break;
				}

				case "SETTLE": {
					if (system) {
						try {
							await system.settle(message.timeout);
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
					break;
				}
			}
		} catch (error) {
			postMessage({
				type: "ERROR",
				error: error instanceof Error ? error.message : String(error),
				source: message.type,
			} satisfies WorkerOutboundMessage);
		}
	};
}

/**
 * Internal: Create a system inside the worker.
 */
async function createWorkerSystem(config: WorkerSystemConfig) {
	// Dynamically import createSystem to avoid circular dependencies
	const { createSystem } = await import("../core/system.js");

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
	const trackingPlugin = {
		name: "__worker-tracking__",
		onFactSet: (key: string, value: unknown, prev: unknown) => {
			postMessage({
				type: "FACT_CHANGED",
				key,
				value,
				prev,
			} satisfies WorkerOutboundMessage);
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

	// biome-ignore lint/suspicious/noExplicitAny: Dynamic module types
	const system = createSystem({
		modules: modules as any,
		plugins: [trackingPlugin],
		debug: config.debug,
	});

	return {
		start: () => system.start(),
		stop: () => system.stop(),
		destroy: () => system.destroy(),
		setFact: (key: string, value: unknown) => {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic facts access
			(system.facts as any)[key] = value;
		},
		setFacts: (facts: Record<string, unknown>) => {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic facts access
			const factsProxy = system.facts as any;
			if (factsProxy.$store?.batch) {
				factsProxy.$store.batch(() => {
					for (const [key, value] of Object.entries(facts)) {
						factsProxy[key] = value;
					}
				});
			} else {
				// Fallback: set facts one by one
				for (const [key, value] of Object.entries(facts)) {
					factsProxy[key] = value;
				}
			}
		},
		dispatch: (event: { type: string }) => {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic dispatch
			(system as any).dispatch(event);
		},
		getSnapshot: (options?: DistributableSnapshotOptions) => {
			return system.getDistributableSnapshot(options);
		},
		inspect: () => system.inspect(),
		settle: (timeout?: number) => system.settle(timeout),
	};
}

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Type helper for creating type-safe worker clients.
 * Use this to get proper typing for facts and events.
 *
 * @example
 * ```typescript
 * type MyWorkerClient = TypedWorkerClient<typeof myModuleSchema>;
 * const client = createWorkerClient(options) as MyWorkerClient;
 * client.setFact('userId', '123'); // Type-checked!
 * ```
 */
export type TypedWorkerClient<M extends ModuleSchema> = Omit<
	WorkerClient,
	"setFact" | "setFacts" | "dispatch"
> & {
	setFact<K extends keyof M["facts"]>(
		key: K,
		value: M["facts"][K] extends { _type: infer T } ? T : M["facts"][K],
	): void;
	setFacts(facts: Partial<{
		[K in keyof M["facts"]]: M["facts"][K] extends { _type: infer T } ? T : M["facts"][K];
	}>): void;
	dispatch(event: M["events"] extends Record<string, unknown>
		? { [K in keyof M["events"]]: { type: K } & M["events"][K] }[keyof M["events"]]
		: { type: string }
	): void;
};

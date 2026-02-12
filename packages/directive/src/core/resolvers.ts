/**
 * Resolvers - Capability-based handlers for requirements
 *
 * Features:
 * - Capability matching (handles predicate)
 * - Custom dedupe keys
 * - Retry policies with exponential backoff
 * - Batched resolution for similar requirements
 * - Cancellation via AbortController
 */

import type {
	BatchConfig,
	BatchResolveResults,
	Facts,
	FactsSnapshot,
	FactsStore,
	Requirement,
	RequirementWithId,
	ResolverContext,
	ResolversDef,
	ResolverStatus,
	RetryPolicy,
	Schema,
} from "./types.js";
import { withTimeout } from "../utils/utils.js";

// ============================================================================
// Resolvers Manager
// ============================================================================

/** Inflight resolver info */
export interface InflightInfo {
	id: string;
	resolverId: string;
	startedAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ResolversManager<_S extends Schema> {
	/** Start resolving a requirement */
	resolve(req: RequirementWithId): void;
	/** Cancel a resolver by requirement ID */
	cancel(requirementId: string): void;
	/** Cancel all inflight resolvers */
	cancelAll(): void;
	/** Get status of a resolver by requirement ID */
	getStatus(requirementId: string): ResolverStatus;
	/** Get all inflight requirement IDs */
	getInflight(): string[];
	/** Get full info for all inflight resolvers */
	getInflightInfo(): InflightInfo[];
	/** Check if a requirement is being resolved */
	isResolving(requirementId: string): boolean;
	/** Process batched requirements (called periodically) */
	processBatches(): void;
}

/** Internal resolver state */
interface ResolverState {
	requirementId: string;
	resolverId: string;
	controller: AbortController;
	startedAt: number;
	attempt: number;
	status: ResolverStatus;
	/** Original requirement for proper cancel callback */
	originalRequirement: RequirementWithId;
}

/** Batch state for batched resolvers */
interface BatchState {
	resolverId: string;
	requirements: RequirementWithId[];
	timer: ReturnType<typeof setTimeout> | null;
}

/** Options for creating a resolvers manager */
export interface CreateResolversOptions<S extends Schema> {
	definitions: ResolversDef<S>;
	facts: Facts<S>;
	store: FactsStore<S>;
	/** Callback when a resolver starts */
	onStart?: (resolver: string, req: RequirementWithId) => void;
	/** Callback when a resolver completes */
	onComplete?: (resolver: string, req: RequirementWithId, duration: number) => void;
	/** Callback when a resolver errors */
	onError?: (resolver: string, req: RequirementWithId, error: unknown) => void;
	/** Callback when a resolver retries */
	onRetry?: (resolver: string, req: RequirementWithId, attempt: number) => void;
	/** Callback when a resolver is canceled */
	onCancel?: (resolver: string, req: RequirementWithId) => void;
	/** Callback when resolution cycle completes (for reconciliation) */
	onResolutionComplete?: () => void;
}

/** Default retry policy */
const DEFAULT_RETRY: RetryPolicy = {
	attempts: 1,
	backoff: "none",
	initialDelay: 100,
	maxDelay: 30000,
};

/** Default batch config */
const DEFAULT_BATCH: BatchConfig = {
	enabled: false,
	windowMs: 50,
};

/**
 * Calculate delay for a retry attempt.
 */
function calculateDelay(policy: RetryPolicy, attempt: number): number {
	const { backoff, initialDelay = 100, maxDelay = 30000 } = policy;

	let delay: number;

	switch (backoff) {
		case "none":
			delay = initialDelay;
			break;
		case "linear":
			delay = initialDelay * attempt;
			break;
		case "exponential":
			delay = initialDelay * Math.pow(2, attempt - 1);
			break;
		default:
			delay = initialDelay;
	}

	// Ensure delay is at least 1ms to prevent busy loops
	return Math.max(1, Math.min(delay, maxDelay));
}

/**
 * Create a resolvers manager.
 */
export function createResolversManager<S extends Schema>(
	options: CreateResolversOptions<S>,
): ResolversManager<S> {
	const {
		definitions,
		facts,
		store,
		onStart,
		onComplete,
		onError,
		onRetry,
		onCancel,
		onResolutionComplete,
	} = options;

	// Validate resolver definitions
	if (process.env.NODE_ENV !== "production") {
		for (const [id, def] of Object.entries(definitions)) {
			if (!def.resolve && !def.resolveBatch) {
				throw new Error(
					`[Directive] Resolver "${id}" must define either resolve() or resolveBatch(). ` +
						`Add one of these methods to handle requirements.`,
				);
			}
			if (def.batch?.enabled && !def.resolveBatch) {
				throw new Error(
					`[Directive] Resolver "${id}" has batch.enabled=true but no resolveBatch() method. ` +
						`Add resolveBatch() to handle batched requirements.`,
				);
			}
		}
	}

	// Active resolver states by requirement ID
	const inflight = new Map<string, ResolverState>();

	// Completed/failed statuses (kept for inspection) - LRU cleanup
	const statuses = new Map<string, ResolverStatus>();
	const MAX_STATUSES = 1000; // Limit to prevent memory leak

	// Batch states by resolver ID
	const batches = new Map<string, BatchState>();

	// Resolver index by requirement type for O(1) lookup (populated lazily)
	// Capped to prevent unbounded growth with dynamic requirement types (e.g., FETCH_USER_${id})
	const resolversByType = new Map<string, string[]>();
	const MAX_RESOLVER_CACHE = 1000;

	/** Cleanup old statuses to prevent memory leak */
	function cleanupStatuses(): void {
		if (statuses.size > MAX_STATUSES) {
			// Remove oldest entries (first inserted = first in iteration)
			const entriesToRemove = statuses.size - MAX_STATUSES;
			const iterator = statuses.keys();
			for (let i = 0; i < entriesToRemove; i++) {
				const key = iterator.next().value;
				if (key) statuses.delete(key);
			}
		}
	}

	/** Type guard for resolver with string `requirement` property */
	function hasStringRequirement(
		def: unknown,
	): def is { requirement: string } {
		return (
			typeof def === "object" &&
			def !== null &&
			"requirement" in def &&
			typeof (def as { requirement: unknown }).requirement === "string"
		);
	}

	/** Type guard for resolver with function `requirement` property */
	function hasFunctionRequirement(
		def: unknown,
	): def is { requirement: (req: Requirement) => boolean } {
		return (
			typeof def === "object" &&
			def !== null &&
			"requirement" in def &&
			typeof (def as { requirement: unknown }).requirement === "function"
		);
	}

	/**
	 * Check if a resolver handles a requirement.
	 * Supports:
	 * - `requirement: "TYPE"` - string matching
	 * - `requirement: (req) => req is T` - function type guard
	 */
	function resolverHandles(def: ResolversDef<S>[string], req: Requirement): boolean {
		// Check string-based `requirement`
		if (hasStringRequirement(def)) {
			return req.type === def.requirement;
		}

		// Check function-based `requirement` (type guard)
		if (hasFunctionRequirement(def)) {
			return def.requirement(req);
		}

		return false;
	}

	/** Find a resolver that handles a requirement */
	function findResolver(req: Requirement): string | null {
		// Check cache first for this requirement type
		const reqType = req.type;
		const cached = resolversByType.get(reqType);
		if (cached) {
			// Try cached resolvers first
			for (const id of cached) {
				const def = definitions[id];
				if (def && resolverHandles(def, req)) {
					return id;
				}
			}
		}

		// Fallback to full search and cache the result
		for (const [id, def] of Object.entries(definitions)) {
			if (resolverHandles(def, req)) {
				// Cache this resolver for this type (with size cap)
				if (!resolversByType.has(reqType)) {
					// Evict oldest entry if cache is full
					if (resolversByType.size >= MAX_RESOLVER_CACHE) {
						const oldest = resolversByType.keys().next().value;
						if (oldest !== undefined) resolversByType.delete(oldest);
					}
					resolversByType.set(reqType, []);
				}
				const typeResolvers = resolversByType.get(reqType)!;
				if (!typeResolvers.includes(id)) {
					typeResolvers.push(id);
				}
				return id;
			}
		}
		return null;
	}

	/** Create resolver context */
	function createContext(signal: AbortSignal): ResolverContext<S> {
		return {
			facts,
			signal,
			snapshot: () => facts.$snapshot() as FactsSnapshot<S>,
		};
	}

	/** Execute a single requirement resolution with retry */
	async function executeResolve(
		resolverId: string,
		req: RequirementWithId,
		controller: AbortController,
	): Promise<void> {
		const def = definitions[resolverId];
		if (!def) return;
		const retryPolicy = { ...DEFAULT_RETRY, ...def.retry };
		let lastError: Error | null = null;

		for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
			// Check if canceled
			if (controller.signal.aborted) {
				return;
			}

			// Update state
			const state = inflight.get(req.id);
			if (state) {
				state.attempt = attempt;
				state.status = {
					state: "running",
					requirementId: req.id,
					startedAt: state.startedAt,
					attempt,
				};
			}

			try {
				const ctx = createContext(controller.signal);

				if (def.resolve) {
					// Batch the synchronous portion of resolve to coalesce fact mutations.
					// For sync-body async resolvers, all mutations are batched and flushed once.
					// For truly async resolvers, mutations before the first await are batched.
					let resolvePromise!: Promise<void>;
					store.batch(() => {
						resolvePromise = def.resolve!(req.requirement as Parameters<NonNullable<typeof def.resolve>>[0], ctx) as Promise<void>;
					});

					const timeout = def.timeout;
					if (timeout && timeout > 0) {
						await withTimeout(
							resolvePromise,
							timeout,
							`Resolver "${resolverId}" timed out after ${timeout}ms`,
						);
					} else {
						await resolvePromise;
					}
				}

				// Success
				const duration = Date.now() - (state?.startedAt ?? Date.now());
				statuses.set(req.id, {
					state: "success",
					requirementId: req.id,
					completedAt: Date.now(),
					duration,
				});
				cleanupStatuses(); // Prevent memory leak
				onComplete?.(resolverId, req, duration);
				return;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if it was an abort
				if (controller.signal.aborted) {
					return;
				}

				// Check shouldRetry predicate — if it returns false, stop immediately
				if (retryPolicy.shouldRetry && !retryPolicy.shouldRetry(lastError, attempt)) {
					break;
				}

				// If we have more attempts, wait and retry
				if (attempt < retryPolicy.attempts) {
					// Check abort before starting delay (avoids unnecessary waiting)
					if (controller.signal.aborted) {
						return;
					}

					const delay = calculateDelay(retryPolicy, attempt);
					onRetry?.(resolverId, req, attempt + 1);

					// Use AbortSignal-aware sleep to respond to cancellation immediately
					await new Promise<void>((resolve) => {
						const timeoutId = setTimeout(resolve, delay);
						// Listen for abort during sleep
						const abortHandler = () => {
							clearTimeout(timeoutId);
							resolve();
						};
						controller.signal.addEventListener("abort", abortHandler, { once: true });
					});

					// Check abort after sleep
					if (controller.signal.aborted) {
						return;
					}
				}
			}
		}

		// All attempts failed (or shouldRetry returned false)
		statuses.set(req.id, {
			state: "error",
			requirementId: req.id,
			error: lastError!,
			failedAt: Date.now(),
			attempts: retryPolicy.attempts,
		});
		cleanupStatuses();
		onError?.(resolverId, req, lastError);
	}

	/** Execute a batch of requirements with retry, timeout, and partial failure support */
	async function executeBatch(
		resolverId: string,
		requirements: RequirementWithId[],
	): Promise<void> {
		const def = definitions[resolverId];
		if (!def) return;

		// If no batch handler, fall back to individual resolution
		if (!def.resolveBatch && !def.resolveBatchWithResults) {
			await Promise.all(
				requirements.map((req) => {
					const controller = new AbortController();
					return executeResolve(resolverId, req, controller);
				}),
			);
			return;
		}

		const retryPolicy = { ...DEFAULT_RETRY, ...def.retry };
		const batchConfig = { ...DEFAULT_BATCH, ...def.batch };
		const controller = new AbortController();
		const startedAt = Date.now();
		let lastError: Error | null = null;

		// Use batch timeout if configured, otherwise fall back to resolver timeout
		const timeout = batchConfig.timeoutMs ?? def.timeout;

		for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
			// Check if canceled
			if (controller.signal.aborted) {
				return;
			}

			try {
				const ctx = createContext(controller.signal);
				const reqPayloads = requirements.map((r) => r.requirement);

				// Check for resolveBatchWithResults (per-item results)
				if (def.resolveBatchWithResults) {
					let results: BatchResolveResults;

					// Batch fact mutations for the synchronous portion of the resolver
					let resolvePromise!: Promise<BatchResolveResults>;
					store.batch(() => {
						// biome-ignore lint/suspicious/noExplicitAny: Requirement type varies
						resolvePromise = def.resolveBatchWithResults!(reqPayloads as any, ctx);
					});

					if (timeout && timeout > 0) {
						results = await withTimeout(
							resolvePromise,
							timeout,
							`Batch resolver "${resolverId}" timed out after ${timeout}ms`,
						);
					} else {
						results = await resolvePromise;
					}

					// Validate results length
					if (results.length !== requirements.length) {
						throw new Error(
							`[Directive] Batch resolver "${resolverId}" returned ${results.length} results ` +
								`but expected ${requirements.length}. Results array must match input order.`,
						);
					}

					// Process per-item results
					const duration = Date.now() - startedAt;
					let hasFailures = false;

					for (let i = 0; i < requirements.length; i++) {
						const req = requirements[i]!;
						const result = results[i]!;

						if (result.success) {
							statuses.set(req.id, {
								state: "success",
								requirementId: req.id,
								completedAt: Date.now(),
								duration,
							});
							onComplete?.(resolverId, req, duration);
						} else {
							hasFailures = true;
							const error = result.error ?? new Error("Batch item failed");
							statuses.set(req.id, {
								state: "error",
								requirementId: req.id,
								error,
								failedAt: Date.now(),
								attempts: attempt,
							});
							onError?.(resolverId, req, error);
						}
					}

					// No failures: all succeeded, done
					if (!hasFailures) return;

					// Partial success (some succeeded, some failed): don't retry the batch
					if (requirements.some((_, i) => results[i]?.success)) return;

					// ALL failed: fall through to retry logic below
				} else {
					// Use all-or-nothing resolveBatch
					// Batch fact mutations for the synchronous portion of the resolver
					let resolvePromise!: Promise<void>;
					store.batch(() => {
						// biome-ignore lint/suspicious/noExplicitAny: Requirement type varies
						resolvePromise = def.resolveBatch!(reqPayloads as any, ctx) as Promise<void>;
					});

					if (timeout && timeout > 0) {
						await withTimeout(
							resolvePromise,
							timeout,
							`Batch resolver "${resolverId}" timed out after ${timeout}ms`,
						);
					} else {
						await resolvePromise;
					}

					// Mark all as success
					const duration = Date.now() - startedAt;
					for (const req of requirements) {
						statuses.set(req.id, {
							state: "success",
							requirementId: req.id,
							completedAt: Date.now(),
							duration,
						});
						onComplete?.(resolverId, req, duration);
					}
					return;
				}
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));

				// Check if it was an abort
				if (controller.signal.aborted) {
					return;
				}

				// Check shouldRetry predicate — if it returns false, stop immediately
				if (retryPolicy.shouldRetry && !retryPolicy.shouldRetry(lastError, attempt)) {
					break;
				}

				// If we have more attempts, wait and retry
				if (attempt < retryPolicy.attempts) {
					const delay = calculateDelay(retryPolicy, attempt);
					// Notify retry for all requirements
					for (const req of requirements) {
						onRetry?.(resolverId, req, attempt + 1);
					}

					// Use AbortSignal-aware sleep
					await new Promise<void>((resolve) => {
						const timeoutId = setTimeout(resolve, delay);
						const abortHandler = () => {
							clearTimeout(timeoutId);
							resolve();
						};
						controller.signal.addEventListener("abort", abortHandler, { once: true });
					});

					// Check abort after sleep
					if (controller.signal.aborted) {
						return;
					}
				}
			}
		}

		// All attempts failed (or shouldRetry returned false) - mark all as error
		for (const req of requirements) {
			statuses.set(req.id, {
				state: "error",
				requirementId: req.id,
				error: lastError!,
				failedAt: Date.now(),
				attempts: retryPolicy.attempts,
			});
			onError?.(resolverId, req, lastError);
		}
		cleanupStatuses();
	}

	/** Add a requirement to a batch */
	function addToBatch(resolverId: string, req: RequirementWithId): void {
		const def = definitions[resolverId];
		if (!def) return;
		const batchConfig = { ...DEFAULT_BATCH, ...def.batch };

		if (!batches.has(resolverId)) {
			batches.set(resolverId, {
				resolverId,
				requirements: [],
				timer: null,
			});
		}

		const batch = batches.get(resolverId)!;
		batch.requirements.push(req);

		// Start or reset timer
		if (batch.timer) {
			clearTimeout(batch.timer);
		}

		batch.timer = setTimeout(() => {
			processBatch(resolverId);
		}, batchConfig.windowMs);
	}

	/** Process a single batch */
	function processBatch(resolverId: string): void {
		const batch = batches.get(resolverId);
		if (!batch || batch.requirements.length === 0) return;

		const requirements = [...batch.requirements];
		batch.requirements = [];
		batch.timer = null;

		// Execute batch
		executeBatch(resolverId, requirements).then(() => {
			onResolutionComplete?.();
		});
	}

	const manager: ResolversManager<S> = {
		resolve(req: RequirementWithId): void {
			// Already resolving?
			if (inflight.has(req.id)) {
				return;
			}

			// Find resolver
			const resolverId = findResolver(req.requirement);
			if (!resolverId) {
				console.warn(`[Directive] No resolver found for requirement: ${req.id}`);
				return;
			}

			const def = definitions[resolverId];
			if (!def) return;

			// Check if this is a batched resolver
			if (def.batch?.enabled) {
				addToBatch(resolverId, req);
				return;
			}

			// Start resolution
			const controller = new AbortController();
			const startedAt = Date.now();

			const state: ResolverState = {
				requirementId: req.id,
				resolverId,
				controller,
				startedAt,
				attempt: 1,
				status: {
					state: "pending",
					requirementId: req.id,
					startedAt,
				},
				originalRequirement: req,
			};

			inflight.set(req.id, state);
			onStart?.(resolverId, req);

			// Execute asynchronously
			executeResolve(resolverId, req, controller)
				.finally(() => {
					// Only fire onResolutionComplete if we're the first to clean up.
					// If cancel() already removed us from inflight, skip to avoid
					// spurious double-notifications.
					const wasInflight = inflight.delete(req.id);
					if (wasInflight) {
						onResolutionComplete?.();
					}
				});
		},

		cancel(requirementId: string): void {
			const state = inflight.get(requirementId);
			if (!state) return;

			state.controller.abort();
			inflight.delete(requirementId);

			statuses.set(requirementId, {
				state: "canceled",
				requirementId,
				canceledAt: Date.now(),
			});
			cleanupStatuses();

			onCancel?.(state.resolverId, state.originalRequirement);
		},

		cancelAll(): void {
			for (const [id] of inflight) {
				this.cancel(id);
			}

			// Clear batches
			for (const batch of batches.values()) {
				if (batch.timer) {
					clearTimeout(batch.timer);
				}
			}
			batches.clear();
		},

		getStatus(requirementId: string): ResolverStatus {
			// Check inflight first
			const state = inflight.get(requirementId);
			if (state) {
				return state.status;
			}

			// Check completed statuses
			const status = statuses.get(requirementId);
			if (status) {
				return status;
			}

			return { state: "idle" };
		},

		getInflight(): string[] {
			return [...inflight.keys()];
		},

		getInflightInfo(): InflightInfo[] {
			return [...inflight.values()].map((state) => ({
				id: state.requirementId,
				resolverId: state.resolverId,
				startedAt: state.startedAt,
			}));
		},

		isResolving(requirementId: string): boolean {
			return inflight.has(requirementId);
		},

		processBatches(): void {
			for (const resolverId of batches.keys()) {
				processBatch(resolverId);
			}
		},
	};

	return manager;
}

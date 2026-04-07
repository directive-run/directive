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

import isDevelopment from "#is-development";
import { withTimeout } from "../utils/utils.js";
import type {
  BatchConfig,
  BatchResolveResults,
  Facts,
  FactsSnapshot,
  FactsStore,
  Requirement,
  RequirementWithId,
  ResolverContext,
  ResolverStatus,
  ResolversDef,
  RetryPolicy,
  Schema,
} from "./types.js";

// ============================================================================
// Resolvers Manager
// ============================================================================

/**
 * Summary of a resolver that is currently in flight.
 *
 * @internal
 */
export interface InflightInfo {
  /** The unique requirement ID being resolved. */
  id: string;
  /** The definition ID of the resolver handling this requirement. */
  resolverId: string;
  /** Epoch timestamp (ms) when resolution started. */
  startedAt: number;
}

/**
 * Manager returned by {@link createResolversManager} that matches
 * requirements to resolver handlers and manages their execution lifecycle.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ResolversManager<_S extends Schema> {
  /**
   * Start resolving a requirement by matching it to a resolver handler.
   *
   * @remarks
   * Duplicate in-flight requirements (same `req.id`) are silently ignored.
   * If the matched resolver has `batch.enabled`, the requirement is queued
   * for batch processing instead of being resolved immediately.
   *
   * @param req - The requirement (with a stable identity ID) to resolve.
   */
  resolve(req: RequirementWithId): void;
  /**
   * Cancel an in-flight or batch-queued resolver by requirement ID.
   *
   * @remarks
   * Aborts the `AbortController` for in-flight resolvers. For batch-queued
   * requirements, removes the requirement from the pending batch.
   *
   * @param requirementId - The unique requirement ID to cancel.
   */
  cancel(requirementId: string): void;
  /**
   * Cancel every in-flight resolver and flush all pending batch queues.
   */
  cancelAll(): void;
  /**
   * Get the current status of a resolver by requirement ID.
   *
   * @param requirementId - The unique requirement ID to look up.
   * @returns The {@link ResolverStatus} (idle, pending, running, success, error, or canceled).
   */
  getStatus(requirementId: string): ResolverStatus;
  /**
   * Get the requirement IDs of all currently in-flight resolvers.
   *
   * @returns An array of requirement ID strings.
   */
  getInflight(): string[];
  /**
   * Get detailed info for every in-flight resolver.
   *
   * @returns An array of {@link InflightInfo} objects.
   */
  getInflightInfo(): InflightInfo[];
  /**
   * Get the number of currently in-flight resolvers without allocating an array.
   *
   * @returns The count of in-flight resolvers.
   */
  getInflightCount(): number;
  /**
   * Check whether a requirement is currently being resolved.
   *
   * @param requirementId - The unique requirement ID to check.
   * @returns `true` if the requirement has an active in-flight resolver.
   */
  isResolving(requirementId: string): boolean;
  /**
   * Immediately flush all pending batch queues, executing their resolvers.
   */
  processBatches(): void;
  /**
   * Check whether any batch queues have requirements waiting to be processed.
   *
   * @returns `true` if at least one batch queue is non-empty.
   */
  hasPendingBatches(): boolean;
  /**
   * Register additional resolver definitions at runtime (used for dynamic
   * module registration).
   *
   * @remarks
   * Clears the resolver-by-type cache so newly registered resolvers are
   * discoverable on the next {@link ResolversManager.resolve | resolve} call.
   *
   * @param newDefs - New resolver definitions to merge into the manager.
   */
  registerDefinitions(newDefs: ResolversDef<Schema>): void;
  /**
   * Override an existing resolver definition.
   *
   * @param id - The resolver definition ID to override.
   * @param def - The new resolver definition.
   * @throws If no resolver with this ID exists.
   */
  assignDefinition(id: string, def: ResolversDef<Schema>[string]): void;
  /**
   * Remove a resolver definition. Cancels any inflight resolution.
   *
   * @param id - The resolver definition ID to remove.
   */
  unregisterDefinition(id: string): void;
  /**
   * Execute a resolver with a given requirement object.
   *
   * @param id - The resolver definition ID.
   * @param requirement - The requirement to resolve.
   */
  callOne(id: string, requirement: Requirement): Promise<void>;
  /**
   * Clean up all internal state. Called on system destroy.
   */
  destroy(): void;
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

/**
 * Configuration options accepted by {@link createResolversManager}.
 *
 * @internal
 */
export interface CreateResolversOptions<S extends Schema> {
  /** Resolver definitions keyed by ID. */
  definitions: ResolversDef<S>;
  /** Proxy-based facts object passed to resolver contexts. */
  facts: Facts<S>;
  /** Underlying fact store used for `batch()` coalescing of mutations. */
  store: FactsStore<S>;
  /** Called when a resolver begins execution. */
  onStart?: (resolver: string, req: RequirementWithId) => void;
  /** Called when a resolver completes successfully, with the wall-clock duration in ms. */
  onComplete?: (
    resolver: string,
    req: RequirementWithId,
    duration: number,
  ) => void;
  /** Called when a resolver exhausts all retry attempts. */
  onError?: (resolver: string, req: RequirementWithId, error: unknown) => void;
  /** Called before each retry attempt with the upcoming attempt number. */
  onRetry?: (resolver: string, req: RequirementWithId, attempt: number) => void;
  /** Called when a resolver is canceled via {@link ResolversManager.cancel | cancel}. */
  onCancel?: (resolver: string, req: RequirementWithId) => void;
  /** Called after any resolver finishes (success, error, or batch completion) to trigger reconciliation. */
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
 * Calculate delay for a retry attempt based on backoff policy.
 *
 * @param policy - Retry policy with backoff strategy and delay bounds
 * @param attempt - Current attempt number (1-based)
 * @returns Delay in milliseconds, clamped to maxDelay
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
      delay = initialDelay * 2 ** (attempt - 1);
      break;
    default:
      delay = initialDelay;
  }

  // Ensure delay is at least 1ms to prevent busy loops
  return Math.max(1, Math.min(delay, maxDelay));
}

/**
 * Create a manager that fulfills requirements by matching them to resolver
 * handlers.
 *
 * @remarks
 * Resolvers are matched by requirement type (string equality) or a predicate
 * function. Each resolution runs with an `AbortController` for cancellation
 * and configurable retry policies (none, linear, or exponential backoff).
 *
 * **Batching:** When a resolver sets `batch.enabled`, incoming requirements
 * are queued and flushed either when `batch.maxSize` is reached or after
 * `batch.windowMs` elapses, whichever comes first. Batch resolvers can use
 * `resolveBatch` (all-or-nothing) or `resolveBatchWithResults` (per-item
 * success/failure). If only `resolve` is provided with batching enabled, the
 * manager falls back to individual resolution calls.
 *
 * Duplicate in-flight requirements (same requirement ID) are automatically
 * deduplicated. Resolver-by-type lookups are cached with FIFO eviction at
 * 1 000 entries to handle dynamic requirement types.
 *
 * @param options - Configuration including resolver definitions, facts proxy,
 *   store, and lifecycle callbacks.
 * @returns A {@link ResolversManager} for dispatching, canceling, and
 *   inspecting requirement resolution.
 *
 * @example
 * ```typescript
 * const resolvers = createResolversManager({
 *   definitions: {
 *     transition: {
 *       requirement: "TRANSITION",
 *       retry: { attempts: 3, backoff: "exponential" },
 *       resolve: async (req, context) => {
 *         context.facts.phase = req.to;
 *         context.facts.elapsed = 0;
 *       },
 *     },
 *   },
 *   facts: factsProxy,
 *   store: factsStore,
 *   onComplete: (id, req, ms) => console.log(`${id} resolved in ${ms}ms`),
 * });
 *
 * resolvers.resolve(requirementWithId);
 * ```
 *
 * @internal
 */
/**
 * Validate resolver definitions in dev mode.
 * Ensures each resolver has resolve() or resolveBatch(), and warns
 * when batch.enabled is set without a batch handler.
 */
function validateDefinitions<S extends Schema>(
  definitions: ResolversDef<S>,
): void {
  if (!isDevelopment) {
    return;
  }

  for (const [id, def] of Object.entries(definitions)) {
    if (!def.resolve && !def.resolveBatch && !def.resolveBatchWithResults) {
      throw new Error(
        `[Directive] Resolver "${id}" must define either resolve() or resolveBatch(). Add one of these methods to handle requirements.`,
      );
    }

    if (
      !def.batch?.enabled ||
      def.resolveBatch ||
      def.resolveBatchWithResults
    ) {
      continue;
    }

    if (def.resolve) {
      console.warn(
        `[Directive] Resolver "${id}" has batch.enabled but no resolveBatch(). Falling back to individual resolve() calls. Add resolveBatch() for true bulk operations.`,
      );
    } else {
      throw new Error(
        `[Directive] Resolver "${id}" has batch.enabled=true but no resolve(), resolveBatch(), or resolveBatchWithResults() method.`,
      );
    }
  }
}

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

  validateDefinitions(definitions);

  // Active resolver states by requirement ID
  const inflight = new Map<string, ResolverState>();

  // Completed/failed statuses (kept for inspection) - LRU cleanup
  const statuses = new Map<string, ResolverStatus>();
  const MAX_STATUSES = 1000; // Limit to prevent memory leak

  // Batch states by resolver ID
  const batches = new Map<string, BatchState>();

  // Resolver index by requirement type for O(1) lookup (populated lazily)
  // Capped to prevent unbounded growth with dynamic requirement types (e.g., FETCH_USER_${id})
  const resolversByType = new Map<string, Set<string>>();
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
  function hasStringRequirement(def: unknown): def is { requirement: string } {
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
  function resolverHandles(
    def: ResolversDef<S>[string],
    req: Requirement,
  ): boolean {
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

  /** Try to find a resolver from the LRU cache */
  function findResolverInCache(
    reqType: string,
    req: Requirement,
  ): string | null {
    const cached = resolversByType.get(reqType);
    if (!cached) {
      return null;
    }

    // Move to end of Map iteration order (LRU: least recently used is first)
    resolversByType.delete(reqType);
    resolversByType.set(reqType, cached);

    for (const id of cached) {
      const def = definitions[id];
      if (def && resolverHandles(def, req)) {
        return id;
      }
    }

    return null;
  }

  /** Add a resolver ID to the type cache, evicting if full */
  function cacheResolverForType(reqType: string, resolverId: string): void {
    if (!resolversByType.has(reqType)) {
      if (resolversByType.size >= MAX_RESOLVER_CACHE) {
        const oldest = resolversByType.keys().next().value;
        if (oldest !== undefined) {
          resolversByType.delete(oldest);
        }
      }
      resolversByType.set(reqType, new Set());
    }
    resolversByType.get(reqType)!.add(resolverId);
  }

  /** Find a resolver that handles a requirement */
  function findResolver(req: Requirement): string | null {
    const reqType = req.type;

    // Check cache first
    const cached = findResolverInCache(reqType, req);
    if (cached) {
      return cached;
    }

    // Fallback to full search and cache the result
    for (const [id, def] of Object.entries(definitions)) {
      if (resolverHandles(def, req)) {
        cacheResolverForType(reqType, id);

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

  /**
   * Shared retry catch-block logic: normalize error, check abort, check shouldRetry,
   * sleep with abort awareness. Returns "abort" if canceled, "break" if shouldRetry
   * returned false, or "continue" if the next attempt should proceed.
   */
  async function handleRetryError(
    error: unknown,
    attempt: number,
    retryPolicy: RetryPolicy & { attempts: number; backoff: string },
    controller: AbortController,
  ): Promise<{ action: "abort" | "break" | "continue"; error: Error }> {
    const normalizedError =
      error instanceof Error ? error : new Error(String(error));

    if (controller.signal.aborted) {
      return { action: "abort", error: normalizedError };
    }

    if (
      retryPolicy.shouldRetry &&
      !retryPolicy.shouldRetry(normalizedError, attempt)
    ) {
      return { action: "break", error: normalizedError };
    }

    if (attempt < retryPolicy.attempts) {
      if (controller.signal.aborted) {
        return { action: "abort", error: normalizedError };
      }

      const delay = calculateDelay(retryPolicy, attempt);

      await new Promise<void>((resolve) => {
        const timeoutId = setTimeout(resolve, delay);
        const abortHandler = () => {
          clearTimeout(timeoutId);
          resolve();
        };
        controller.signal.addEventListener("abort", abortHandler, {
          once: true,
        });
      });

      if (controller.signal.aborted) {
        return { action: "abort", error: normalizedError };
      }
    }

    return { action: "continue", error: normalizedError };
  }

  /**
   * Invoke a resolver's resolve() function with optional timeout.
   *
   * The `store.batch()` here intentionally wraps only the synchronous start of
   * the async resolver — it coalesces all fact mutations that happen before the
   * first `await` into a single notification (one `onBatch` callback, one
   * `scheduleReconcile()`). After the first `await`, the batch has ended and
   * each subsequent fact mutation triggers its own `onChange` → reconcile cycle.
   *
   * This is correct: pre-await mutations typically set up transient state (e.g.
   * "pending" / "fetching" flags) and should be seen as one atomic change, while
   * post-await mutations represent real state transitions (e.g. "success" with
   * fetched data) that the constraint engine must evaluate independently.
   */
  async function invokeResolve(
    def: ResolversDef<S>[string],
    resolverId: string,
    req: RequirementWithId,
    signal: AbortSignal,
  ): Promise<void> {
    if (!def.resolve) {
      return;
    }

    // Batch wraps only the synchronous start — see JSDoc above.
    let resolvePromise!: Promise<void>;
    store.batch(() => {
      resolvePromise = def.resolve!(
        req.requirement as Parameters<NonNullable<typeof def.resolve>>[0],
        createContext(signal),
      ) as Promise<void>;
    });

    const timeout = def.timeout;
    if (timeout && timeout > 0) {
      await withTimeout(
        resolvePromise,
        timeout,
        `Resolver "${resolverId}" timed out after ${timeout}ms`,
      );

      return;
    }

    await resolvePromise;
  }

  /** Record a successful resolution */
  function recordSuccess(
    resolverId: string,
    req: RequirementWithId,
    startedAt: number,
  ): void {
    const duration = Date.now() - startedAt;
    statuses.set(req.id, {
      state: "success",
      requirementId: req.id,
      completedAt: Date.now(),
      duration,
    });
    cleanupStatuses();
    onComplete?.(resolverId, req, duration);
  }

  /** Record a failed resolution */
  function recordError(
    resolverId: string,
    req: RequirementWithId,
    error: Error,
    attempts: number,
  ): void {
    statuses.set(req.id, {
      state: "error",
      requirementId: req.id,
      error,
      failedAt: Date.now(),
      attempts,
    });
    cleanupStatuses();
    onError?.(resolverId, req, error);
  }

  /** Update inflight state for a new attempt */
  function updateInflightAttempt(
    reqId: string,
    attempt: number,
    startedAt: number,
  ): void {
    const state = inflight.get(reqId);
    if (state) {
      state.attempt = attempt;
      state.status = {
        state: "running",
        requirementId: reqId,
        startedAt,
        attempt,
      };
    }
  }

  /**
   * Handle the catch block of a retry attempt. Returns true if the loop
   * should continue to the next attempt, false if it should stop.
   */
  async function processRetryError(
    error: unknown,
    attempt: number,
    retryPolicy: RetryPolicy & { attempts: number; backoff: string },
    controller: AbortController,
    notifyRetry: (nextAttempt: number) => void,
  ): Promise<{ lastError: Error; shouldContinue: boolean }> {
    const result = await handleRetryError(
      error,
      attempt,
      retryPolicy,
      controller,
    );

    if (result.action === "continue" && attempt < retryPolicy.attempts) {
      notifyRetry(attempt + 1);
    }

    return {
      lastError: result.error,
      shouldContinue: result.action === "continue",
    };
  }

  /** Execute a single requirement resolution with retry */
  async function executeResolve(
    resolverId: string,
    req: RequirementWithId,
    controller: AbortController,
  ): Promise<void> {
    const def = definitions[resolverId];
    if (!def) {
      return;
    }

    const retryPolicy = { ...DEFAULT_RETRY, ...def.retry };
    let lastError: Error | null = null;
    const startedAt = inflight.get(req.id)?.startedAt ?? Date.now();

    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
      if (controller.signal.aborted) {
        return;
      }

      updateInflightAttempt(req.id, attempt, startedAt);

      try {
        await invokeResolve(def, resolverId, req, controller.signal);
        recordSuccess(resolverId, req, startedAt);

        return;
      } catch (error) {
        const outcome = await processRetryError(
          error,
          attempt,
          retryPolicy,
          controller,
          (next) => onRetry?.(resolverId, req, next),
        );
        lastError = outcome.lastError;

        if (!outcome.shouldContinue) {
          break;
        }
      }
    }

    recordError(resolverId, req, lastError!, retryPolicy.attempts);
  }

  /** Await a promise with optional timeout */
  async function awaitWithTimeout<T>(
    promise: Promise<T>,
    timeout: number | undefined,
    timeoutMessage: string,
  ): Promise<T> {
    if (timeout && timeout > 0) {
      return withTimeout(promise, timeout, timeoutMessage);
    }

    return promise;
  }

  /**
   * Execute resolveBatchWithResults and process per-item results.
   * Returns "done" if no retry needed, or "retry" if all items failed.
   */
  async function executeWithResults(
    def: ResolversDef<S>[string],
    resolverId: string,
    requirements: RequirementWithId[],
    reqPayloads: Requirement[],
    ctx: ResolverContext<S>,
    timeout: number | undefined,
    startedAt: number,
    attempt: number,
  ): Promise<"done" | "retry"> {
    let resolvePromise!: Promise<BatchResolveResults>;
    store.batch(() => {
      // biome-ignore lint/suspicious/noExplicitAny: Requirement type varies
      resolvePromise = def.resolveBatchWithResults!(reqPayloads as any, ctx);
    });

    const results = await awaitWithTimeout(
      resolvePromise,
      timeout,
      `Batch resolver "${resolverId}" timed out after ${timeout}ms`,
    );

    if (results.length !== requirements.length) {
      throw new Error(
        `[Directive] Batch resolver "${resolverId}" returned ${results.length} results ` +
          `but expected ${requirements.length}. Results array must match input order.`,
      );
    }

    let hasFailures = false;

    for (let i = 0; i < requirements.length; i++) {
      const req = requirements[i]!;
      const result = results[i]!;

      if (result.success) {
        recordSuccess(resolverId, req, startedAt);
        continue;
      }

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

    // No failures or partial success: done (don't retry partial)
    if (!hasFailures || requirements.some((_, i) => results[i]?.success)) {
      return "done";
    }

    // ALL failed: caller should retry
    return "retry";
  }

  /** Execute all-or-nothing resolveBatch and mark all as success */
  async function executeAllOrNothing(
    def: ResolversDef<S>[string],
    resolverId: string,
    requirements: RequirementWithId[],
    reqPayloads: Requirement[],
    ctx: ResolverContext<S>,
    timeout: number | undefined,
    startedAt: number,
  ): Promise<void> {
    let resolvePromise!: Promise<void>;
    store.batch(() => {
      resolvePromise = def.resolveBatch!(
        // biome-ignore lint/suspicious/noExplicitAny: Requirement type varies
        reqPayloads as any,
        ctx,
      ) as Promise<void>;
    });

    await awaitWithTimeout(
      resolvePromise,
      timeout,
      `Batch resolver "${resolverId}" timed out after ${timeout}ms`,
    );

    for (const req of requirements) {
      recordSuccess(resolverId, req, startedAt);
    }
  }

  /** Record errors for all requirements in a batch */
  function recordBatchErrors(
    resolverId: string,
    requirements: RequirementWithId[],
    error: Error,
    attempts: number,
  ): void {
    for (const req of requirements) {
      recordError(resolverId, req, error, attempts);
    }
  }

  /** Fall back to individual resolution when no batch handler is defined */
  async function executeBatchFallback(
    resolverId: string,
    requirements: RequirementWithId[],
  ): Promise<void> {
    await Promise.all(
      requirements.map((req) => {
        const controller = new AbortController();

        return executeResolve(resolverId, req, controller);
      }),
    );
  }

  /** Execute one attempt of a batch (with-results or all-or-nothing) */
  async function executeBatchAttempt(
    def: ResolversDef<S>[string],
    resolverId: string,
    requirements: RequirementWithId[],
    signal: AbortSignal,
    timeout: number | undefined,
    startedAt: number,
    attempt: number,
  ): Promise<"done" | "retry"> {
    const ctx = createContext(signal);
    const reqPayloads = requirements.map((r) => r.requirement);

    if (def.resolveBatchWithResults) {
      return executeWithResults(
        def,
        resolverId,
        requirements,
        reqPayloads,
        ctx,
        timeout,
        startedAt,
        attempt,
      );
    }

    await executeAllOrNothing(
      def,
      resolverId,
      requirements,
      reqPayloads,
      ctx,
      timeout,
      startedAt,
    );

    return "done";
  }

  /** Notify retry for all requirements in a batch */
  function notifyBatchRetry(
    resolverId: string,
    requirements: RequirementWithId[],
    nextAttempt: number,
  ): void {
    for (const req of requirements) {
      onRetry?.(resolverId, req, nextAttempt);
    }
  }

  /** Run the retry loop for a batch, returning the last error if all attempts fail */
  async function runBatchRetryLoop(
    def: ResolversDef<S>[string],
    resolverId: string,
    requirements: RequirementWithId[],
    retryPolicy: RetryPolicy & { attempts: number; backoff: string },
    timeout: number | undefined,
  ): Promise<Error | null> {
    const controller = new AbortController();
    const startedAt = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= retryPolicy.attempts; attempt++) {
      if (controller.signal.aborted) {
        return null;
      }

      try {
        const outcome = await executeBatchAttempt(
          def,
          resolverId,
          requirements,
          controller.signal,
          timeout,
          startedAt,
          attempt,
        );
        if (outcome === "done") {
          return null;
        }
      } catch (error) {
        const outcome = await processRetryError(
          error,
          attempt,
          retryPolicy,
          controller,
          (next) => notifyBatchRetry(resolverId, requirements, next),
        );
        lastError = outcome.lastError;

        if (!outcome.shouldContinue) {
          break;
        }
      }
    }

    return lastError;
  }

  /** Execute a batch of requirements with retry, timeout, and partial failure support */
  async function executeBatch(
    resolverId: string,
    requirements: RequirementWithId[],
  ): Promise<void> {
    const def = definitions[resolverId];
    if (!def) {
      return;
    }

    if (!def.resolveBatch && !def.resolveBatchWithResults) {
      await executeBatchFallback(resolverId, requirements);

      return;
    }

    const retryPolicy = { ...DEFAULT_RETRY, ...def.retry };
    const batchConfig = { ...DEFAULT_BATCH, ...def.batch };
    const timeout = batchConfig.timeoutMs ?? def.timeout;

    const lastError = await runBatchRetryLoop(
      def,
      resolverId,
      requirements,
      retryPolicy,
      timeout,
    );

    if (lastError) {
      recordBatchErrors(
        resolverId,
        requirements,
        lastError,
        retryPolicy.attempts,
      );
    }
  }

  /** Hard cap for batch queues without explicit maxSize — prevents OOM */
  const DEFAULT_MAX_QUEUE_SIZE = 10_000;

  /** Cancel a batch timer if active */
  function clearBatchTimer(batch: BatchState): void {
    if (batch.timer) {
      clearTimeout(batch.timer);
      batch.timer = null;
    }
  }

  /** Ensure a batch entry exists for a resolver */
  function ensureBatch(resolverId: string): BatchState {
    if (!batches.has(resolverId)) {
      batches.set(resolverId, {
        resolverId,
        requirements: [],
        timer: null,
      });
    }

    return batches.get(resolverId)!;
  }

  /** Add a requirement to a batch */
  function addToBatch(resolverId: string, req: RequirementWithId): void {
    const def = definitions[resolverId];
    if (!def) {
      return;
    }

    const batchConfig = { ...DEFAULT_BATCH, ...def.batch };
    const batch = ensureBatch(resolverId);

    // Enforce hard cap to prevent OOM from unbounded accumulation
    const effectiveMax = batchConfig.maxSize || DEFAULT_MAX_QUEUE_SIZE;
    if (batch.requirements.length >= effectiveMax) {
      clearBatchTimer(batch);
      processBatch(resolverId);
    }

    batch.requirements.push(req);

    // Flush immediately if maxSize reached
    if (
      batchConfig.maxSize &&
      batch.requirements.length >= batchConfig.maxSize
    ) {
      clearBatchTimer(batch);
      processBatch(resolverId);

      return;
    }

    // Start or reset timer
    clearBatchTimer(batch);
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
        if (isDevelopment) {
          console.warn(
            `[Directive] No resolver found for requirement type "${req.requirement.type}" (id: ${req.id})`,
          );
        }
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
      executeResolve(resolverId, req, controller).finally(() => {
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
      // Check inflight resolvers first
      const state = inflight.get(requirementId);
      if (state) {
        state.controller.abort();
        inflight.delete(requirementId);

        statuses.set(requirementId, {
          state: "canceled",
          requirementId,
          canceledAt: Date.now(),
        });
        cleanupStatuses();

        onCancel?.(state.resolverId, state.originalRequirement);

        return;
      }

      // Check pending batch queues
      for (const batch of batches.values()) {
        const idx = batch.requirements.findIndex((r) => r.id === requirementId);
        if (idx !== -1) {
          const [removed] = batch.requirements.splice(idx, 1);

          statuses.set(requirementId, {
            state: "canceled",
            requirementId,
            canceledAt: Date.now(),
          });
          cleanupStatuses();

          if (removed) {
            onCancel?.(batch.resolverId, removed);
          }

          return;
        }
      }
    },

    cancelAll(): void {
      const ids = [...inflight.keys()];
      for (const id of ids) {
        this.cancel(id);
      }

      // Cancel queued batch requirements
      for (const batch of batches.values()) {
        if (batch.timer) {
          clearTimeout(batch.timer);
        }
        for (const req of batch.requirements) {
          statuses.set(req.id, {
            state: "canceled",
            requirementId: req.id,
            canceledAt: Date.now(),
          });
          onCancel?.(batch.resolverId, req);
        }
      }
      batches.clear();
      cleanupStatuses();
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

    getInflightCount(): number {
      return inflight.size;
    },

    isResolving(requirementId: string): boolean {
      return inflight.has(requirementId);
    },

    processBatches(): void {
      for (const resolverId of batches.keys()) {
        processBatch(resolverId);
      }
    },

    hasPendingBatches(): boolean {
      for (const batch of batches.values()) {
        if (batch.requirements.length > 0) {
          return true;
        }
      }

      return false;
    },

    registerDefinitions(newDefs: ResolversDef<Schema>): void {
      for (const [key, def] of Object.entries(newDefs)) {
        (definitions as Record<string, unknown>)[key] = def;
      }
      // Clear the resolver-by-type cache so new resolvers are discovered
      resolversByType.clear();
    },

    assignDefinition(id: string, def: ResolversDef<Schema>[string]): void {
      if (!definitions[id]) {
        throw new Error(
          `[Directive] Cannot assign resolver "${id}" — it does not exist. Use register() to create it.`,
        );
      }

      // Replace definition
      (definitions as Record<string, unknown>)[id] = def;
      // Clear cache so the new definition is discoverable
      resolversByType.clear();
    },

    unregisterDefinition(id: string): void {
      if (!definitions[id]) {
        return;
      }

      // Cancel any inflight resolutions using this resolver
      for (const [reqId, state] of inflight) {
        if (state.resolverId === id) {
          state.controller.abort();
          inflight.delete(reqId);
          statuses.set(reqId, {
            state: "canceled",
            requirementId: reqId,
            canceledAt: Date.now(),
          });
          onCancel?.(id, state.originalRequirement);
        }
      }

      // Remove from batch queues
      const batch = batches.get(id);
      if (batch) {
        if (batch.timer) {
          clearTimeout(batch.timer);
        }
        for (const req of batch.requirements) {
          statuses.set(req.id, {
            state: "canceled",
            requirementId: req.id,
            canceledAt: Date.now(),
          });
          onCancel?.(id, req);
        }
        batches.delete(id);
      }

      delete (definitions as Record<string, unknown>)[id];
      resolversByType.clear();
      cleanupStatuses();
    },

    async callOne(id: string, requirement: Requirement): Promise<void> {
      const def = definitions[id];
      if (!def) {
        throw new Error(
          `[Directive] Cannot call resolver "${id}" — it does not exist.`,
        );
      }

      const controller = new AbortController();
      const ctx = createContext(controller.signal);

      if (def.resolve) {
        // Batch wraps only the synchronous start — see invokeResolve JSDoc.
        let resolvePromise!: Promise<void>;
        store.batch(() => {
          resolvePromise = def.resolve!(
            requirement as Parameters<NonNullable<typeof def.resolve>>[0],
            ctx,
          ) as Promise<void>;
        });

        await resolvePromise;
      }
    },

    destroy(): void {
      this.cancelAll();
      statuses.clear();
      resolversByType.clear();
    },
  };

  return manager;
}

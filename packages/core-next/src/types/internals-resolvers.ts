/**
 * Copied from 1.35 (packages/core/src/core/resolvers.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type {
  Facts,
  FactsStore,
  Requirement,
  RequirementWithId,
  ResolverStatus,
  ResolversDef,
  Schema,
} from "./index.js";

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
   * @param options.factsBaseline - Optional pre-dispatch facts snapshot
   *   shared by every resolver dispatched in the same reconcile tick. Used
   *   by RFC-0003 constraint-binding to seed each resolver's `expected` map
   *   from a value that pre-dates any sibling resolver's writes, preventing
   *   the sibling-clobber gap where resolver 2 silently overwrites
   *   resolver 1's owned write.
   */
  resolve(
    req: RequirementWithId,
    options?: { factsBaseline?: Readonly<Record<string, unknown>> },
  ): void;
  /**
   * Abort an in-flight or batch-queued resolver by requirement ID.
   *
   * @remarks
   * Aborts the `AbortController` for in-flight resolvers. For batch-queued
   * requirements, removes the requirement from the pending batch. Named to
   * match `AbortController.abort()` and the declarative `abortOn:` key on
   * constraints — three surfaces, one verb, one signal.
   *
   * @param requirementId - The unique requirement ID to abort.
   */
  abort(requirementId: string): void;
  /**
   * Untrack an in-flight resolver by requirement ID **without** aborting it
   * (RFC-0003 resolver constraint-binding).
   *
   * @remarks
   * Used for bound resolvers whose triggering requirement was removed: the
   * resolver runs to completion (its data writes land; the binding still
   * guards abort-bound facts) but it no longer occupies the `inflight`
   * slot, so the same requirement re-dispatches cleanly if it returns. A
   * no-op if the requirement is not in-flight.
   *
   * @param requirementId - The unique requirement ID to detach.
   */
  detach(requirementId: string): void;
  /**
   * Abort every in-flight resolver and flush all pending batch queues.
   */
  abortAll(): void;
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
   * Start a pass: what each running resolver wrote so far becomes "this
   * pass's writes", and new writes are recorded for the next pass. Called by
   * the engine at the same point it takes the pass's changed keys.
   *
   * @internal
   */
  beginPass(): void;
  /**
   * Changes the run resolving `requirementId` made through its own
   * `ctx.facts` that belong to the current pass, counted per key. Only
   * writes that changed a value are counted. `null` when nothing runs for
   * it or it changed nothing.
   *
   * @internal
   */
  passWritesFor(requirementId: string): ReadonlyMap<string, number> | null;
  /**
   * Mark the run resolving `requirementId` as having satisfied its
   * requirement with its own write. It keeps running and completes as
   * usual, but is not retried if it then throws, and if the requirement is
   * dispatched again while it runs, it is aborted and its later writes are
   * discarded.
   *
   * @internal
   */
  markSatisfied(requirementId: string): void;
  /**
   * Whether any run is going that could write through its own `ctx.facts`.
   * The engine counts changes per pass only while this is true.
   *
   * @internal
   */
  hasLiveRuns(): boolean;
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
   * RFC 0002: wait for every execution belonging to one of `resolverIds` to
   * settle. Call after aborting them — this waits for work to stop, it does
   * not stop it. Rejections are absorbed: a resolver that fails on the way out
   * has already been reported through the normal error path, and a module
   * being unregistered should not resurface it as an unhandled rejection.
   */
  drainResolvers(
    resolverIds: readonly string[],
    timeoutMs?: number,
  ): Promise<void>;
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

/**
 * Per-constraint binding info, used by RFC-0003 (resolver constraint-binding).
 *
 * The engine wires this lookup into the resolvers manager so that a resolver
 * dispatched from a constraint with an `abortOn` field knows which facts it
 * compare-and-swaps on dispatch (see {@link createBoundFacts}).
 *
 * Returns `undefined`/`null` when the source constraint is unknown or has no
 * `abortOn` field — in which case binding is a no-op and the resolver
 * behaves exactly as before.
 *
 * @internal
 */
export interface ConstraintBindingInfo {
  /** Fact keys this resolver aborts on when changed mid-flight; writes to these are clobber-checked. */
  readonly fields: readonly string[];
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
  /**
   * Look up binding info for a source constraint id (RFC-0003).
   *
   * Wired by the engine — given the `fromConstraint` of a `RequirementWithId`,
   * returns the constraint's abort-binding fact keys. Return `undefined` if
   * the constraint is unknown or has no `abortOn` field.
   */
  getConstraintBinding?: (
    constraintId: string,
  ) => ConstraintBindingInfo | undefined;
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
  /** Called when a resolver is aborted via {@link ResolversManager.abort | abort}. */
  onCancel?: (resolver: string, req: RequirementWithId) => void;
  /**
   * Called when a bound resolver's owned-fact write is dropped because the
   * fact was changed by something outside the resolver (RFC-0003 clobber).
   * Fires once per dropped write; the resolver's `AbortController` is also
   * aborted in the same step. Wired to plugins for observability.
   */
  onClobber?: (
    resolver: string,
    req: RequirementWithId,
    fact: string,
    expected: unknown,
    actual: unknown,
  ) => void;
  /**
   * Called once when a single resolver instance exceeds the per-instance
   * clobber-event cap. `dropped` is the number of per-clobber events
   * suppressed. Rate-limits clobber-event amplification (RFC-0003).
   */
  onClobberSuppressed?: (
    resolver: string,
    req: RequirementWithId,
    dropped: number,
  ) => void;
  /** Called after any resolver finishes (success, error, or batch completion) to trigger reconciliation. */
  onResolutionComplete?: (satisfied?: boolean) => void;
  /**
   * Called when a resolver invokes `ctx.requeue()` for one of its owning
   * requirements. The engine uses this to drop the requirement from its
   * `previousRequirements` set so the next reconcile diff treats it as a
   * fresh addition and re-dispatches the resolver.
   */
  onRequeue?: (requirementId: string) => void;
}

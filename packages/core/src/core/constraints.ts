/**
 * Constraints - Rules that produce requirements when conditions aren't met
 *
 * Features:
 * - Sync and async constraint evaluation
 * - Priority ordering (higher runs first)
 * - Timeout handling for async constraints
 * - Error isolation
 */

import { withTimeout } from "../utils/utils.js";
import { RequirementSet, createRequirementWithId } from "./requirements.js";
import { withTracking } from "./tracking.js";
import type {
  ConstraintState,
  ConstraintsDef,
  Facts,
  Requirement,
  RequirementKeyFn,
  RequirementWithId,
  Schema,
} from "./types.js";

// Local type alias for requirement output (avoid type arg issues)
type RequirementOutput = Requirement | Requirement[] | null;

// ============================================================================
// Constraints Manager
// ============================================================================

/**
 * Manager returned by {@link createConstraintsManager} that evaluates
 * constraint rules against the current facts and produces unmet
 * {@link RequirementWithId | requirements}.
 *
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export interface ConstraintsManager<_S extends Schema> {
  /**
   * Evaluate all enabled constraints and return unmet requirements.
   *
   * @remarks
   * On the first call (or when `changedKeys` is empty), every enabled
   * constraint is evaluated. On subsequent calls, only constraints whose
   * tracked dependencies overlap with `changedKeys` are re-evaluated.
   * Sync constraints run first, async constraints run in parallel, and
   * `after` ordering is respected across multiple passes.
   *
   * @param changedKeys - Fact keys that changed since the last evaluation.
   *   When omitted or empty, all constraints are evaluated.
   * @returns An array of {@link RequirementWithId} representing unmet requirements.
   */
  evaluate(changedKeys?: Set<string>): Promise<RequirementWithId[]>;
  /**
   * Get the current state of a constraint by its definition ID.
   *
   * @param id - The constraint definition ID.
   * @returns The {@link ConstraintState}, or `undefined` if the ID is unknown.
   */
  getState(id: string): ConstraintState | undefined;
  /**
   * Get the state of every registered constraint.
   *
   * @returns An array of all {@link ConstraintState} objects.
   */
  getAllStates(): ConstraintState[];
  /**
   * Disable a constraint so it is skipped during evaluation.
   *
   * @param id - The constraint definition ID.
   */
  disable(id: string): void;
  /**
   * Re-enable a previously disabled constraint.
   *
   * @param id - The constraint definition ID.
   */
  enable(id: string): void;
  /**
   * Mark all constraints that depend on `factKey` as dirty so they are
   * re-evaluated on the next {@link ConstraintsManager.evaluate | evaluate} call.
   *
   * @param factKey - The fact store key that changed.
   */
  invalidate(factKey: string): void;
  /**
   * Get the auto-tracked or explicit dependency set for a constraint.
   *
   * @param id - The constraint definition ID.
   * @returns A `Set` of fact keys, or `undefined` if no dependencies have been recorded.
   */
  getDependencies(id: string): Set<string> | undefined;
  /**
   * Record that a constraint's resolver completed successfully, unblocking
   * any constraints that list it in their `after` array.
   *
   * @param constraintId - The constraint definition ID whose resolver finished.
   */
  markResolved(constraintId: string): void;
  /**
   * Check whether a constraint is currently disabled.
   *
   * @param id - The constraint definition ID.
   * @returns `true` if the constraint has been disabled via {@link ConstraintsManager.disable | disable}.
   */
  isDisabled(id: string): boolean;
  /**
   * Check whether a constraint has been marked as resolved.
   *
   * @param constraintId - The constraint definition ID.
   * @returns `true` if {@link ConstraintsManager.markResolved | markResolved} was called for this constraint.
   */
  isResolved(constraintId: string): boolean;
  /**
   * Register additional constraint definitions at runtime (used for dynamic
   * module registration).
   *
   * @remarks
   * Rebuilds the topological order and reverse dependency map so new `after`
   * dependencies are validated for cycles and indexed.
   *
   * @param newDefs - New constraint definitions to merge into the manager.
   */
  registerDefinitions(newDefs: ConstraintsDef<Schema>): void;
  /**
   * Override an existing constraint definition.
   * Stores the original in an internal map for inspection.
   *
   * @param id - The constraint definition ID to override.
   * @param def - The new constraint definition.
   * @throws If no constraint with this ID exists.
   */
  assignDefinition(id: string, def: ConstraintsDef<Schema>[string]): void;
  /**
   * Remove a constraint definition and all its internal state.
   *
   * @param id - The constraint definition ID to remove.
   */
  unregisterDefinition(id: string): void;
  /**
   * Evaluate a single constraint and emit its requirement if active.
   * Props are merged into the requirement object.
   *
   * @param id - The constraint definition ID.
   * @param props - Optional properties to merge into the requirement.
   * @returns The emitted requirements (if any).
   */
  callOne(
    id: string,
    props?: Record<string, unknown>,
  ): Promise<RequirementWithId[]>;
}

/**
 * Configuration options accepted by {@link createConstraintsManager}.
 *
 * @internal
 */
export interface CreateConstraintsOptions<S extends Schema> {
  /** Constraint definitions keyed by ID. */
  definitions: ConstraintsDef<S>;
  /** Proxy-based facts object used to evaluate `when()` predicates. */
  facts: Facts<S>;
  /** Custom key functions for requirement deduplication, keyed by constraint ID. */
  requirementKeys?: Record<string, RequirementKeyFn>;
  /** Default timeout in milliseconds for async constraint evaluation (defaults to 5 000). */
  defaultTimeout?: number;
  /** Called after each constraint evaluation with the constraint ID and whether `when()` was active. */
  onEvaluate?: (id: string, active: boolean) => void;
  /** Called when a constraint's `when()` or `require()` throws. */
  onError?: (id: string, error: unknown) => void;
}

/** Default async constraint timeout (5 seconds) */
const DEFAULT_TIMEOUT = 5000;

/**
 * Create a manager that evaluates constraint rules and produces unmet
 * requirements.
 *
 * @remarks
 * Constraints are evaluated in priority order (higher priority first), with
 * topological ordering for same-priority constraints connected by `after`
 * dependencies. The manager supports sync and async `when()` predicates,
 * incremental evaluation based on changed fact keys, and per-constraint
 * enable/disable toggling. Cycle detection runs eagerly at construction time
 * to prevent deadlocks in production.
 *
 * @param options - Configuration including constraint definitions, facts proxy,
 *   custom requirement key functions, and lifecycle callbacks.
 * @returns A {@link ConstraintsManager} for evaluating, invalidating, and
 *   managing constraint lifecycle.
 *
 * @example
 * ```typescript
 * const constraints = createConstraintsManager({
 *   definitions: {
 *     mustTransition: {
 *       priority: 50,
 *       when: (facts) => facts.phase === "red" && facts.elapsed > 30,
 *       require: { type: "TRANSITION", to: "green" },
 *     },
 *   },
 *   facts: factsProxy,
 *   onEvaluate: (id, active) => console.log(id, active),
 * });
 *
 * const unmet = await constraints.evaluate();
 * ```
 *
 * @internal
 */
export function createConstraintsManager<S extends Schema>(
  options: CreateConstraintsOptions<S>,
): ConstraintsManager<S> {
  const {
    definitions,
    facts,
    requirementKeys = {},
    defaultTimeout = DEFAULT_TIMEOUT,
    onEvaluate,
    onError,
  } = options;

  // Internal state for each constraint
  const states = new Map<string, ConstraintState>();
  const disabled = new Set<string>();

  // Track which constraints are async
  const asyncConstraintIds = new Set<string>();

  // Dependency tracking: which facts each constraint depends on
  const constraintDeps = new Map<string, Set<string>>();
  // Reverse mapping: which constraints depend on each fact
  const factToConstraints = new Map<string, Set<string>>();
  // Track which constraints need re-evaluation
  const dirtyConstraints = new Set<string>();
  // Cache latest when() deps so they can be combined with require() deps atomically
  const latestWhenDeps = new Map<string, Set<string>>();
  // Track last requirements for each constraint (for incremental updates)
  const lastRequirements = new Map<string, RequirementWithId[]>();
  // First evaluation flag
  let hasEvaluated = false;
  // Track resolved constraints (for `after` ordering)
  const resolvedConstraints = new Set<string>();
  // Track constraints that didn't fire (when() returned false) - they don't block
  const noFireConstraints = new Set<string>();
  // Reverse dependency map: which constraints depend on this one (for O(1) markResolved)
  const dependsOnMe = new Map<string, Set<string>>();
  // Topological order of constraints (dependencies before dependents)
  let topologicalOrder: string[] = [];
  // Cached topological index map for O(1) lookups during sorting
  let topologicalIndex: Map<string, number> = new Map();

  /** Register a single `after` dependency in the reverse map */
  function addReverseDep(depId: string, dependentId: string): void {
    if (!definitions[depId]) {
      return;
    }
    if (!dependsOnMe.has(depId)) {
      dependsOnMe.set(depId, new Set());
    }
    dependsOnMe.get(depId)!.add(dependentId);
  }

  /**
   * Build reverse dependency map for O(1) lookups in markResolved.
   * Maps each constraint ID to the set of constraints that depend on it via `after`.
   */
  function buildReverseDependencyMap(): void {
    dependsOnMe.clear();
    for (const [id, def] of Object.entries(definitions)) {
      if (!def.after) {
        continue;
      }
      for (const depId of def.after) {
        addReverseDep(depId, id);
      }
    }
  }

  /**
   * DFS visitor for cycle detection and topological ordering.
   * Throws on back edges (cycles). Appends to `postOrder` in post-order.
   */
  function topoVisit(
    id: string,
    path: string[],
    visited: Set<string>,
    visiting: Set<string>,
    postOrder: string[],
  ): void {
    if (visited.has(id)) {
      return;
    }

    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id].join(" \u2192 ");
      throw new Error(
        `[Directive] Constraint cycle detected: ${cycle}. Remove one of the \`after\` dependencies to break the cycle.`,
      );
    }

    visiting.add(id);
    path.push(id);

    const def = definitions[id];
    if (def?.after) {
      for (const depId of def.after) {
        if (definitions[depId]) {
          topoVisit(depId, path, visited, visiting, postOrder);
        }
      }
    }

    path.pop();
    visiting.delete(id);
    visited.add(id);
    postOrder.push(id);
  }

  /**
   * Detect cycles in the constraint dependency graph and compute topological order.
   * Uses DFS to find back edges and post-order for topological sort.
   */
  function detectCyclesAndComputeTopoOrder(): void {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const postOrder: string[] = [];

    for (const id of Object.keys(definitions)) {
      topoVisit(id, [], visited, visiting, postOrder);
    }

    // Post-order with dependency-first traversal gives us topological order
    topologicalOrder = postOrder;

    // Build index map for O(1) lookups during sorting
    topologicalIndex = new Map(
      topologicalOrder.map((id, index) => [id, index]),
    );
  }

  // Validate constraint graph (always run - cycle in production would cause deadlock)
  // Also computes topological order for O(n) evaluation
  detectCyclesAndComputeTopoOrder();

  // Build reverse dependency map for O(1) markResolved lookups
  buildReverseDependencyMap();

  /** Warn about `after` references to non-existent constraints */
  function warnUnknownAfterRefs(): void {
    for (const [id, def] of Object.entries(definitions)) {
      if (!def.after) {
        continue;
      }
      for (const depId of def.after) {
        if (!definitions[depId]) {
          console.warn(
            `[Directive] Constraint "${id}" references unknown constraint "${depId}" in \`after\`. This dependency will be ignored. Check for typos or ensure the constraint exists.`,
          );
        }
      }
    }
  }

  // Validate `after` references in dev mode (catch typos early)
  if (process.env.NODE_ENV !== "production") {
    warnUnknownAfterRefs();
  }

  /**
   * Determine if a constraint is async.
   * Uses the explicit `async` flag if provided, otherwise falls back to runtime detection.
   * Runtime detection is only used on first evaluation and logs a dev warning.
   */
  function isAsyncConstraint(
    id: string,
    def: ConstraintsDef<S>[string],
  ): boolean {
    // Prefer explicit flag to avoid runtime detection side effects
    if (def.async !== undefined) {
      return def.async;
    }

    // Check if we've already detected this constraint as async
    if (asyncConstraintIds.has(id)) {
      return true;
    }

    // Runtime detection is deferred to first evaluation
    // We'll detect it in evaluateSync if it returns a Promise
    return false;
  }

  /** Initialize state for a constraint */
  function initState(id: string): ConstraintState {
    const def = definitions[id];
    if (!def) {
      throw new Error(`[Directive] Unknown constraint: ${id}`);
    }

    const isAsync = isAsyncConstraint(id, def);
    if (isAsync) {
      asyncConstraintIds.add(id);
    }

    const state: ConstraintState = {
      id,
      priority: def.priority ?? 0,
      isAsync,
      lastResult: null,
      isEvaluating: false,
      error: null,
      lastResolvedAt: null,
      after: def.after ?? [],
      hitCount: 0,
      lastActiveAt: null,
    };

    states.set(id, state);
    return state;
  }

  /** Get or create state for a constraint */
  function getState(id: string): ConstraintState {
    return states.get(id) ?? initState(id);
  }

  /** Check if two dependency sets are equal (returns false for empty sets) */
  function depsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size || a.size === 0) {
      return false;
    }
    for (const dep of b) {
      if (!a.has(dep)) {
        return false;
      }
    }

    return true;
  }

  /** Remove a constraint from the reverse fact-to-constraint map */
  function removeFromFactMap(id: string, deps: Set<string>): void {
    for (const dep of deps) {
      const constraints = factToConstraints.get(dep);
      if (!constraints) {
        continue;
      }
      constraints.delete(id);
      if (constraints.size === 0) {
        factToConstraints.delete(dep);
      }
    }
  }

  /** Add a constraint to the reverse fact-to-constraint map */
  function addToFactMap(id: string, deps: Set<string>): void {
    for (const dep of deps) {
      if (!factToConstraints.has(dep)) {
        factToConstraints.set(dep, new Set());
      }
      factToConstraints.get(dep)!.add(id);
    }
  }

  /** Remove a constraint from all dependency maps */
  function clearConstraintDeps(id: string): void {
    const deps = constraintDeps.get(id);
    if (deps) {
      removeFromFactMap(id, deps);
      constraintDeps.delete(id);
    }
  }

  /** Remove a constraint from the reverse dependency map (dependsOnMe) */
  function clearReverseDeps(id: string): void {
    dependsOnMe.delete(id);
    for (const depSet of dependsOnMe.values()) {
      depSet.delete(id);
    }
  }

  /** Update dependency tracking for a constraint */
  function updateDependencies(id: string, newDeps: Set<string>): void {
    const oldDeps = constraintDeps.get(id) ?? new Set();

    if (depsEqual(oldDeps, newDeps)) {
      return;
    }

    removeFromFactMap(id, oldDeps);
    addToFactMap(id, newDeps);
    constraintDeps.set(id, newDeps);
  }

  /** Track or evaluate the `when()` predicate, returning the result and recording deps */
  function evaluateWhenPredicate(
    id: string,
    def: ConstraintsDef<S>[string],
  ): boolean | Promise<boolean> {
    if (def.deps) {
      latestWhenDeps.set(id, new Set(def.deps));

      return def.when(facts);
    }

    // Track dependencies during evaluation
    const tracked = withTracking(() => def.when(facts));
    latestWhenDeps.set(id, tracked.deps);

    return tracked.value;
  }

  /** Update constraint state after a successful when() evaluation */
  function recordConstraintResult(
    id: string,
    state: ConstraintState,
    result: boolean,
  ): void {
    state.lastResult = result;
    if (result) {
      state.hitCount++;
      state.lastActiveAt = Date.now();
    }
    state.isEvaluating = false;
    onEvaluate?.(id, result);
  }

  /** Record a constraint evaluation error */
  function recordConstraintError(
    id: string,
    state: ConstraintState,
    error: unknown,
  ): void {
    state.error = error instanceof Error ? error : new Error(String(error));
    state.lastResult = false;
    state.isEvaluating = false;
    onError?.(id, error);
  }

  /** Handle runtime-detected async constraint: mark as async and return wrapped promise */
  function handleRuntimeAsyncResult(
    id: string,
    state: ConstraintState,
    promise: Promise<boolean>,
  ): Promise<boolean> {
    asyncConstraintIds.add(id);
    state.isAsync = true;

    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[Directive] Constraint "${id}" returned a Promise but was not marked as async. Add \`async: true\` to the constraint definition to avoid this warning and improve performance.`,
      );
    }

    return promise
      .then((asyncResult) => {
        recordConstraintResult(id, state, asyncResult);

        return asyncResult;
      })
      .catch((error) => {
        recordConstraintError(id, state, error);

        return false;
      });
  }

  /** Evaluate a single sync constraint */
  function evaluateSync(id: string): boolean | Promise<boolean> {
    const def = definitions[id];
    if (!def) {
      return false;
    }

    const state = getState(id);
    state.isEvaluating = true;
    state.error = null;

    try {
      const result = evaluateWhenPredicate(id, def);

      // Runtime async detection: if this was thought to be sync but returns a Promise
      if (result instanceof Promise) {
        return handleRuntimeAsyncResult(id, state, result);
      }

      recordConstraintResult(id, state, result);

      return result;
    } catch (error) {
      recordConstraintError(id, state, error);

      return false;
    }
  }

  /** Evaluate a single async constraint with timeout */
  async function evaluateAsync(id: string): Promise<boolean> {
    const def = definitions[id];
    if (!def) {
      return false;
    }

    const state = getState(id);
    const timeout = def.timeout ?? defaultTimeout;

    state.isEvaluating = true;
    state.error = null;

    // Register explicit deps before await (auto-tracking can't work across async boundaries)
    if (def.deps?.length) {
      const depsSet = new Set(def.deps);
      updateDependencies(id, depsSet);
      latestWhenDeps.set(id, depsSet);
    }

    try {
      const resultPromise = def.when(facts) as Promise<boolean>;

      // Race against timeout (with proper cleanup)
      const result = await withTimeout(
        resultPromise,
        timeout,
        `Constraint "${id}" timed out after ${timeout}ms`,
      );

      state.lastResult = result;
      if (result) {
        state.hitCount++;
        state.lastActiveAt = Date.now();
      }
      state.isEvaluating = false;
      onEvaluate?.(id, result);
      return result;
    } catch (error) {
      state.error = error instanceof Error ? error : new Error(String(error));
      state.lastResult = false;
      state.isEvaluating = false;
      onError?.(id, error);
      return false;
    }
  }

  /** Max requirements per constraint before warning in dev mode */
  const MAX_REQUIREMENTS_WARNING_THRESHOLD = 10;

  /**
   * Normalize a requirement output to an array of requirements.
   * - null/undefined → []
   * - single requirement → [requirement]
   * - array → filtered to remove null/undefined
   */
  function normalizeRequirements(
    output: RequirementOutput,
    constraintId?: string,
  ): Requirement[] {
    if (output === null || output === undefined) {
      return [];
    }
    if (Array.isArray(output)) {
      // Filter out null/undefined from arrays
      const filtered = output.filter(
        (r): r is Requirement => r !== null && r !== undefined,
      );

      // Warn in dev mode if constraint produces many requirements
      if (
        process.env.NODE_ENV !== "production" &&
        filtered.length > MAX_REQUIREMENTS_WARNING_THRESHOLD &&
        constraintId
      ) {
        console.warn(
          `[Directive] Constraint "${constraintId}" produced ${filtered.length} requirements. Consider splitting into multiple constraints for better performance.`,
        );
      }

      return filtered;
    }
    return [output];
  }

  /** Get the requirements for a constraint, tracking dependencies if require is a function */
  function getRequirements(id: string): {
    requirements: Requirement[];
    deps: Set<string>;
  } {
    const def = definitions[id];
    if (!def) {
      return { requirements: [], deps: new Set() };
    }

    const requireDef = def.require;
    if (typeof requireDef === "function") {
      // Track dependencies when require is a function
      const { value: output, deps } = withTracking(() => requireDef(facts));
      const requirements = normalizeRequirements(
        output as RequirementOutput,
        id,
      );
      return { requirements, deps };
    }

    const requirements = normalizeRequirements(
      requireDef as RequirementOutput,
      id,
    );
    return { requirements, deps: new Set() };
  }

  /** Merge additional dependencies into existing constraint deps */
  function mergeDependencies(id: string, additionalDeps: Set<string>): void {
    if (additionalDeps.size === 0) {
      return;
    }

    const existingDeps = constraintDeps.get(id) ?? new Set();
    for (const dep of additionalDeps) {
      existingDeps.add(dep);
    }
    addToFactMap(id, additionalDeps);
    constraintDeps.set(id, existingDeps);
  }

  // Initialize all constraint states and cache sorted order
  let sortedConstraintIds: string[] | null = null;

  /**
   * Get constraint IDs sorted by:
   * 1. Priority (higher first)
   * 2. Topological order (dependencies before dependents) for same priority
   * This enables O(n) evaluation in the best case when priorities align with dependencies.
   *
   * Uses cached topologicalIndex for O(1) lookups during comparison.
   */
  function getSortedConstraintIds(): string[] {
    if (!sortedConstraintIds) {
      sortedConstraintIds = Object.keys(definitions).sort((a, b) => {
        const stateA = getState(a);
        const stateB = getState(b);

        // Primary sort: priority (higher first)
        const priorityDiff = stateB.priority - stateA.priority;
        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        // Secondary sort: topological order (dependencies first)
        // Uses cached topologicalIndex for O(1) lookups
        const topoA = topologicalIndex.get(a) ?? 0;
        const topoB = topologicalIndex.get(b) ?? 0;
        return topoA - topoB;
      });
    }
    return sortedConstraintIds;
  }

  for (const id of Object.keys(definitions)) {
    initState(id);
  }

  /** Warn about async constraints without explicit deps (dev mode only) */
  function warnAsyncWithoutDeps(defs: ConstraintsDef<S>): void {
    for (const [id, def] of Object.entries(defs)) {
      if (def.async && !def.deps) {
        console.warn(
          `[Directive] Async constraint "${id}" has no \`deps\` declared. Auto-tracking cannot work across async boundaries. Add \`deps: ["key1", "key2"]\` to enable dependency tracking.`,
        );
      }
    }
  }

  // Dev-mode: warn about async constraints without explicit deps
  if (process.env.NODE_ENV !== "production") {
    warnAsyncWithoutDeps(definitions);
  }

  /**
   * Check if a single `after` dependency is satisfied (resolved, no-fire, disabled, or external).
   */
  function isAfterDepSatisfied(depId: string): boolean {
    // External deps (cross-module) are handled externally
    if (!definitions[depId]) {
      return true;
    }
    // Disabled deps can't fire
    if (disabled.has(depId)) {
      return true;
    }
    // Deps that didn't fire (when returned false) don't block
    if (noFireConstraints.has(depId)) {
      return true;
    }

    return resolvedConstraints.has(depId);
  }

  /**
   * Check if a constraint's `after` dependencies are satisfied.
   */
  function areAfterDependenciesSatisfied(id: string): boolean {
    const state = states.get(id);
    if (!state || state.after.length === 0) {
      return true;
    }

    for (const depId of state.after) {
      if (!isAfterDepSatisfied(depId)) {
        return false;
      }
    }

    return true;
  }

  /** Handle an inactive constraint: update deps and mark as no-fire */
  function handleInactiveConstraint(id: string): void {
    const whenDeps = latestWhenDeps.get(id);
    if (whenDeps !== undefined) {
      updateDependencies(id, whenDeps);
    }
    noFireConstraints.add(id);
    lastRequirements.set(id, []);
  }

  /** Update constraint deps atomically from when + require deps */
  function updateConstraintDeps(
    id: string,
    whenDeps: Set<string> | undefined,
    requireDeps: Set<string>,
  ): void {
    if (whenDeps !== undefined) {
      // Combine when() + require() deps atomically to prevent
      // require deps from being temporarily lost between updates
      const combinedDeps = new Set(whenDeps);
      for (const dep of requireDeps) {
        combinedDeps.add(dep);
      }
      updateDependencies(id, combinedDeps);
    } else {
      // Async constraint (no when deps tracked) — merge additively
      mergeDependencies(id, requireDeps);
    }
  }

  /** Emit requirements for an active constraint into the requirement set */
  function emitConstraintRequirements(
    id: string,
    reqs: Requirement[],
    requirements: RequirementSet,
  ): void {
    if (reqs.length === 0) {
      lastRequirements.set(id, []);

      return;
    }
    const keyFn = requirementKeys[id];
    const reqsWithId = reqs.map((req) =>
      createRequirementWithId(req, id, keyFn),
    );
    for (const reqWithId of reqsWithId) {
      requirements.add(reqWithId);
    }
    lastRequirements.set(id, reqsWithId);
  }

  /** Add cached requirements into the requirement set */
  function addCachedRequirements(
    reqs: RequirementWithId[],
    requirements: RequirementSet,
  ): void {
    for (const req of reqs) {
      requirements.add(req);
    }
  }

  /**
   * Process a constraint result: handle requirements and track no-fire state.
   * Extracted from evaluate() to reduce nesting-based cognitive complexity.
   */
  function processConstraintResult(
    id: string,
    active: boolean,
    requirements: RequirementSet,
  ): void {
    if (disabled.has(id)) {
      return;
    }

    if (!active) {
      handleInactiveConstraint(id);

      return;
    }

    // Remove from no-fire tracking since it fired
    noFireConstraints.delete(id);

    const whenDeps = latestWhenDeps.get(id);
    let reqs: Requirement[];
    let requireDeps: Set<string>;
    try {
      const result = getRequirements(id);
      reqs = result.requirements;
      requireDeps = result.deps;
    } catch (error) {
      onError?.(id, error);
      handleInactiveConstraint(id);

      return;
    }

    updateConstraintDeps(id, whenDeps, requireDeps);
    emitConstraintRequirements(id, reqs, requirements);
  }

  /** Partition constraint IDs into blocked and ready based on `after` deps */
  function partitionByReadiness(
    constraintIds: string[],
    requirements: RequirementSet,
  ): { blocked: string[]; ready: string[] } {
    const blocked: string[] = [];
    const ready: string[] = [];

    for (const id of constraintIds) {
      if (areAfterDependenciesSatisfied(id)) {
        ready.push(id);
        continue;
      }
      blocked.push(id);
      const lastReqs = lastRequirements.get(id);
      if (lastReqs) {
        addCachedRequirements(lastReqs, requirements);
      }
    }

    return { blocked, ready };
  }

  /** Evaluate sync constraints, returning any that turned out to be async at runtime */
  function evaluateSyncBatch(
    syncIds: string[],
    requirements: RequirementSet,
  ): Array<{ id: string; promise: Promise<boolean> }> {
    const unexpectedAsync: Array<{ id: string; promise: Promise<boolean> }> =
      [];

    for (const id of syncIds) {
      const result = evaluateSync(id);

      if (result instanceof Promise) {
        unexpectedAsync.push({ id, promise: result });
        continue;
      }

      processConstraintResult(id, result, requirements);
    }

    return unexpectedAsync;
  }

  /** Await an array of {id, promise} pairs and process each result */
  async function awaitAndProcess(
    pairs: Array<{ id: string; promise: Promise<boolean> }>,
    requirements: RequirementSet,
  ): Promise<void> {
    const results = await Promise.all(
      pairs.map(async ({ id, promise }) => ({
        id,
        active: await promise,
      })),
    );
    for (const { id, active } of results) {
      processConstraintResult(id, active, requirements);
    }
  }

  /**
   * Evaluate constraints, respecting `after` dependencies.
   * Returns list of constraints that are still blocked after this pass.
   */
  async function evaluateConstraintBatch(
    constraintIds: string[],
    requirements: RequirementSet,
  ): Promise<string[]> {
    const { blocked, ready } = partitionByReadiness(
      constraintIds,
      requirements,
    );

    if (ready.length === 0) {
      return blocked;
    }

    // Separate sync and async constraints from ready-to-evaluate
    const syncConstraints: string[] = [];
    const asyncConstraints: string[] = [];

    for (const id of ready) {
      if (getState(id).isAsync) {
        asyncConstraints.push(id);
      } else {
        syncConstraints.push(id);
      }
    }

    // Evaluate sync constraints first (some may turn out async at runtime)
    const unexpectedAsync = evaluateSyncBatch(syncConstraints, requirements);

    // Handle sync constraints that turned out to be async
    if (unexpectedAsync.length > 0) {
      await awaitAndProcess(unexpectedAsync, requirements);
    }

    // Evaluate async constraints in parallel
    if (asyncConstraints.length > 0) {
      const asyncPairs = asyncConstraints.map((id) => ({
        id,
        promise: evaluateAsync(id),
      }));
      await awaitAndProcess(asyncPairs, requirements);
    }

    return blocked;
  }

  /** Collect enabled constraint IDs affected by a set of changed fact keys */
  function collectAffectedByKeys(
    changedKeys: Set<string>,
    into: Set<string>,
  ): void {
    for (const key of changedKeys) {
      const deps = factToConstraints.get(key);
      if (!deps) {
        continue;
      }
      for (const id of deps) {
        if (!disabled.has(id)) {
          into.add(id);
        }
      }
    }
  }

  /** Collect enabled dirty constraints into a set */
  function collectDirtyConstraints(into: Set<string>): void {
    for (const id of dirtyConstraints) {
      if (!disabled.has(id)) {
        into.add(id);
      }
    }
    dirtyConstraints.clear();
  }

  /** Compute the set of affected constraint IDs from changed keys + dirty set */
  function computeAffectedConstraints(changedKeys: Set<string>): Set<string> {
    const affected = new Set<string>();
    collectAffectedByKeys(changedKeys, affected);
    collectDirtyConstraints(affected);

    return affected;
  }

  /** Carry forward cached requirements for constraints not being re-evaluated */
  function carryForwardRequirements(
    allIds: string[],
    affected: Set<string>,
    requirements: RequirementSet,
  ): void {
    for (const id of allIds) {
      if (affected.has(id)) {
        continue;
      }
      const lastReqs = lastRequirements.get(id);
      if (lastReqs) {
        addCachedRequirements(lastReqs, requirements);
      }
    }
  }

  const manager: ConstraintsManager<S> = {
    async evaluate(changedKeys?: Set<string>): Promise<RequirementWithId[]> {
      const requirements = new RequirementSet();

      // Note: resolvedConstraints persists across reconcile cycles intentionally.
      // `after` ordering means "wait until dependency's resolver has completed",
      // and that completion happens in a different cycle than the evaluation.
      // noFireConstraints is re-populated during each evaluation pass.
      noFireConstraints.clear();

      // Get all enabled constraints (use cached sort order)
      const allConstraintIds = getSortedConstraintIds().filter(
        (id) => !disabled.has(id),
      );

      // Determine which constraints to evaluate
      let constraintsToEvaluate: string[];

      if (!hasEvaluated || !changedKeys || changedKeys.size === 0) {
        // First evaluation or no specific changes: evaluate all
        constraintsToEvaluate = allConstraintIds;
        hasEvaluated = true;
      } else {
        const affected = computeAffectedConstraints(changedKeys);
        constraintsToEvaluate = [...affected];
        carryForwardRequirements(allConstraintIds, affected, requirements);
      }

      // Evaluate constraints in passes until no blocked constraints become unblocked
      let remainingToEvaluate = constraintsToEvaluate;
      let maxPasses = constraintsToEvaluate.length + 1; // Prevent infinite loops

      while (remainingToEvaluate.length > 0 && maxPasses > 0) {
        const previousRemaining = remainingToEvaluate.length;
        remainingToEvaluate = await evaluateConstraintBatch(
          remainingToEvaluate,
          requirements,
        );

        // If no progress was made (all still blocked), break
        if (remainingToEvaluate.length === previousRemaining) {
          break;
        }
        maxPasses--;
      }

      return requirements.all();
    },

    getState(id: string): ConstraintState | undefined {
      return states.get(id);
    },

    getDependencies(id: string): Set<string> | undefined {
      return constraintDeps.get(id);
    },

    getAllStates(): ConstraintState[] {
      return [...states.values()];
    },

    disable(id: string): void {
      if (!states.has(id)) {
        console.warn(
          `[Directive] constraints.disable("${id}") — no such constraint`,
        );

        return;
      }
      disabled.add(id);
      // Invalidate cache when constraints change
      sortedConstraintIds = null;
      // Mark as dirty so it gets removed from requirements on next evaluate
      lastRequirements.delete(id);
      // Clean up dependency maps for disabled constraint
      clearConstraintDeps(id);
      latestWhenDeps.delete(id);
    },

    enable(id: string): void {
      if (!states.has(id)) {
        console.warn(
          `[Directive] constraints.enable("${id}") — no such constraint`,
        );

        return;
      }
      disabled.delete(id);
      // Invalidate cache when constraints change
      sortedConstraintIds = null;
      // Mark as dirty so it gets evaluated on next cycle
      dirtyConstraints.add(id);
    },

    isDisabled(id: string): boolean {
      return disabled.has(id);
    },

    invalidate(factKey: string): void {
      // Mark all constraints that depend on this fact as dirty
      const dependentConstraints = factToConstraints.get(factKey);
      if (dependentConstraints) {
        for (const id of dependentConstraints) {
          dirtyConstraints.add(id);
        }
      }
    },

    markResolved(constraintId: string): void {
      resolvedConstraints.add(constraintId);
      const state = states.get(constraintId);
      if (state) {
        state.lastResolvedAt = Date.now();
      }

      // Mark all constraints that depend on this one (via `after`) as dirty
      // so they get re-evaluated on the next reconcile
      // Uses reverse dependency map for O(1) lookup instead of O(n*m) iteration
      const dependents = dependsOnMe.get(constraintId);
      if (dependents) {
        for (const id of dependents) {
          dirtyConstraints.add(id);
        }
      }
    },

    isResolved(constraintId: string): boolean {
      return resolvedConstraints.has(constraintId);
    },

    registerDefinitions(newDefs: ConstraintsDef<Schema>): void {
      let hasAfterDeps = false;
      for (const [key, def] of Object.entries(newDefs)) {
        (definitions as Record<string, unknown>)[key] = def;
        initState(key);
        dirtyConstraints.add(key);
        if (def.after?.length) {
          hasAfterDeps = true;
        }
      }
      // Invalidate cached sort order
      sortedConstraintIds = null;
      // Only rebuild topo order when new constraints have `after` dependencies
      if (hasAfterDeps) {
        detectCyclesAndComputeTopoOrder();
      }
      // Always rebuild reverse deps — existing constraints may reference
      // newly-added IDs in their `after` arrays (forward references)
      buildReverseDependencyMap();
    },

    assignDefinition(id: string, def: ConstraintsDef<Schema>[string]): void {
      if (!definitions[id]) {
        throw new Error(
          `[Directive] Cannot assign constraint "${id}" — it does not exist. Use register() to create it.`,
        );
      }

      // Replace definition
      (definitions as Record<string, unknown>)[id] = def;
      // Re-init state for the new definition
      initState(id);
      dirtyConstraints.add(id);
      // Invalidate cached sort order (priority may have changed)
      sortedConstraintIds = null;
      // Rebuild topo order + reverse deps in case `after` changed
      detectCyclesAndComputeTopoOrder();
      buildReverseDependencyMap();
    },

    unregisterDefinition(id: string): void {
      if (!definitions[id]) {
        return;
      }

      // Remove from all internal maps
      delete (definitions as Record<string, unknown>)[id];
      states.delete(id);
      disabled.delete(id);
      asyncConstraintIds.delete(id);
      dirtyConstraints.delete(id);
      noFireConstraints.delete(id);
      resolvedConstraints.delete(id);
      lastRequirements.delete(id);
      latestWhenDeps.delete(id);

      // Clean dependency and reverse dependency maps
      clearConstraintDeps(id);
      clearReverseDeps(id);

      // Invalidate cached sort order
      sortedConstraintIds = null;
      // Rebuild topo order
      detectCyclesAndComputeTopoOrder();
      buildReverseDependencyMap();
    },

    async callOne(
      id: string,
      props?: Record<string, unknown>,
    ): Promise<RequirementWithId[]> {
      const def = definitions[id];
      if (!def) {
        throw new Error(
          `[Directive] Cannot call constraint "${id}" — it does not exist.`,
        );
      }

      // Respect disabled state
      if (disabled.has(id)) {
        return [];
      }

      const state = getState(id);
      let active: boolean;

      if (state.isAsync) {
        active = await evaluateAsync(id);
      } else {
        const result = evaluateSync(id);
        active = result instanceof Promise ? await result : result;
      }

      if (!active) {
        return [];
      }

      // Get requirements and merge props if provided
      const { requirements: reqs } = getRequirements(id);
      if (reqs.length === 0) {
        return [];
      }

      const keyFn = requirementKeys[id];
      const result: RequirementWithId[] = [];
      for (const req of reqs) {
        const merged = props ? { ...req, ...props } : req;
        result.push(createRequirementWithId(merged, id, keyFn));
      }

      return result;
    },
  };

  return manager;
}

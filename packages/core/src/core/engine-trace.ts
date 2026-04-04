/**
 * Trace management for the engine reconciliation loop.
 *
 * Extracted from engine.ts to reduce file size. Owns all trace state:
 * ring buffer, per-run entries, resolver attribution maps, anomaly stats,
 * and the cached snapshot array.
 *
 * @internal
 */

import type { PluginManager } from "./plugins.js";
import type { Schema, TraceEntry } from "./types.js";

// ============================================================================
// TraceManager Interface
// ============================================================================

/**
 * Manages per-run reconciliation traces for the engine.
 *
 * @remarks
 * Each reconcile cycle starts a new trace entry that accumulates fact changes,
 * derivation recomputations, constraint hits, requirement diffs, resolver
 * starts/completions/errors, and effect runs. Entries stay "pending" while
 * resolvers are inflight and finalize to "settled" when all complete.
 *
 * The ring buffer caps at `maxRuns` entries with FIFO eviction. A cached
 * snapshot array avoids re-spreading on every `system.trace` read.
 *
 * @internal
 */
export interface TraceManager {
  /** Whether tracing is enabled */
  readonly enabled: boolean;

  /**
   * Record a fact change (queued until the next reconcile starts).
   *
   * @param key - The fact key that changed
   * @param oldValue - Previous value
   * @param newValue - New value
   */
  recordFactChange(key: string, oldValue: unknown, newValue: unknown): void;

  /**
   * Start a new trace entry for the current reconcile run.
   * Drains pending fact changes into the new entry.
   *
   * @returns The start timestamp (performance.now()) for duration calculation
   */
  startRun(): number;

  /** The current in-progress trace entry, or null between reconcile runs */
  currentTrace: TraceEntry | null;

  /**
   * Get the cached trace entries array (returns null when tracing is disabled).
   * Re-builds the cache only when the version counter has changed.
   */
  getEntries(): TraceEntry[] | null;

  /**
   * Attribute a resolver start to the current trace entry.
   *
   * @param requirementId - The requirement being resolved
   */
  attributeResolverStart(requirementId: string): void;

  /**
   * Record a resolver completion on its originating trace entry.
   *
   * @param requirementId - The requirement that was resolved
   * @param resolver - The resolver ID
   * @param duration - Resolution time in ms
   */
  recordResolverComplete(
    requirementId: string,
    resolver: string,
    duration: number,
  ): void;

  /**
   * Record a resolver error on its originating trace entry.
   *
   * @param requirementId - The requirement that errored
   * @param resolver - The resolver ID
   * @param error - The error (stringified)
   */
  recordResolverError(
    requirementId: string,
    resolver: string,
    error: string,
  ): void;

  /**
   * Decrement inflight count for the trace associated with a requirement.
   * Finalizes the trace entry when all resolvers have settled.
   *
   * @param requirementId - The requirement whose resolver settled
   */
  decrementInflight(requirementId: string): void;

  /**
   * Finalize the current trace entry at the end of a reconcile cycle.
   * Determines whether the entry has activity, pushes it to the ring buffer,
   * and either settles immediately or leaves it pending for inflight resolvers.
   *
   * @param reconcileStartMs - The performance.now() timestamp from startRun()
   */
  finalizeCurrentRun(reconcileStartMs: number): void;

  /**
   * Drain any pending fact changes (e.g., on reconcile depth overflow).
   */
  drainPendingChanges(): void;

  /**
   * Clean up all trace state.
   */
  destroy(): void;
}

// ============================================================================
// TraceManager Implementation
// ============================================================================

/**
 * Options for creating a trace manager.
 *
 * @internal
 */
export interface CreateTraceManagerOptions<S extends Schema> {
  /** Trace config from system options (true, object, or falsy) */
  traceConfig: boolean | { maxRuns?: number } | undefined;
  /** Plugin manager for emitting trace lifecycle events */
  pluginManager: PluginManager<S>;
  /** Optional callback to resolve meta for a resolver ID (for trace enrichment) */
  resolverMetaLookup?: (resolverId: string) => import("./types/meta.js").DefinitionMeta | undefined;
}

/**
 * Create a trace manager that handles reconciliation trace lifecycle.
 *
 * @remarks
 * When tracing is disabled, returns a no-op manager with zero overhead.
 * When enabled, maintains a ring buffer of trace entries with FIFO eviction,
 * resolver attribution maps, anomaly detection statistics, and a cached
 * snapshot array.
 *
 * @param options - Trace configuration and plugin manager
 * @returns A {@link TraceManager} instance
 *
 * @internal
 */
export function createTraceManager<S extends Schema>(
  options: CreateTraceManagerOptions<S>,
): TraceManager {
  const { traceConfig, pluginManager, resolverMetaLookup } = options;
  const enabled =
    traceConfig === true ||
    (typeof traceConfig === "object" && traceConfig !== null);

  if (!enabled) {
    // Return a no-op manager
    return {
      enabled: false,
      recordFactChange() {},
      startRun() {
        return 0;
      },
      currentTrace: null,
      getEntries() {
        return null;
      },
      attributeResolverStart() {},
      recordResolverComplete() {},
      recordResolverError() {},
      decrementInflight() {},
      finalizeCurrentRun() {},
      drainPendingChanges() {},
      destroy() {},
    };
  }

  const maxRuns =
    (typeof traceConfig === "object" && traceConfig !== null
      ? traceConfig.maxRuns
      : undefined) ?? 100;

  const traceEntries: TraceEntry[] = [];
  const traceById = new Map<number, TraceEntry>();
  let traceIdCounter = 0;
  let currentTrace: TraceEntry | null = null;
  const pendingFactChanges: Array<{
    key: string;
    oldValue: unknown;
    newValue: unknown;
  }> = [];

  // Async resolver attribution: requirementId → traceId
  const resolverTraceMap = new Map<string, number>();
  // Track inflight resolvers per trace: traceId → count of pending resolvers
  const traceInflightCount = new Map<number, number>();
  // Consistent duration: track start time per trace (performance.now() based)
  const traceStartMs = new Map<number, number>();

  // Cached trace getter: avoid spread on every access
  let traceCache: TraceEntry[] | null = null;
  let traceCacheVersion = 0;
  let currentCacheVersion = 0;

  // Anomaly detection statistics
  const traceStats = {
    count: 0,
    totalDuration: 0,
    avgDuration: 0,
    maxDuration: 0,
    avgResolverCount: 0,
    totalResolverCount: 0,
    avgFactChangeCount: 0,
    totalFactChangeCount: 0,
  };

  /** Finalize a trace entry when all its resolvers have settled */
  function finalizeTrace(traceId: number): void {
    const entry = traceById.get(traceId);
    if (entry && entry.status === "pending") {
      entry.status = "settled";
      // Consistent duration: use performance.now() when available
      const startMs = traceStartMs.get(traceId);
      entry.duration =
        startMs !== undefined
          ? performance.now() - startMs
          : Date.now() - entry.timestamp;
      traceStartMs.delete(traceId);
      traceInflightCount.delete(traceId);
      // Build causal chain on settlement
      entry.causalChain = buildCausalChain(entry);
      // Anomaly detection
      updateTraceStats(entry);
      currentCacheVersion++;
      pluginManager.emitTraceComplete(entry);
    }
  }

  /** Decrement inflight count for a trace entry and finalize if settled */
  function decrementTraceInflightInternal(requirementId: string): void {
    const traceId = resolverTraceMap.get(requirementId);
    resolverTraceMap.delete(requirementId);
    if (traceId !== undefined) {
      const remaining = (traceInflightCount.get(traceId) ?? 1) - 1;
      if (remaining <= 0) {
        finalizeTrace(traceId);
      } else {
        traceInflightCount.set(traceId, remaining);
      }
    }
  }

  /** Evict the oldest trace entry from the ring buffer */
  function evictOldestTrace(): void {
    const evicted = traceEntries.shift();
    if (evicted) {
      traceById.delete(evicted.id);
      traceStartMs.delete(evicted.id);
      if (evicted.status === "pending") {
        traceInflightCount.delete(evicted.id);
        for (const [reqId, rId] of resolverTraceMap) {
          if (rId === evicted.id) {
            resolverTraceMap.delete(reqId);
          }
        }
      }
    }
  }

  /** Build a human-readable causal chain summary from a trace entry */
  function buildCausalChain(entry: TraceEntry): string {
    const parts: string[] = [];

    for (const fc of entry.factChanges) {
      parts.push(`${fc.key} changed`);
    }

    for (const d of entry.derivationsRecomputed) {
      parts.push(`${d.id} recomputed`);
    }

    for (const c of entry.constraintsHit) {
      parts.push(`${c.id} constraint hit`);
    }

    for (const r of entry.requirementsAdded) {
      parts.push(`${r.type} requirement added`);
    }

    for (const rs of entry.resolversCompleted) {
      parts.push(`${rs.resolver} resolved (${rs.duration.toFixed(0)}ms)`);
    }

    for (const rs of entry.resolversErrored) {
      parts.push(`${rs.resolver} errored`);
    }

    for (const e of entry.effectsRun) {
      parts.push(`${e.id} effect ran`);
    }

    return parts.join(" → ");
  }

  /** Update running statistics and flag anomalies on a finalized trace entry */
  function updateTraceStats(entry: TraceEntry): void {
    traceStats.count++;
    traceStats.totalDuration += entry.duration;
    traceStats.avgDuration = traceStats.totalDuration / traceStats.count;
    if (entry.duration > traceStats.maxDuration) {
      traceStats.maxDuration = entry.duration;
    }

    const resolverCount = entry.resolversStarted.length;
    traceStats.totalResolverCount += resolverCount;
    traceStats.avgResolverCount =
      traceStats.totalResolverCount / traceStats.count;

    const factChangeCount = entry.factChanges.length;
    traceStats.totalFactChangeCount += factChangeCount;
    traceStats.avgFactChangeCount =
      traceStats.totalFactChangeCount / traceStats.count;

    // Flag anomalies (only after enough data)
    const anomalies: string[] = [];
    if (traceStats.count > 3 && entry.duration > traceStats.avgDuration * 5) {
      anomalies.push(
        `Duration ${entry.duration.toFixed(0)}ms is 5x+ above average (${traceStats.avgDuration.toFixed(0)}ms)`,
      );
    }

    if (entry.resolversErrored.length > 0) {
      anomalies.push(`${entry.resolversErrored.length} resolver(s) errored`);
    }

    if (anomalies.length > 0) {
      entry.anomalies = anomalies;
    }
  }

  /** Push a trace entry to the ring buffer with FIFO eviction */
  function pushTraceEntry(entry: TraceEntry): void {
    traceEntries.push(entry);
    traceById.set(entry.id, entry);
    if (traceEntries.length > maxRuns) {
      evictOldestTrace();
    }
    currentCacheVersion++;
  }

  /** Check if a trace entry has any recorded activity */
  function hasTraceActivity(entry: TraceEntry): boolean {
    return (
      entry.factChanges.length > 0 ||
      entry.constraintsHit.length > 0 ||
      entry.requirementsAdded.length > 0 ||
      entry.effectsRun.length > 0
    );
  }

  const manager: TraceManager = {
    enabled: true,

    get currentTrace() {
      return currentTrace;
    },
    set currentTrace(value: TraceEntry | null) {
      currentTrace = value;
    },

    recordFactChange(key: string, oldValue: unknown, newValue: unknown) {
      pendingFactChanges.push({ key, oldValue, newValue });
    },

    startRun(): number {
      const startMs = performance.now();
      const traceId = ++traceIdCounter;
      traceStartMs.set(traceId, startMs);
      currentTrace = {
        id: traceId,
        timestamp: Date.now(),
        duration: 0,
        status: "pending",
        factChanges: pendingFactChanges.splice(0), // move + clear
        derivationsRecomputed: [],
        constraintsHit: [],
        requirementsAdded: [],
        requirementsRemoved: [],
        resolversStarted: [],
        resolversCompleted: [],
        resolversErrored: [],
        effectsRun: [],
        effectErrors: [],
      };

      return startMs;
    },

    getEntries(): TraceEntry[] | null {
      if (!traceCache || traceCacheVersion !== currentCacheVersion) {
        traceCache = [...traceEntries];
        traceCacheVersion = currentCacheVersion;
      }

      return traceCache;
    },

    attributeResolverStart(requirementId: string) {
      if (currentTrace) {
        resolverTraceMap.set(requirementId, currentTrace.id);
      }
    },

    recordResolverComplete(
      requirementId: string,
      resolver: string,
      duration: number,
    ) {
      const traceId = resolverTraceMap.get(requirementId);
      if (traceId !== undefined) {
        const entry = traceById.get(traceId);
        if (entry) {
          entry.resolversCompleted.push({
            resolver,
            requirementId,
            duration,
            meta: resolverMetaLookup?.(resolver),
          });
        }
      }
    },

    recordResolverError(
      requirementId: string,
      resolver: string,
      error: string,
    ) {
      const traceId = resolverTraceMap.get(requirementId);
      if (traceId !== undefined) {
        const entry = traceById.get(traceId);
        if (entry) {
          entry.resolversErrored.push({
            resolver,
            requirementId,
            error,
            meta: resolverMetaLookup?.(resolver),
          });
        }
      }
    },

    decrementInflight(requirementId: string) {
      decrementTraceInflightInternal(requirementId);
    },

    finalizeCurrentRun(reconcileStartMs: number) {
      if (!currentTrace) {
        return;
      }

      currentTrace.duration = performance.now() - reconcileStartMs;

      if (!hasTraceActivity(currentTrace)) {
        // Empty trace entry — clean up start time
        traceStartMs.delete(currentTrace.id);
        currentTrace = null;

        return;
      }

      const inflightCount = currentTrace.resolversStarted.length;
      if (inflightCount === 0) {
        // No resolvers — finalize immediately
        currentTrace.status = "settled";
        currentTrace.causalChain = buildCausalChain(currentTrace);
        updateTraceStats(currentTrace);
        pushTraceEntry(currentTrace);
        pluginManager.emitTraceComplete(currentTrace);
      } else {
        // Has resolvers — stays pending until they settle
        currentTrace.status = "pending";
        pushTraceEntry(currentTrace);
        traceInflightCount.set(currentTrace.id, inflightCount);
      }

      currentTrace = null;
    },

    drainPendingChanges() {
      pendingFactChanges.length = 0;
    },

    destroy() {
      traceEntries.length = 0;
      traceById.clear();
      resolverTraceMap.clear();
      traceInflightCount.clear();
      traceStartMs.clear();
      pendingFactChanges.length = 0;
      currentTrace = null;
      traceCache = null;
    },
  };

  return manager;
}

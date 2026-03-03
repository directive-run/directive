/**
 * Requirement Status Utilities
 *
 * Provides reactive tracking of requirement status for UI feedback.
 */

import type { Plugin, RequirementWithId } from "../core/types.js";

// ============================================================================
// Types
// ============================================================================

/** Status of a requirement type */
export interface RequirementTypeStatus {
  /** Number of pending (unmet) requirements of this type */
  pending: number;
  /** Number of inflight (being resolved) requirements of this type */
  inflight: number;
  /** Number of failed requirements of this type */
  failed: number;
  /** Whether any requirements of this type are loading (pending or inflight) */
  isLoading: boolean;
  /** Whether any requirements of this type have failed */
  hasError: boolean;
  /** Last error for this type (if any) */
  lastError: Error | null;
}

/** Status tracking state */
interface StatusState {
  pending: Map<string, Set<string>>; // type -> set of requirement IDs
  inflight: Map<string, Set<string>>; // type -> set of requirement IDs
  failed: Map<string, Set<string>>; // type -> set of requirement IDs
  errors: Map<string, Error>; // type -> last error
  listeners: Set<() => void>;
}

// ============================================================================
// Requirement Status Plugin
// ============================================================================

/**
 * Create a plugin that tracks requirement status for reactive UI updates.
 *
 * @example
 * ```typescript
 * import { createRequirementStatusPlugin } from '@directive-run/core';
 *
 * const statusPlugin = createRequirementStatusPlugin();
 *
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [statusPlugin.plugin],
 * });
 *
 * // Get status for a requirement type
 * const status = statusPlugin.getStatus("FETCH_USER");
 * console.log(status.isLoading, status.hasError);
 *
 * // Subscribe to status changes
 * const unsubscribe = statusPlugin.subscribe(() => {
 *   console.log("Status changed:", statusPlugin.getStatus("FETCH_USER"));
 * });
 * ```
 */
export function createRequirementStatusPlugin(): {
  plugin: Plugin<never>;
  getStatus: (type: string) => RequirementTypeStatus;
  getAllStatus: () => Map<string, RequirementTypeStatus>;
  subscribe: (listener: () => void) => () => void;
  reset: () => void;
} {
  const state: StatusState = {
    pending: new Map(),
    inflight: new Map(),
    failed: new Map(),
    errors: new Map(),
    listeners: new Set(),
  };

  /** Notify all listeners */
  function notify(): void {
    for (const listener of state.listeners) {
      listener();
    }
  }

  /** Get or create a set for a type in a map */
  function getOrCreateSet(
    map: Map<string, Set<string>>,
    type: string,
  ): Set<string> {
    let set = map.get(type);
    if (!set) {
      set = new Set();
      map.set(type, set);
    }
    return set;
  }

  /** Get status for a requirement type */
  function getStatus(type: string): RequirementTypeStatus {
    const pendingSet = state.pending.get(type) ?? new Set();
    const inflightSet = state.inflight.get(type) ?? new Set();
    const failedSet = state.failed.get(type) ?? new Set();
    const lastError = state.errors.get(type) ?? null;

    return {
      pending: pendingSet.size,
      inflight: inflightSet.size,
      failed: failedSet.size,
      isLoading: pendingSet.size > 0 || inflightSet.size > 0,
      hasError: failedSet.size > 0,
      lastError,
    };
  }

  /** Get status for all tracked types */
  function getAllStatus(): Map<string, RequirementTypeStatus> {
    const allTypes = new Set([
      ...state.pending.keys(),
      ...state.inflight.keys(),
      ...state.failed.keys(),
    ]);

    const result = new Map<string, RequirementTypeStatus>();
    for (const type of allTypes) {
      result.set(type, getStatus(type));
    }
    return result;
  }

  /** Subscribe to status changes */
  function subscribe(listener: () => void): () => void {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  /** Reset all status */
  function reset(): void {
    state.pending.clear();
    state.inflight.clear();
    state.failed.clear();
    state.errors.clear();
    notify();
  }

  const plugin: Plugin<never> = {
    name: "requirement-status",

    onRequirementCreated(req: RequirementWithId) {
      const type = req.requirement.type;
      getOrCreateSet(state.pending, type).add(req.id);
      // Clear from failed when a new requirement is created
      state.failed.get(type)?.delete(req.id);
      notify();
    },

    onResolverStart(_resolver: string, req: RequirementWithId) {
      const type = req.requirement.type;
      // Move from pending to inflight
      state.pending.get(type)?.delete(req.id);
      getOrCreateSet(state.inflight, type).add(req.id);
      notify();
    },

    onResolverComplete(_resolver: string, req: RequirementWithId) {
      const type = req.requirement.type;
      // Remove from inflight
      state.inflight.get(type)?.delete(req.id);
      state.pending.get(type)?.delete(req.id);
      notify();
    },

    onResolverError(_resolver: string, req: RequirementWithId, error: unknown) {
      const type = req.requirement.type;
      // Move from inflight to failed
      state.inflight.get(type)?.delete(req.id);
      getOrCreateSet(state.failed, type).add(req.id);
      state.errors.set(
        type,
        error instanceof Error ? error : new Error(String(error)),
      );
      notify();
    },

    onResolverCancel(_resolver: string, req: RequirementWithId) {
      const type = req.requirement.type;
      // Remove from all tracking
      state.pending.get(type)?.delete(req.id);
      state.inflight.get(type)?.delete(req.id);
      notify();
    },

    onRequirementMet(req: RequirementWithId) {
      const type = req.requirement.type;
      // Clean up when requirement is met
      state.pending.get(type)?.delete(req.id);
      state.inflight.get(type)?.delete(req.id);
      notify();
    },
  };

  return {
    plugin,
    getStatus,
    getAllStatus,
    subscribe,
    reset,
  };
}

// ============================================================================
// React Hook Helper (for use with React adapter)
// ============================================================================

/**
 * Create a hook factory for requirement status.
 * This is designed to be used with React's useSyncExternalStore.
 *
 * @example
 * ```typescript
 * import { useSyncExternalStore } from 'react';
 * import { createRequirementStatusPlugin, createStatusHook } from '@directive-run/core';
 *
 * const statusPlugin = createRequirementStatusPlugin();
 * const useRequirementStatus = createStatusHook(statusPlugin);
 *
 * function MyComponent() {
 *   const status = useRequirementStatus("FETCH_USER");
 *   if (status.isLoading) return <Spinner />;
 *   if (status.hasError) return <Error error={status.lastError} />;
 *   return <Content />;
 * }
 * ```
 */
export function createStatusHook(
  statusPlugin: ReturnType<typeof createRequirementStatusPlugin>,
): (type: string) => RequirementTypeStatus {
  // This returns a function that can be used with useSyncExternalStore
  // The actual hook implementation would be in the React adapter
  return (type: string) => statusPlugin.getStatus(type);
}

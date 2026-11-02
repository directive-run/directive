/**
 * Copied from 1.35 (packages/core/src/utils/requirement-status.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

import type { Plugin } from "./index.js";

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
export declare function createRequirementStatusPlugin(): {
  plugin: Plugin<never>;
  getStatus: (type: string) => RequirementTypeStatus;
  getAllStatus: () => Map<string, RequirementTypeStatus>;
  subscribe: (listener: () => void) => () => void;
  reset: () => void;
};

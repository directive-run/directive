/**
 * Copied from 1.35 (packages/core/src/plugins/devtools-types.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

// ============================================================================
// Options
// ============================================================================

export interface DevtoolsPluginOptions {
  /** Name for this system in devtools */
  name?: string;
  /** Enable trace logging */
  trace?: boolean;
  /** Maximum number of trace events to retain (default: 1000) */
  maxEvents?: number;
  /** Show floating debug panel (dev mode only, requires browser) */
  panel?: boolean;
  /** Panel position */
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  /** Start panel open */
  defaultOpen?: boolean;
}

// ============================================================================
// Circular Buffer — O(1) push with bounded capacity
// ============================================================================

export interface TraceEvent {
  timestamp: number;
  type: string;
  data: unknown;
}

/**
 * Human-in-the-Loop Breakpoints — Pause/inspect/modify/resume at arbitrary execution points.
 *
 * Separate from approvals (which are safety gates for tool calls). Breakpoints are
 * general-purpose pause points for debugging, inspection, and input modification.
 *
 * Zero overhead when breakpoints array is empty — guard at each insertion point.
 *
 * @module
 */

import { getBridgeFact, setBridgeFact } from "@directive-run/core/adapter-utils";

// ============================================================================
// Types
// ============================================================================

/** Breakpoint types for single-agent orchestrator */
export type BreakpointType =
  | "pre_input_guardrails"
  | "pre_agent_run"
  | "pre_output_guardrails"
  | "post_run";

/** Extended breakpoint types for multi-agent orchestrator */
export type MultiAgentBreakpointType =
  | BreakpointType
  | "pre_handoff"
  | "pre_pattern_step";

/** Breakpoint configuration */
export interface BreakpointConfig<T extends string = BreakpointType> {
  type: T;
  when?: (context: BreakpointContext) => boolean;
  label?: string;
}

/** Context available when a breakpoint fires */
export interface BreakpointContext {
  agentId: string;
  agentName: string;
  input: string;
  state: Record<string, unknown>;
  breakpointType: string;
  patternId?: string;
  handoff?: { fromAgent: string; toAgent: string };
}

/** A pending breakpoint request */
export interface BreakpointRequest {
  id: string;
  type: string;
  agentId: string;
  input: string;
  label?: string;
  requestedAt: number;
}

/** Modifications that can be applied when resuming a breakpoint */
export interface BreakpointModifications {
  input?: string;
  skip?: boolean;
}

/** Breakpoint state stored in facts */
export interface BreakpointState {
  pending: BreakpointRequest[];
  resolved: string[];
  cancelled: string[];
}

// ============================================================================
// Constants
// ============================================================================

// Import from types.ts — single source of truth
import { BREAKPOINT_KEY } from "./types.js";
export { BREAKPOINT_KEY };

/** Maximum number of resolved/cancelled breakpoint IDs to retain (FIFO eviction) */
export const MAX_BREAKPOINT_HISTORY = 200;

// ============================================================================
// Helpers
// ============================================================================

let breakpointCounter = 0;

/** Create a unique breakpoint ID */
export function createBreakpointId(): string {
  return `bp_${Date.now().toString(36)}_${(++breakpointCounter).toString(36)}`;
}

/**
 * Match a breakpoint configuration against the current execution point.
 * Returns the matching config or null if no match.
 */
export function matchBreakpoint<T extends string>(
  breakpoints: BreakpointConfig<T>[],
  type: T,
  context: BreakpointContext,
): BreakpointConfig<T> | null {
  for (const bp of breakpoints) {
    if (bp.type !== type) {
      continue;
    }

    // If no condition, always match
    if (!bp.when) {
      return bp;
    }

    // Evaluate condition (catch errors — user-provided predicate)
    try {
      if (bp.when(context)) {
        return bp;
      }
    } catch {
      // Predicate error — skip this breakpoint
    }
  }

  return null;
}

/** Get breakpoint state from facts */
// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function getBreakpointState(facts: any): BreakpointState {
  return getBridgeFact<BreakpointState>(facts, BREAKPOINT_KEY);
}

/** Set breakpoint state in facts */
// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
export function setBreakpointState(facts: any, state: BreakpointState): void {
  setBridgeFact(facts, BREAKPOINT_KEY, state);
}

/** Create initial breakpoint state */
export function createInitialBreakpointState(): BreakpointState {
  return {
    pending: [],
    resolved: [],
    cancelled: [],
  };
}

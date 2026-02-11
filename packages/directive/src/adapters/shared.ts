/**
 * Shared Adapter Utilities
 *
 * Common types and helper functions used across all framework adapters.
 * @internal
 */

import type { System } from "../core/types.js";

// ============================================================================
// Requirements State
// ============================================================================

/**
 * Requirements state returned by useRequirements hooks.
 * Provides a focused view of just requirements without full inspection overhead.
 */
export interface RequirementsState {
	/** Array of unmet requirements waiting to be resolved */
	unmet: Array<{
		id: string;
		requirement: { type: string; [key: string]: unknown };
		fromConstraint: string;
	}>;
	/** Array of requirements currently being resolved */
	inflight: Array<{ id: string; resolverId: string; startedAt: number }>;
	/** Whether there are any unmet requirements */
	hasUnmet: boolean;
	/** Whether there are any inflight requirements */
	hasInflight: boolean;
	/** Whether the system is actively working (has unmet or inflight requirements) */
	isWorking: boolean;
}

// ============================================================================
// Inspect State (shared across all adapters)
// ============================================================================

/**
 * Consolidated inspection state returned by useInspect hooks.
 * Identical shape across React, Vue, Svelte, Solid, and Lit adapters.
 */
export interface InspectState {
	/** Whether the system has settled (no pending operations) */
	isSettled: boolean;
	/** Array of unmet requirements */
	unmet: RequirementsState["unmet"];
	/** Array of inflight requirements */
	inflight: RequirementsState["inflight"];
	/** Whether the system is actively working */
	isWorking: boolean;
	/** Whether there are any unmet requirements */
	hasUnmet: boolean;
	/** Whether there are any inflight requirements */
	hasInflight: boolean;
}

/**
 * Information about a single constraint.
 */
export interface ConstraintInfo {
	id: string;
	active: boolean;
	priority: number;
}

/**
 * Compute InspectState from a system instance.
 * Centralizes the logic currently duplicated across adapters.
 * @internal
 */
// biome-ignore lint/suspicious/noExplicitAny: Must work with any schema
export function computeInspectState(system: System<any>): InspectState {
	const inspection = system.inspect();
	return {
		isSettled: system.isSettled,
		unmet: inspection.unmet,
		inflight: inspection.inflight,
		isWorking: inspection.unmet.length > 0 || inspection.inflight.length > 0,
		hasUnmet: inspection.unmet.length > 0,
		hasInflight: inspection.inflight.length > 0,
	};
}

// ============================================================================
// Throttled Hook Options
// ============================================================================

/**
 * Options for throttled hooks.
 * Used by useInspectThrottled, useRequirementsThrottled, etc.
 */
export interface ThrottledHookOptions {
	/**
	 * Minimum time between updates in milliseconds.
	 * @default 100
	 */
	throttleMs?: number;
}

// ============================================================================
// Throttle Utility
// ============================================================================

/**
 * Create a throttled version of a callback function.
 * Uses trailing-edge throttling: the callback will be called at most once per interval,
 * with the latest arguments from the most recent call.
 *
 * @param callback - The function to throttle
 * @param ms - The minimum time between calls in milliseconds
 * @returns A throttled version of the callback and a cleanup function
 * @internal
 */
export function createThrottle<T extends (...args: unknown[]) => void>(
	callback: T,
	ms: number,
): { throttled: T; cleanup: () => void } {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;
	let lastArgs: Parameters<T> | null = null;
	let lastCallTime = 0;

	const throttled = ((...args: Parameters<T>) => {
		const now = Date.now();
		const timeSinceLastCall = now - lastCallTime;

		if (timeSinceLastCall >= ms) {
			// Enough time has passed, call immediately
			lastCallTime = now;
			callback(...args);
		} else {
			// Schedule for later, keeping latest args
			lastArgs = args;
			if (!timeoutId) {
				timeoutId = setTimeout(() => {
					timeoutId = null;
					lastCallTime = Date.now();
					if (lastArgs) {
						callback(...lastArgs);
						lastArgs = null;
					}
				}, ms - timeSinceLastCall);
			}
		}
	}) as T;

	const cleanup = () => {
		if (timeoutId) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
		lastArgs = null;
	};

	return { throttled, cleanup };
}

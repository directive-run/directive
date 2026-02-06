/**
 * Circuit Breaker for AI Agent Operations
 *
 * Implements the circuit breaker pattern to prevent cascading failures when
 * downstream services (MCP servers, LLM APIs) are degraded. Integrates with
 * the observability plugin to wire error rates into constraint decisions.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Failures exceeded threshold, requests are rejected immediately
 * - HALF_OPEN: After recovery timeout, a limited number of requests are allowed through
 *
 * @example
 * ```typescript
 * import { createCircuitBreaker } from 'directive/openai-agents';
 *
 * const breaker = createCircuitBreaker({
 *   failureThreshold: 5,
 *   recoveryTimeMs: 30000,
 *   halfOpenMaxRequests: 3,
 * });
 *
 * // Use with MCP or any async operation
 * const result = await breaker.execute(async () => {
 *   return await callExternalAPI();
 * });
 *
 * // Wire into Directive constraints
 * constraints: {
 *   apiDown: {
 *     when: () => breaker.getState() === 'OPEN',
 *     require: { type: 'FALLBACK_RESPONSE' },
 *   },
 * }
 * ```
 */

import type { ObservabilityInstance } from "./observability.js";

// ============================================================================
// Types
// ============================================================================

/** Circuit breaker states */
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
	/** Number of failures before opening the circuit (default: 5) */
	failureThreshold?: number;
	/** Time in ms before transitioning from OPEN to HALF_OPEN (default: 30000) */
	recoveryTimeMs?: number;
	/** Number of requests allowed in HALF_OPEN state (default: 3) */
	halfOpenMaxRequests?: number;
	/** Time window in ms for counting failures (default: 60000). Failures outside this window are forgotten. */
	failureWindowMs?: number;
	/** Optional observability instance for automatic metric tracking */
	observability?: ObservabilityInstance;
	/** Metric name prefix for observability (default: "circuit_breaker") */
	metricPrefix?: string;
	/** Name for this circuit breaker (used in metrics and errors) */
	name?: string;
	/** Custom error classifier. Return true if the error should count as a failure. Default: all errors count. */
	isFailure?: (error: Error) => boolean;
	/** Callback when state changes */
	onStateChange?: (from: CircuitState, to: CircuitState) => void;
}

/** Circuit breaker statistics */
export interface CircuitBreakerStats {
	state: CircuitState;
	totalRequests: number;
	totalFailures: number;
	totalSuccesses: number;
	totalRejected: number;
	recentFailures: number;
	lastFailureTime: number | null;
	lastSuccessTime: number | null;
	lastStateChange: number;
}

/** Circuit breaker instance */
export interface CircuitBreaker {
	/** Execute an operation through the circuit breaker */
	execute<T>(fn: () => Promise<T>): Promise<T>;
	/** Get the current state */
	getState(): CircuitState;
	/** Get statistics */
	getStats(): CircuitBreakerStats;
	/** Force the circuit to a specific state (useful for testing) */
	forceState(state: CircuitState): void;
	/** Reset the circuit breaker to CLOSED with cleared stats */
	reset(): void;
	/** Check if a request would be allowed (without executing) */
	isAllowed(): boolean;
}

// ============================================================================
// Errors
// ============================================================================

/** Error thrown when a request is rejected because the circuit is open */
export class CircuitBreakerOpenError extends Error {
	readonly code = "CIRCUIT_OPEN" as const;
	readonly retryAfterMs: number;
	readonly state: "OPEN" | "HALF_OPEN";

	constructor(name: string, retryAfterMs: number, state: "OPEN" | "HALF_OPEN" = "OPEN", detail?: string) {
		const msg = detail
			? `[Directive CircuitBreaker] Circuit "${name}" is ${state}. ${detail}`
			: `[Directive CircuitBreaker] Circuit "${name}" is ${state}. Request rejected. Try again in ${Math.ceil(retryAfterMs / 1000)}s.`;
		super(msg);
		this.name = "CircuitBreakerOpenError";
		this.retryAfterMs = retryAfterMs;
		this.state = state;
	}
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a circuit breaker for protecting against cascading failures.
 *
 * @example
 * ```typescript
 * const breaker = createCircuitBreaker({
 *   name: 'openai-api',
 *   failureThreshold: 5,
 *   recoveryTimeMs: 30000,
 *   observability: obs, // Optional: auto-track metrics
 * });
 *
 * try {
 *   const result = await breaker.execute(async () => {
 *     return await openai.chat.completions.create({ ... });
 *   });
 * } catch (error) {
 *   if (error.message.includes('Circuit breaker')) {
 *     // Circuit is open, use fallback
 *   }
 * }
 * ```
 *
 * @throws {Error} If failureThreshold is less than 1 or not a finite number
 * @throws {Error} If recoveryTimeMs is not positive or not a finite number
 * @throws {Error} If halfOpenMaxRequests is less than 1 or not a finite number
 * @throws {Error} If failureWindowMs is not positive or not a finite number
 */
export function createCircuitBreaker(config: CircuitBreakerConfig = {}): CircuitBreaker {
	const {
		failureThreshold = 5,
		recoveryTimeMs = 30000,
		halfOpenMaxRequests = 3,
		failureWindowMs = 60000,
		observability,
		metricPrefix = "circuit_breaker",
		name = "default",
		isFailure = () => true,
		onStateChange,
	} = config;

	// Validate config
	if (failureThreshold < 1 || !Number.isFinite(failureThreshold)) {
		throw new Error(`[Directive CircuitBreaker] failureThreshold must be >= 1, got ${failureThreshold}`);
	}
	if (recoveryTimeMs <= 0 || !Number.isFinite(recoveryTimeMs)) {
		throw new Error(`[Directive CircuitBreaker] recoveryTimeMs must be > 0, got ${recoveryTimeMs}`);
	}
	if (halfOpenMaxRequests < 1 || !Number.isFinite(halfOpenMaxRequests)) {
		throw new Error(`[Directive CircuitBreaker] halfOpenMaxRequests must be >= 1, got ${halfOpenMaxRequests}`);
	}
	if (failureWindowMs <= 0 || !Number.isFinite(failureWindowMs)) {
		throw new Error(`[Directive CircuitBreaker] failureWindowMs must be > 0, got ${failureWindowMs}`);
	}

	let state: CircuitState = "CLOSED";
	let failureTimestamps: number[] = [];
	let halfOpenRequests = 0;
	let halfOpenSuccesses = 0;
	let lastStateChange = Date.now();
	let openedAt = 0;

	// Stats
	let totalRequests = 0;
	let totalFailures = 0;
	let totalSuccesses = 0;
	let totalRejected = 0;
	let lastFailureTime: number | null = null;
	let lastSuccessTime: number | null = null;

	function transition(newState: CircuitState): void {
		if (state === newState) return;
		const oldState = state;
		state = newState;
		lastStateChange = Date.now();

		if (newState === "OPEN") {
			openedAt = Date.now();
		}
		if (newState === "HALF_OPEN") {
			halfOpenRequests = 0;
			halfOpenSuccesses = 0;
		}

		onStateChange?.(oldState, newState);

		if (observability) {
			observability.incrementCounter(`${metricPrefix}.state_change`, {
				name,
				from: oldState,
				to: newState,
			});
		}
	}

	function getRecentFailures(): number {
		const cutoff = Date.now() - failureWindowMs;
		failureTimestamps = failureTimestamps.filter((t) => t > cutoff);
		return failureTimestamps.length;
	}

	function recordSuccess(): void {
		totalSuccesses++;
		lastSuccessTime = Date.now();

		if (observability) {
			observability.incrementCounter(`${metricPrefix}.success`, { name });
		}

		if (state === "HALF_OPEN") {
			halfOpenSuccesses++;
			if (halfOpenSuccesses >= halfOpenMaxRequests) {
				transition("CLOSED");
				failureTimestamps = [];
			}
		}
	}

	function recordFailure(error: Error): void {
		if (!isFailure(error)) {
			recordSuccess();
			return;
		}

		totalFailures++;
		lastFailureTime = Date.now();
		failureTimestamps.push(Date.now());

		// Cap array to prevent unbounded growth (keep 2x threshold as headroom)
		const maxTimestamps = failureThreshold * 2;
		if (failureTimestamps.length > maxTimestamps) {
			failureTimestamps = failureTimestamps.slice(-maxTimestamps);
		}

		if (observability) {
			observability.incrementCounter(`${metricPrefix}.failure`, { name });
		}

		if (state === "HALF_OPEN") {
			transition("OPEN");
			return;
		}

		if (state === "CLOSED" && getRecentFailures() >= failureThreshold) {
			transition("OPEN");
		}
	}

	return {
		async execute<T>(fn: () => Promise<T>): Promise<T> {
			totalRequests++;

			if (observability) {
				observability.incrementCounter(`${metricPrefix}.requests`, { name });
			}

			// Check if request should be allowed
			if (state === "OPEN") {
				// Check if recovery time has elapsed
				if (Date.now() - openedAt >= recoveryTimeMs) {
					transition("HALF_OPEN");
				} else {
					totalRejected++;
					if (observability) {
						observability.incrementCounter(`${metricPrefix}.rejected`, { name });
					}
					throw new CircuitBreakerOpenError(name, recoveryTimeMs - (Date.now() - openedAt));
				}
			}

			if (state === "HALF_OPEN") {
				if (halfOpenRequests >= halfOpenMaxRequests) {
					totalRejected++;
					throw new CircuitBreakerOpenError(name, recoveryTimeMs, "HALF_OPEN", `Max trial requests (${halfOpenMaxRequests}) reached.`);
				}
				halfOpenRequests++;
			}

			// Execute the operation
			const start = Date.now();
			try {
				const result = await fn();
				recordSuccess();

				if (observability) {
					observability.observeHistogram(`${metricPrefix}.latency`, Date.now() - start, { name });
				}

				return result;
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				recordFailure(err);

				if (observability) {
					observability.observeHistogram(`${metricPrefix}.latency`, Date.now() - start, { name });
				}

				throw error;
			}
		},

		getState(): CircuitState {
			// Auto-transition from OPEN to HALF_OPEN when recovery time has passed
			if (state === "OPEN" && Date.now() - openedAt >= recoveryTimeMs) {
				transition("HALF_OPEN");
			}
			return state;
		},

		getStats(): CircuitBreakerStats {
			// Ensure state freshness (auto-transition OPEN → HALF_OPEN)
			const currentState = this.getState();
			return {
				state: currentState,
				totalRequests,
				totalFailures,
				totalSuccesses,
				totalRejected,
				recentFailures: getRecentFailures(),
				lastFailureTime,
				lastSuccessTime,
				lastStateChange,
			};
		},

		forceState(newState: CircuitState): void {
			transition(newState);
		},

		reset(): void {
			const oldState = state;
			state = "CLOSED";
			failureTimestamps = [];
			halfOpenRequests = 0;
			halfOpenSuccesses = 0;
			lastStateChange = Date.now();
			openedAt = 0;
			totalRequests = 0;
			totalFailures = 0;
			totalSuccesses = 0;
			totalRejected = 0;
			lastFailureTime = null;
			lastSuccessTime = null;
			if (oldState !== "CLOSED") {
				onStateChange?.(oldState, "CLOSED");
			}
		},

		isAllowed(): boolean {
			if (state === "CLOSED") return true;
			if (state === "OPEN") {
				return Date.now() - openedAt >= recoveryTimeMs;
			}
			// HALF_OPEN
			return halfOpenRequests < halfOpenMaxRequests;
		},
	};
}

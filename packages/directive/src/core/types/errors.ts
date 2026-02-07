/**
 * Error Types - Type definitions for error handling
 */

// ============================================================================
// Error Types
// ============================================================================

/** Error source types */
export type ErrorSource = "constraint" | "resolver" | "effect" | "derivation" | "system";

/** Directive error class */
export class DirectiveError extends Error {
	constructor(
		message: string,
		public readonly source: ErrorSource,
		public readonly sourceId: string,
		public readonly context?: unknown,
		public readonly recoverable: boolean = true,
	) {
		super(message);
		this.name = "DirectiveError";
	}
}

/** Recovery strategy for errors */
export type RecoveryStrategy = "skip" | "retry" | "retry-later" | "disable" | "throw";

/**
 * Configuration for retry-later strategy.
 * When an error occurs, the system will wait for `delayMs` before retrying.
 */
export interface RetryLaterConfig {
	/** Delay in milliseconds before retrying (default: 1000) */
	delayMs?: number;
	/** Maximum retries before giving up (default: 3) */
	maxRetries?: number;
	/** Backoff multiplier for each retry (default: 2) */
	backoffMultiplier?: number;
	/** Maximum delay in milliseconds (default: 30000) */
	maxDelayMs?: number;
}

/**
 * Circuit breaker configuration for automatic failure protection.
 * After `failureThreshold` consecutive failures, the circuit opens
 * and all requests fail fast for `resetTimeoutMs`.
 */
export interface CircuitBreakerConfig {
	/** Number of consecutive failures before opening the circuit (default: 5) */
	failureThreshold?: number;
	/** Time in milliseconds before attempting to close the circuit (default: 60000) */
	resetTimeoutMs?: number;
	/** Number of successful requests needed to close a half-open circuit (default: 1) */
	successThreshold?: number;
}

/** Circuit breaker state */
export type CircuitBreakerState = "closed" | "open" | "half-open";

/** Error boundary configuration */
export interface ErrorBoundaryConfig {
	onConstraintError?: RecoveryStrategy | ((error: Error, constraint: string) => void);
	onResolverError?: RecoveryStrategy | ((error: Error, resolver: string) => void);
	onEffectError?: RecoveryStrategy | ((error: Error, effect: string) => void);
	onDerivationError?: RecoveryStrategy | ((error: Error, derivation: string) => void);
	onError?: (error: DirectiveError) => void;

	/** Configuration for retry-later strategy */
	retryLater?: RetryLaterConfig;

	/** Circuit breaker configuration (applies to resolvers only) */
	circuitBreaker?: CircuitBreakerConfig;
}

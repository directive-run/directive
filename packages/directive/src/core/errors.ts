/**
 * Error Boundaries - Configurable error handling and recovery
 *
 * Features:
 * - Catch errors in constraints/resolvers/effects/derivations
 * - Configurable recovery strategies (skip, retry, retry-later, disable, throw)
 * - Circuit breaker pattern for automatic failure protection
 * - Error reporting to plugins
 */

import {
	DirectiveError,
	type ErrorBoundaryConfig,
	type ErrorSource,
	type RecoveryStrategy,
	type RetryLaterConfig,
} from "./types.js";

// ============================================================================
// Retry-Later Queue
// ============================================================================

/**
 * Pending retry entry.
 */
export interface PendingRetry {
	source: ErrorSource;
	sourceId: string;
	context: unknown;
	attempt: number;
	nextRetryTime: number;
	callback?: () => void;
}

/**
 * Create a retry-later manager.
 */
export function createRetryLaterManager(config: RetryLaterConfig = {}): {
	/** Schedule a retry */
	scheduleRetry: (
		source: ErrorSource,
		sourceId: string,
		context: unknown,
		attempt: number,
		callback?: () => void,
	) => PendingRetry | null;
	/** Get pending retries */
	getPendingRetries: () => PendingRetry[];
	/** Process due retries */
	processDueRetries: () => PendingRetry[];
	/** Cancel a retry */
	cancelRetry: (sourceId: string) => void;
	/** Clear all pending retries */
	clearAll: () => void;
} {
	const {
		delayMs = 1000,
		maxRetries = 3,
		backoffMultiplier = 2,
		maxDelayMs = 30000,
	} = config;

	const pendingRetries: Map<string, PendingRetry> = new Map();

	function calculateDelay(attempt: number): number {
		const delay = delayMs * Math.pow(backoffMultiplier, attempt - 1);
		return Math.min(delay, maxDelayMs);
	}

	return {
		scheduleRetry(
			source: ErrorSource,
			sourceId: string,
			context: unknown,
			attempt: number,
			callback?: () => void,
		): PendingRetry | null {
			// Check if max retries exceeded
			if (attempt > maxRetries) {
				return null;
			}

			const delay = calculateDelay(attempt);
			const entry: PendingRetry = {
				source,
				sourceId,
				context,
				attempt,
				nextRetryTime: Date.now() + delay,
				callback,
			};

			pendingRetries.set(sourceId, entry);
			return entry;
		},

		getPendingRetries(): PendingRetry[] {
			return Array.from(pendingRetries.values());
		},

		processDueRetries(): PendingRetry[] {
			const now = Date.now();
			const dueRetries: PendingRetry[] = [];

			for (const [sourceId, entry] of pendingRetries) {
				if (entry.nextRetryTime <= now) {
					dueRetries.push(entry);
					pendingRetries.delete(sourceId);
				}
			}

			return dueRetries;
		},

		cancelRetry(sourceId: string): void {
			pendingRetries.delete(sourceId);
		},

		clearAll(): void {
			pendingRetries.clear();
		},
	};
}

// ============================================================================
// Error Boundary Manager
// ============================================================================

export interface ErrorBoundaryManager {
	/** Handle an error from a specific source */
	handleError(source: ErrorSource, sourceId: string, error: unknown, context?: unknown): RecoveryStrategy;
	/** Get the last error */
	getLastError(): DirectiveError | null;
	/** Get all errors */
	getAllErrors(): DirectiveError[];
	/** Clear all errors */
	clearErrors(): void;
	/** Get retry-later manager */
	getRetryLaterManager(): ReturnType<typeof createRetryLaterManager>;
	/** Process due retries (call periodically or on reconcile) */
	processDueRetries(): PendingRetry[];
	/** Clear retry attempts for a source ID (call on success) */
	clearRetryAttempts(sourceId: string): void;
}

/** Options for creating an error boundary manager */
export interface CreateErrorBoundaryOptions {
	config?: ErrorBoundaryConfig;
	/** Callback when an error occurs */
	onError?: (error: DirectiveError) => void;
	/** Callback when recovery is attempted */
	onRecovery?: (error: DirectiveError, strategy: RecoveryStrategy) => void;
}

/** Default recovery strategies by source */
const DEFAULT_STRATEGIES: Record<ErrorSource, RecoveryStrategy> = {
	constraint: "skip",
	resolver: "skip",
	effect: "skip",
	derivation: "skip",
	system: "throw",
};

/**
 * Create an error boundary manager.
 */
export function createErrorBoundaryManager(
	options: CreateErrorBoundaryOptions = {},
): ErrorBoundaryManager {
	const { config = {}, onError, onRecovery } = options;

	// Store errors for inspection
	const errors: DirectiveError[] = [];
	const maxErrors = 100; // Keep last 100 errors

	// Retry-later manager
	const retryLaterManager = createRetryLaterManager(config.retryLater);

	// Track retry attempts per source ID
	const retryAttempts = new Map<string, number>();

	/** Convert unknown error to DirectiveError */
	function toDirectiveError(
		source: ErrorSource,
		sourceId: string,
		error: unknown,
		context?: unknown,
	): DirectiveError {
		if (error instanceof DirectiveError) {
			return error;
		}

		const message = error instanceof Error ? error.message : String(error);
		const recoverable = source !== "system";

		return new DirectiveError(message, source, sourceId, context, recoverable);
	}

	/** Get recovery strategy for a source */
	function getStrategy(source: ErrorSource, sourceId: string, error: Error): RecoveryStrategy {
		// Get configured handler
		const handler = (() => {
			switch (source) {
				case "constraint":
					return config.onConstraintError;
				case "resolver":
					return config.onResolverError;
				case "effect":
					return config.onEffectError;
				case "derivation":
					return config.onDerivationError;
				default:
					return undefined;
			}
		})();

		// If handler is a function, call it and return skip
		if (typeof handler === "function") {
			try {
				handler(error, sourceId);
			} catch (e) {
				console.error("[Directive] Error in error handler callback:", e);
			}
			return "skip";
		}

		// If handler is a strategy string, return it
		if (typeof handler === "string") {
			return handler;
		}

		// Return default strategy
		return DEFAULT_STRATEGIES[source];
	}

	const manager: ErrorBoundaryManager = {
		handleError(
			source: ErrorSource,
			sourceId: string,
			error: unknown,
			context?: unknown,
		): RecoveryStrategy {
			const directiveError = toDirectiveError(source, sourceId, error, context);

			// Store error
			errors.push(directiveError);
			if (errors.length > maxErrors) {
				errors.shift();
			}

			// Notify callbacks (wrapped to prevent bypassing recovery)
			try { onError?.(directiveError); } catch (e) { console.error("[Directive] Error in onError callback:", e); }
			try { config.onError?.(directiveError); } catch (e) { console.error("[Directive] Error in config.onError callback:", e); }

			// Get recovery strategy
			let strategy = getStrategy(
				source,
				sourceId,
				error instanceof Error ? error : new Error(String(error)),
			);

			// Handle retry-later strategy
			if (strategy === "retry-later") {
				const attempt = (retryAttempts.get(sourceId) ?? 0) + 1;
				retryAttempts.set(sourceId, attempt);

				const scheduled = retryLaterManager.scheduleRetry(
					source,
					sourceId,
					context,
					attempt,
				);

				if (!scheduled) {
					// Max retries exceeded, fall back to skip
					strategy = "skip";
					retryAttempts.delete(sourceId);

					if (process.env.NODE_ENV !== "production") {
						console.warn(
							`[Directive] ${source} "${sourceId}" exceeded max retry-later attempts. Skipping.`,
						);
					}
				}
			}

			// Notify recovery callback
			try { onRecovery?.(directiveError, strategy); } catch (e) { console.error("[Directive] Error in onRecovery callback:", e); }

			// If strategy is throw, re-throw the error
			if (strategy === "throw") {
				throw directiveError;
			}

			return strategy;
		},

		getLastError(): DirectiveError | null {
			return errors[errors.length - 1] ?? null;
		},

		getAllErrors(): DirectiveError[] {
			return [...errors];
		},

		clearErrors(): void {
			errors.length = 0;
		},

		getRetryLaterManager() {
			return retryLaterManager;
		},

		processDueRetries(): PendingRetry[] {
			return retryLaterManager.processDueRetries();
		},

		clearRetryAttempts(sourceId: string): void {
			retryAttempts.delete(sourceId);
			retryLaterManager.cancelRetry(sourceId);
		},
	};

	return manager;
}

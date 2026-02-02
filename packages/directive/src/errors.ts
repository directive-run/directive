/**
 * Error Boundaries - Configurable error handling and recovery
 *
 * Features:
 * - Catch errors in constraints/resolvers/effects/derivations
 * - Configurable recovery strategies
 * - Error reporting to plugins
 */

import { DirectiveError, type ErrorBoundaryConfig, type ErrorSource, type RecoveryStrategy } from "./types.js";

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
			handler(error, sourceId);
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

			// Notify callback
			onError?.(directiveError);
			config.onError?.(directiveError);

			// Get recovery strategy
			const strategy = getStrategy(
				source,
				sourceId,
				error instanceof Error ? error : new Error(String(error)),
			);

			// Notify recovery callback
			onRecovery?.(directiveError, strategy);

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
	};

	return manager;
}

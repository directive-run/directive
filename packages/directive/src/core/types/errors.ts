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
export type RecoveryStrategy = "skip" | "retry" | "disable" | "throw";

/** Error boundary configuration */
export interface ErrorBoundaryConfig {
	onConstraintError?: RecoveryStrategy | ((error: Error, constraint: string) => void);
	onResolverError?: RecoveryStrategy | ((error: Error, resolver: string) => void);
	onEffectError?: RecoveryStrategy | ((error: Error, effect: string) => void);
	onDerivationError?: RecoveryStrategy | ((error: Error, derivation: string) => void);
	onError?: (error: DirectiveError) => void;
}

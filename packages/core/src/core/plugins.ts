/**
 * Plugin Architecture - Extensible middleware for Directive
 *
 * Features:
 * - Lifecycle hooks for all engine events
 * - Multiple plugins can be composed
 * - Plugins execute in registration order
 */

import type {
	FactChange,
	FactsSnapshot,
	Plugin,
	ReconcileResult,
	RecoveryStrategy,
	RequirementWithId,
	Schema,
	Snapshot,
	System,
} from "./types.js";
import { DirectiveError } from "./types.js";

// ============================================================================
// Plugin Manager
// ============================================================================

// Note: PluginManager uses Schema (flat) internally because the engine works with flat schemas.
// The public API uses ModuleSchema (consolidated), and the conversion happens in createSystem.
// biome-ignore lint/suspicious/noExplicitAny: Internal type - plugins are schema-agnostic at runtime
export interface PluginManager<_S extends Schema = any> {
	/** Register a plugin */
	// biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
	register(plugin: Plugin<any>): void;
	/** Unregister a plugin by name */
	unregister(name: string): void;
	/** Get all registered plugins */
	// biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
	getPlugins(): Plugin<any>[];

	// Lifecycle hooks
	// biome-ignore lint/suspicious/noExplicitAny: System type varies between internal/public API
	emitInit(system: System<any>): Promise<void>;
	// biome-ignore lint/suspicious/noExplicitAny: System type varies between internal/public API
	emitStart(system: System<any>): void;
	// biome-ignore lint/suspicious/noExplicitAny: System type varies between internal/public API
	emitStop(system: System<any>): void;
	// biome-ignore lint/suspicious/noExplicitAny: System type varies between internal/public API
	emitDestroy(system: System<any>): void;

	// Fact hooks
	emitFactSet(key: string, value: unknown, prev: unknown): void;
	emitFactDelete(key: string, prev: unknown): void;
	emitFactsBatch(changes: FactChange[]): void;

	// Derivation hooks
	emitDerivationCompute(id: string, value: unknown, deps: string[]): void;
	emitDerivationInvalidate(id: string): void;

	// Reconciliation hooks
	// biome-ignore lint/suspicious/noExplicitAny: Schema type varies
	emitReconcileStart(snapshot: FactsSnapshot<any>): void;
	emitReconcileEnd(result: ReconcileResult): void;

	// Constraint hooks
	emitConstraintEvaluate(id: string, active: boolean): void;
	emitConstraintError(id: string, error: unknown): void;

	// Requirement hooks
	emitRequirementCreated(req: RequirementWithId): void;
	emitRequirementMet(req: RequirementWithId, byResolver: string): void;
	emitRequirementCanceled(req: RequirementWithId): void;

	// Resolver hooks
	emitResolverStart(resolver: string, req: RequirementWithId): void;
	emitResolverComplete(resolver: string, req: RequirementWithId, duration: number): void;
	emitResolverError(resolver: string, req: RequirementWithId, error: unknown): void;
	emitResolverRetry(resolver: string, req: RequirementWithId, attempt: number): void;
	emitResolverCancel(resolver: string, req: RequirementWithId): void;

	// Effect hooks
	emitEffectRun(id: string): void;
	emitEffectError(id: string, error: unknown): void;

	// Time-travel hooks
	emitSnapshot(snapshot: Snapshot): void;
	emitTimeTravel(from: number, to: number): void;

	// Error boundary hooks
	emitError(error: DirectiveError): void;
	emitErrorRecovery(error: DirectiveError, strategy: RecoveryStrategy): void;
}

/**
 * Create a manager that broadcasts lifecycle events to registered plugins.
 *
 * Plugins are called in registration order. All hook invocations are
 * wrapped in try-catch so a misbehaving plugin never breaks the engine.
 * Duplicate plugin names are detected and the older registration is
 * replaced with a warning.
 *
 * @returns A `PluginManager` with register/unregister/getPlugins and emit* methods for every lifecycle event
 */
// biome-ignore lint/suspicious/noExplicitAny: Internal - schema type varies
export function createPluginManager<S extends Schema = any>(): PluginManager<S> {
	// biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
	const plugins: Plugin<any>[] = [];

	/** Safe call - wraps plugin hook calls to prevent errors from breaking the system */
	function safeCall<T>(fn: (() => T) | undefined): T | undefined {
		if (!fn) return undefined;
		try {
			return fn();
		} catch (error) {
			console.error("[Directive] Plugin error:", error);
			return undefined;
		}
	}

	/** Safe async call */
	async function safeCallAsync<T>(fn: (() => Promise<T>) | undefined): Promise<T | undefined> {
		if (!fn) return undefined;
		try {
			return await fn();
		} catch (error) {
			console.error("[Directive] Plugin error:", error);
			return undefined;
		}
	}

	const manager: PluginManager<S> = {
		// biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
		register(plugin: Plugin<any>): void {
			// Check for duplicate names
			if (plugins.some((p) => p.name === plugin.name)) {
				console.warn(`[Directive] Plugin "${plugin.name}" is already registered, replacing...`);
				this.unregister(plugin.name);
			}
			plugins.push(plugin);
		},

		unregister(name: string): void {
			const index = plugins.findIndex((p) => p.name === name);
			if (index !== -1) {
				plugins.splice(index, 1);
			}
		},

		// biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
		getPlugins(): Plugin<any>[] {
			return [...plugins];
		},

		// Lifecycle hooks
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		async emitInit(system: System<any>): Promise<void> {
			for (const plugin of plugins) {
				await safeCallAsync(() => plugin.onInit?.(system) as Promise<void>);
			}
		},

		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		emitStart(system: System<any>): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onStart?.(system));
			}
		},

		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		emitStop(system: System<any>): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onStop?.(system));
			}
		},

		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		emitDestroy(system: System<any>): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onDestroy?.(system));
			}
		},

		// Fact hooks
		emitFactSet(key: string, value: unknown, prev: unknown): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onFactSet?.(key, value, prev));
			}
		},

		emitFactDelete(key: string, prev: unknown): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onFactDelete?.(key, prev));
			}
		},

		emitFactsBatch(changes: FactChange[]): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onFactsBatch?.(changes));
			}
		},

		// Derivation hooks
		emitDerivationCompute(id: string, value: unknown, deps: string[]): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onDerivationCompute?.(id, value, deps));
			}
		},

		emitDerivationInvalidate(id: string): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onDerivationInvalidate?.(id));
			}
		},

		// Reconciliation hooks
		// biome-ignore lint/suspicious/noExplicitAny: Schema type varies
		emitReconcileStart(snapshot: FactsSnapshot<any>): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onReconcileStart?.(snapshot));
			}
		},

		emitReconcileEnd(result: ReconcileResult): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onReconcileEnd?.(result));
			}
		},

		// Constraint hooks
		emitConstraintEvaluate(id: string, active: boolean): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onConstraintEvaluate?.(id, active));
			}
		},

		emitConstraintError(id: string, error: unknown): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onConstraintError?.(id, error));
			}
		},

		// Requirement hooks
		emitRequirementCreated(req: RequirementWithId): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onRequirementCreated?.(req));
			}
		},

		emitRequirementMet(req: RequirementWithId, byResolver: string): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onRequirementMet?.(req, byResolver));
			}
		},

		emitRequirementCanceled(req: RequirementWithId): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onRequirementCanceled?.(req));
			}
		},

		// Resolver hooks
		emitResolverStart(resolver: string, req: RequirementWithId): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onResolverStart?.(resolver, req));
			}
		},

		emitResolverComplete(resolver: string, req: RequirementWithId, duration: number): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onResolverComplete?.(resolver, req, duration));
			}
		},

		emitResolverError(resolver: string, req: RequirementWithId, error: unknown): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onResolverError?.(resolver, req, error));
			}
		},

		emitResolverRetry(resolver: string, req: RequirementWithId, attempt: number): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onResolverRetry?.(resolver, req, attempt));
			}
		},

		emitResolverCancel(resolver: string, req: RequirementWithId): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onResolverCancel?.(resolver, req));
			}
		},

		// Effect hooks
		emitEffectRun(id: string): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onEffectRun?.(id));
			}
		},

		emitEffectError(id: string, error: unknown): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onEffectError?.(id, error));
			}
		},

		// Time-travel hooks
		emitSnapshot(snapshot: Snapshot): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onSnapshot?.(snapshot));
			}
		},

		emitTimeTravel(from: number, to: number): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onTimeTravel?.(from, to));
			}
		},

		// Error boundary hooks
		emitError(error: DirectiveError): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onError?.(error));
			}
		},

		emitErrorRecovery(error: DirectiveError, strategy: RecoveryStrategy): void {
			for (const plugin of plugins) {
				safeCall(() => plugin.onErrorRecovery?.(error, strategy));
			}
		},
	};

	return manager;
}

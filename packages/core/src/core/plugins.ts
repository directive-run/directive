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
  TraceEntry,
} from "./types.js";
import type { DirectiveError } from "./types.js";

// ============================================================================
// Plugin Manager
// ============================================================================

/**
 * Internal manager that broadcasts lifecycle events to registered {@link Plugin} instances.
 *
 * @remarks
 * PluginManager uses `Schema` (flat) internally because the engine works with
 * flat schemas. The public API uses `ModuleSchema` (consolidated), and the
 * conversion happens in `createSystem`.
 *
 * Plugins execute in registration order. All hook invocations are wrapped in
 * try-catch so a misbehaving plugin never breaks the engine. Duplicate plugin
 * names are detected and the older registration is replaced with a warning.
 *
 * Lifecycle hook categories:
 * - **System lifecycle:** `emitInit`, `emitStart`, `emitStop`, `emitDestroy`
 * - **Facts:** `emitFactSet`, `emitFactDelete`, `emitFactsBatch`
 * - **Derivations:** `emitDerivationCompute`, `emitDerivationInvalidate`
 * - **Reconciliation:** `emitReconcileStart`, `emitReconcileEnd`
 * - **Constraints:** `emitConstraintEvaluate`, `emitConstraintError`
 * - **Requirements:** `emitRequirementCreated`, `emitRequirementMet`, `emitRequirementCanceled`
 * - **Resolvers:** `emitResolverStart`, `emitResolverComplete`, `emitResolverError`, `emitResolverRetry`, `emitResolverCancel`
 * - **Effects:** `emitEffectRun`, `emitEffectError`
 * - **History:** `emitSnapshot`, `emitHistoryNavigate`
 * - **Errors:** `emitError`, `emitErrorRecovery`
 * - **Trace:** `emitTraceComplete`
 *
 * @typeParam _S - The flat schema type (unused at runtime).
 *
 * @internal
 */
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
  emitResolverComplete(
    resolver: string,
    req: RequirementWithId,
    duration: number,
  ): void;
  emitResolverError(
    resolver: string,
    req: RequirementWithId,
    error: unknown,
  ): void;
  emitResolverRetry(
    resolver: string,
    req: RequirementWithId,
    attempt: number,
  ): void;
  emitResolverCancel(resolver: string, req: RequirementWithId): void;

  // Effect hooks
  emitEffectRun(id: string): void;
  emitEffectError(id: string, error: unknown): void;

  // History hooks
  emitSnapshot(snapshot: Snapshot): void;
  emitHistoryNavigate(from: number, to: number): void;

  // Error boundary hooks
  emitError(error: DirectiveError): void;
  emitErrorRecovery(error: DirectiveError, strategy: RecoveryStrategy): void;

  // Dynamic definition hooks
  emitDefinitionRegister(type: string, id: string, def: unknown): void;
  emitDefinitionAssign(
    type: string,
    id: string,
    def: unknown,
    original: unknown,
  ): void;
  emitDefinitionUnregister(type: string, id: string): void;
  emitDefinitionCall(type: string, id: string, props?: unknown): void;

  // Trace hooks
  emitTraceComplete(run: TraceEntry): void;
}

/**
 * Create a {@link PluginManager} that broadcasts lifecycle events to registered plugins.
 *
 * @remarks
 * Plugins are called in registration order. All hook invocations are wrapped
 * in try-catch so a misbehaving plugin never breaks the engine. Duplicate
 * plugin names are detected and the older registration is replaced with a
 * console warning.
 *
 * @returns A {@link PluginManager} with `register`/`unregister`/`getPlugins` and `emit*` methods for every lifecycle event.
 *
 * @internal
 */
export function createPluginManager<
  // biome-ignore lint/suspicious/noExplicitAny: Internal - schema type varies
  S extends Schema = any,
>(): PluginManager<S> {
  // biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
  const plugins: Plugin<any>[] = [];

  /** Safe call - wraps plugin hook calls to prevent errors from breaking the system */
  function safeCall<T>(fn: (() => T) | undefined): T | undefined {
    if (!fn) {
      return undefined;
    }
    try {
      return fn();
    } catch (error) {
      console.error("[Directive] Plugin error:", error);
      return undefined;
    }
  }

  /** Safe async call */
  async function safeCallAsync<T>(
    fn: (() => Promise<T>) | undefined,
  ): Promise<T | undefined> {
    if (!fn) {
      return undefined;
    }
    try {
      return await fn();
    } catch (error) {
      console.error("[Directive] Plugin error:", error);
      return undefined;
    }
  }

  /** Create a sync broadcast function for a given plugin hook name */
  // biome-ignore lint/suspicious/noExplicitAny: Plugin hook signatures vary
  function broadcast<K extends keyof Plugin<any>>(hook: K) {
    return (...args: unknown[]) => {
      if (plugins.length === 0) return;
      for (const plugin of plugins) {
        // biome-ignore lint/suspicious/noExplicitAny: Dynamic hook dispatch
        safeCall(() => (plugin as any)[hook]?.(...args));
      }
    };
  }

  const manager: PluginManager<S> = {
    // biome-ignore lint/suspicious/noExplicitAny: Plugins work with any schema
    register(plugin: Plugin<any>): void {
      // Check for duplicate names
      if (plugins.some((p) => p.name === plugin.name)) {
        console.warn(
          `[Directive] Plugin "${plugin.name}" is already registered, replacing...`,
        );
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

    // Lifecycle hooks (emitInit is async, handled separately)
    // biome-ignore lint/suspicious/noExplicitAny: System type varies
    async emitInit(system: System<any>): Promise<void> {
      for (const plugin of plugins) {
        await safeCallAsync(() => plugin.onInit?.(system) as Promise<void>);
      }
    },
    emitStart: broadcast("onStart"),
    emitStop: broadcast("onStop"),
    emitDestroy: broadcast("onDestroy"),

    // Fact hooks
    emitFactSet: broadcast("onFactSet"),
    emitFactDelete: broadcast("onFactDelete"),
    emitFactsBatch: broadcast("onFactsBatch"),

    // Derivation hooks
    emitDerivationCompute: broadcast("onDerivationCompute"),
    emitDerivationInvalidate: broadcast("onDerivationInvalidate"),

    // Reconciliation hooks
    emitReconcileStart: broadcast("onReconcileStart"),
    emitReconcileEnd: broadcast("onReconcileEnd"),

    // Constraint hooks
    emitConstraintEvaluate: broadcast("onConstraintEvaluate"),
    emitConstraintError: broadcast("onConstraintError"),

    // Requirement hooks
    emitRequirementCreated: broadcast("onRequirementCreated"),
    emitRequirementMet: broadcast("onRequirementMet"),
    emitRequirementCanceled: broadcast("onRequirementCanceled"),

    // Resolver hooks
    emitResolverStart: broadcast("onResolverStart"),
    emitResolverComplete: broadcast("onResolverComplete"),
    emitResolverError: broadcast("onResolverError"),
    emitResolverRetry: broadcast("onResolverRetry"),
    emitResolverCancel: broadcast("onResolverCancel"),

    // Effect hooks
    emitEffectRun: broadcast("onEffectRun"),
    emitEffectError: broadcast("onEffectError"),

    // History hooks
    emitSnapshot: broadcast("onSnapshot"),
    emitHistoryNavigate: broadcast("onHistoryNavigate"),

    // Error boundary hooks
    emitError: broadcast("onError"),
    emitErrorRecovery: broadcast("onErrorRecovery"),

    // Dynamic definition hooks
    emitDefinitionRegister: broadcast("onDefinitionRegister"),
    emitDefinitionAssign: broadcast("onDefinitionAssign"),
    emitDefinitionUnregister: broadcast("onDefinitionUnregister"),
    emitDefinitionCall: broadcast("onDefinitionCall"),

    // Trace hooks
    emitTraceComplete: broadcast("onTraceComplete"),
  } as PluginManager<S>;

  return manager;
}

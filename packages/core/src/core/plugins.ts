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
export interface PluginManager<_S extends Schema = any> {
  /** Register a plugin */
  register(plugin: Plugin<any>): void;
  /** Unregister a plugin by name */
  unregister(name: string): void;
  /** Get all registered plugins */
  getPlugins(): Plugin<any>[];

  // Lifecycle hooks
  emitInit(system: System<any>): Promise<void>;
  emitStart(system: System<any>): void;
  emitStop(system: System<any>): void;
  emitDestroy(system: System<any>): void;

  // Fact hooks
  emitFactSet(key: string, value: unknown, prev: unknown): void;
  emitFactDelete(key: string, prev: unknown): void;
  emitFactsBatch(changes: FactChange[]): void;

  // Derivation hooks
  emitDerivationCompute(id: string, value: unknown, deps: string[]): void;
  emitDerivationInvalidate(id: string): void;

  // Reconciliation hooks
  emitReconcileStart(snapshot: FactsSnapshot<any>): void;
  emitReconcileEnd(result: ReconcileResult): void;

  // Constraint hooks
  emitConstraintEvaluate(
    id: string,
    active: boolean,
    whenExplain?: import("./types/predicate.js").ClauseResult[],
  ): void;
  emitConstraintError(id: string, error: unknown): void;
  /**
   * Fired once per lookup when the engine silently disables a
   * constraint's `abortOn:` binding because the constraint is async.
   * Pairs with the dev-mode `console.warn` for SIEM visibility — without
   * this signal, a production constraint loses its clobber-protection
   * with no plugin trail.
   *
   * `"async-declared"` means the def has `async: true` (author opted in);
   * `"async-promoted"` means `when()` returned a Promise at runtime
   * (author probably did not realize).
   */
  emitConstraintBindingDisabled(
    id: string,
    reason: "async-declared" | "async-promoted",
  ): void;

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
  emitResolverWriteRejected(
    event:
      | {
          kind: "rejection";
          resolver: string;
          req: RequirementWithId;
          reason: "clobbered";
          fact: string;
          expected: unknown;
          actual: unknown;
        }
      | {
          kind: "summary";
          resolver: string;
          req: RequirementWithId;
          reason: "clobbered";
          dropped: number;
        },
  ): void;

  // Effect hooks
  emitEffectRun(id: string): void;
  emitEffectError(id: string, error: unknown): void;

  // Source hooks — inbound external event lifecycle (see SourceDef).
  // Mirrors the effect-shape so observation plugins (audit-ledger, devtools)
  // can route source events through the same dispatch fabric.
  emitSourceAttach(id: string, moduleId: string): void;
  emitSourcePublish(id: string, moduleId: string, eventName: string): void;
  /**
   * Engine- or manager-rejected publish. Mirrors `emitSourcePublish`
   * so observers can pair every accepted publish with the drop side
   * without polling `inspect().sources[i].dropCount`. `reason` matches
   * the value the inspect row records.
   */
  emitSourceDrop(
    id: string,
    moduleId: string,
    eventName: string,
    reason: import("./types/sources.js").SourceDropReason,
  ): void;
  emitSourceDetach(id: string, moduleId: string): void;
  emitSourceError(
    id: string,
    moduleId: string,
    phase: "attach" | "cleanup" | "runtime" | "gate",
    error: unknown,
  ): void;

  // Guardrail hooks (RFC 0010)
  emitGuardrailBlocked(
    plugin: string,
    key: string,
    kind: "redact" | "alert" | "detect",
    count: number,
    category?: string,
  ): void;
  emitGuardrailCoverage(
    plugin: string,
    screenedCount: number,
    screenedDigest: string,
    reason: "start" | "tags-changed" | "unanswerable",
  ): void;

  // Clobber loop hooks (v1.23.0)
  emitClobberLoopDetected(
    event: import("./types/system.js").ObservationEvent & {
      type: "resolver.clobber.loop.detected";
    },
  ): void;
  emitClobberLoopResolved(
    event: import("./types/system.js").ObservationEvent & {
      type: "resolver.clobber.loop.resolved";
    },
  ): void;

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
  /** RFC 0002: module-level topology change, for replay reconstruction. */
  emitModuleRegistered(id: string): void;
  emitModuleUnregistered(id: string): void;

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
  S extends Schema = any,
>(): PluginManager<S> {
  const plugins: Plugin<any>[] = [];

  /** Safe call - wraps plugin hook calls to prevent errors from breaking the system */
  function safeCall<T>(
    fn: (() => T) | undefined,
    pluginName?: string,
    hook?: string,
  ): T | undefined {
    if (!fn) {
      return undefined;
    }
    try {
      return fn();
    } catch (error) {
      console.error("[Directive] Plugin error:", {
        plugin: pluginName,
        hook,
        error,
      });
      return undefined;
    }
  }

  /** Safe async call */
  async function safeCallAsync<T>(
    fn: (() => Promise<T>) | undefined,
    pluginName?: string,
    hook?: string,
  ): Promise<T | undefined> {
    if (!fn) {
      return undefined;
    }
    try {
      return await fn();
    } catch (error) {
      console.error("[Directive] Plugin error:", {
        plugin: pluginName,
        hook,
        error,
      });
      return undefined;
    }
  }

  /** Create a sync broadcast function for a given plugin hook name */
  function broadcast<K extends keyof Plugin<any>>(hook: K) {
    return (...args: unknown[]) => {
      // — snapshot the plugins array BEFORE iterating so a
      // plugin's hook callback that calls `manager.unregister(...)`
      // (or whose `system.observe()` unsubscribe splices the array)
      // doesn't shift indices mid-broadcast. The previous live-array
      // iteration meant a malicious or buggy plugin could silently
      // skip the next plugin — typically the audit-ledger / fact-pii
      // guardrail — by self-unregistering at exactly the right hook.
      const snapshot = [...plugins];
      for (const plugin of snapshot) {
        safeCall(
          () => (plugin as any)[hook]?.(...args),
          plugin.name,
          hook as string,
        );
      }
    };
  }

  const manager: PluginManager<S> = {
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

    getPlugins(): Plugin<any>[] {
      return [...plugins];
    },

    // Lifecycle hooks (emitInit is async, handled separately)
    async emitInit(system: System<any>): Promise<void> {
      // track which plugins have already received `onInit` via a
      // WeakSet, then loop over the LIVE `plugins` array until quiet.
      // This handles two distinct concerns:
      //   1. Index-shift attack: a plugin's `onInit` that calls
      //      `manager.unregister(otherName)` between awaits used to
      //      shift indices on the live array and silently skip the
      //      next un-init'd plugin (typically `createFactPIIGuardrail`
      //      or the audit-ledger). The WeakSet ensures each plugin
      //      gets called at most once, regardless of array shifts.
      //   2. Cascading registration: plugins like `audit-ledger`'s
      //      `onInit` call `system.observe(...)` which registers a
      //      NEW observer plugin mid-init. The bridge between engine
      //      lifecycle events and audit-ledger entries depends on
      //      that observer's `onInit` firing for the same cycle. The
      //      loop-until-quiet shape captures cascaded registrations.
      const initialized = new WeakSet<Plugin<any>>();
      // Cap iterations to bound an adversarial register-loop scenario
      // (a plugin that registers another plugin in its onInit, and so
      // on). Typical cascade depth is 1-2; 100 is well past any real
      // pattern.
      for (let pass = 0; pass < 100; pass++) {
        const todo = plugins.filter((p) => !initialized.has(p));
        if (todo.length === 0) break;
        for (const plugin of todo) {
          initialized.add(plugin);
          // Time each onInit so a slow plugin is attributable in production
          // logs. We use `performance.now()` (cross-runtime in Node 18+ /
          // browsers / Bun / Deno / Workers) and only log when the cost is
          // non-trivial to keep dev console noise low.
          const startedAt =
            typeof performance !== "undefined" ? performance.now() : Date.now();
          await safeCallAsync(
            () =>
              (plugin.onInit?.(system) ?? Promise.resolve()) as Promise<void>,
            plugin.name,
            "onInit",
          );
          const elapsedMs =
            (typeof performance !== "undefined"
              ? performance.now()
              : Date.now()) - startedAt;
          if (elapsedMs > 100) {
            console.warn("[Directive] slow plugin onInit", {
              plugin: plugin.name,
              hook: "onInit",
              pass,
              durationMs: Math.round(elapsedMs),
            });
          }
        }
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
    emitConstraintBindingDisabled: broadcast("onConstraintBindingDisabled"),

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
    emitResolverWriteRejected: broadcast("onResolverWriteRejected"),

    // Effect hooks
    emitEffectRun: broadcast("onEffectRun"),
    emitEffectError: broadcast("onEffectError"),

    // Source hooks
    emitSourceAttach: broadcast("onSourceAttach"),
    emitSourcePublish: broadcast("onSourcePublish"),
    emitSourceDrop: broadcast("onSourceDrop"),
    emitSourceDetach: broadcast("onSourceDetach"),
    emitSourceError: broadcast("onSourceError"),

    // Guardrail hooks (RFC 0010)
    emitGuardrailBlocked: broadcast("onGuardrailBlocked"),
    emitGuardrailCoverage: broadcast("onGuardrailCoverage"),

    // Clobber loop hooks (v1.23.0)
    emitClobberLoopDetected: broadcast("onClobberLoopDetected"),
    emitClobberLoopResolved: broadcast("onClobberLoopResolved"),

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
    emitModuleRegistered: broadcast("onModuleRegistered"),
    emitModuleUnregistered: broadcast("onModuleUnregistered"),

    // Trace hooks
    emitTraceComplete: broadcast("onTraceComplete"),
  } as PluginManager<S>;

  return manager;
}

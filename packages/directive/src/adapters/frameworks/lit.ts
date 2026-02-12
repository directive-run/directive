/**
 * Lit Adapter - Consolidated Web Components integration for Directive
 *
 * Controllers: DerivedController, FactController,
 * InspectController (with throttle), RequirementStatusController,
 * DirectiveSelectorController,
 * WatchController (with fact mode), SystemController,
 * ExplainController, ConstraintStatusController, OptimisticUpdateController, ModuleController
 *
 * Factories: createDerived, createFact, createInspect,
 * createRequirementStatus, createWatch,
 * createDirectiveSelector, useDispatch, useEvents, useTimeTravel,
 * getDerived, getFact, createTypedHooks, shallowEqual
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import { createSystem } from "../../core/system.js";
import type {
	CreateSystemOptionsSingle,
	ModuleSchema,
	ModuleDef,
	Plugin,
	DebugConfig,
	ErrorBoundaryConfig,
	InferFacts,
	InferDerivations,
	InferEvents,
	SingleModuleSystem,
	SystemSnapshot,
} from "../../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../../utils/requirement-status.js";
import {
	type InspectState,
	type ConstraintInfo,
	type TrackedSelectorResult,
	computeInspectState,
	createThrottle,
	assertSystem,
	defaultEquality,
	buildTimeTravelState,
	runTrackedSelector,
	depsChanged,
} from "../shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, InspectState, ConstraintInfo };
export { shallowEqual } from "../../utils/utils.js";

/** Type for the requirement status plugin return value */
export type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

// ============================================================================
// Context
// ============================================================================

/**
 * Context key for Directive system.
 * Use with @lit/context for dependency injection across shadow DOM boundaries.
 */
export const directiveContext = Symbol("directive");

// ============================================================================
// Base Controller
// ============================================================================

/**
 * Base controller that manages system subscription lifecycle.
 */
abstract class DirectiveController implements ReactiveController {
	protected host: ReactiveControllerHost;
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	protected system: SingleModuleSystem<any>;
	protected unsubscribe?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: SingleModuleSystem<any>) {
		this.host = host;
		this.system = system;
		host.addController(this);
	}

	hostConnected(): void {
		this.subscribe();
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}

	protected abstract subscribe(): void;

	protected requestUpdate(): void {
		this.host.requestUpdate();
	}
}

// ============================================================================
// Core Controllers
// ============================================================================

/**
 * Reactive controller for derivations.
 * Accepts a single key (string) or an array of keys (string[]).
 * - Single key: `.value` returns `T`
 * - Array of keys: `.value` returns `Record<string, unknown>`
 */
export class DerivedController<T> extends DirectiveController {
	private keys: string[];
	private isMulti: boolean;
	value: T;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		key: string | string[],
	) {
		super(host, system);
		this.isMulti = Array.isArray(key);
		this.keys = this.isMulti ? (key as string[]) : [key as string];
		this.value = this.getValues();

		if (process.env.NODE_ENV !== "production") {
			if (!this.isMulti && this.value === undefined) {
				console.warn(
					`[Directive] DerivedController("${this.keys[0]}") returned undefined. ` +
					`Check that "${this.keys[0]}" is defined in your module's derive property.`,
				);
			}
		}
	}

	private getValues(): T {
		if (this.isMulti) {
			const result: Record<string, unknown> = {};
			for (const id of this.keys) {
				result[id] = this.system.read(id);
			}
			return result as T;
		}
		return this.system.read(this.keys[0]!) as T;
	}

	protected subscribe(): void {
		this.value = this.getValues();
		this.unsubscribe = this.system.subscribe(this.keys, () => {
			this.value = this.getValues();
			this.requestUpdate();
		});
	}
}

/**
 * Reactive controller for a single fact value.
 */
export class FactController<T> extends DirectiveController {
	private factKey: string;
	value: T | undefined;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		factKey: string,
	) {
		super(host, system);
		this.factKey = factKey;
		this.value = system.facts.$store.get(factKey) as T | undefined;

		if (process.env.NODE_ENV !== "production") {
			if (!system.facts.$store.has(factKey)) {
				console.warn(
					`[Directive] FactController("${factKey}") — fact not found in store. ` +
					`Check that "${factKey}" is defined in your module's schema.`,
				);
			}
		}
	}

	protected subscribe(): void {
		this.value = this.system.facts.$store.get(this.factKey) as T | undefined;
		this.unsubscribe = this.system.facts.$store.subscribe(
			[this.factKey],
			() => {
				this.value = this.system.facts.$store.get(this.factKey) as T | undefined;
				this.requestUpdate();
			},
		);
	}
}

/**
 * Consolidated inspection controller.
 * Returns InspectState with optional throttling.
 */
export class InspectController extends DirectiveController {
	value: InspectState;
	private throttleMs: number;
	private throttleCleanup?: () => void;
	private unsubSettled?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: SingleModuleSystem<any>, options?: { throttleMs?: number }) {
		super(host, system);
		this.throttleMs = options?.throttleMs ?? 0;
		this.value = computeInspectState(system);
	}

	protected subscribe(): void {
		this.value = computeInspectState(this.system);

		const update = () => {
			this.value = computeInspectState(this.system);
			this.requestUpdate();
		};

		if (this.throttleMs > 0) {
			const { throttled, cleanup } = createThrottle(update, this.throttleMs);
			this.throttleCleanup = cleanup;
			this.unsubscribe = this.system.facts.$store.subscribeAll(throttled);
			this.unsubSettled = this.system.onSettledChange(throttled);
		} else {
			this.unsubscribe = this.system.facts.$store.subscribeAll(update);
			this.unsubSettled = this.system.onSettledChange(update);
		}
	}

	hostDisconnected(): void {
		this.throttleCleanup?.();
		this.unsubSettled?.();
		super.hostDisconnected();
	}
}

/**
 * Reactive controller for requirement status.
 */
export class RequirementStatusController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private type: string;
	private unsubscribe?: () => void;
	value: RequirementTypeStatus;

	constructor(
		host: ReactiveControllerHost,
		statusPlugin: StatusPlugin,
		type: string,
	) {
		this.host = host;
		this.statusPlugin = statusPlugin;
		this.type = type;
		this.value = statusPlugin.getStatus(type);
		host.addController(this);
	}

	hostConnected(): void {
		this.value = this.statusPlugin.getStatus(this.type);
		this.unsubscribe = this.statusPlugin.subscribe(() => {
			this.value = this.statusPlugin.getStatus(this.type);
			this.host.requestUpdate();
		});
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}
}

// ============================================================================
// Selector Controllers
// ============================================================================

/**
 * Reactive controller for selecting across all facts.
 * Uses `withTracking()` for auto-tracking when constructed with `autoTrack: true`.
 */
export class DirectiveSelectorController<R> extends DirectiveController {
	private selector: (state: Record<string, unknown>) => R;
	private equalityFn: (a: R, b: R) => boolean;
	private autoTrack: boolean;
	private deriveKeySet: Set<string>;
	private trackedFactKeys: string[] = [];
	private trackedDeriveKeys: string[] = [];
	private unsubs: Array<() => void> = [];
	value: R;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		selector: (state: Record<string, unknown>) => R,
		equalityFn: (a: R, b: R) => boolean = defaultEquality,
		options?: { autoTrack?: boolean },
	) {
		super(host, system);
		this.selector = selector;
		this.equalityFn = equalityFn;
		this.autoTrack = options?.autoTrack ?? true;
		this.deriveKeySet = new Set(Object.keys(system.derive ?? {}));

		const initial = this.runWithTracking();
		this.value = initial.value;
		this.trackedFactKeys = initial.factKeys;
		this.trackedDeriveKeys = initial.deriveKeys;
	}

	private runWithTracking(): TrackedSelectorResult<R> {
		return runTrackedSelector(this.system, this.deriveKeySet, this.selector);
	}

	private resubscribe(): void {
		for (const unsub of this.unsubs) unsub();
		this.unsubs = [];

		const onUpdate = () => {
			const result = this.runWithTracking();
			if (!this.equalityFn(this.value, result.value)) {
				this.value = result.value;
				this.requestUpdate();
			}
			if (this.autoTrack) {
				// Re-track: check if deps changed
				if (depsChanged(this.trackedFactKeys, result.factKeys, this.trackedDeriveKeys, result.deriveKeys)) {
					this.trackedFactKeys = result.factKeys;
					this.trackedDeriveKeys = result.deriveKeys;
					this.resubscribe();
				}
			}
		};

		if (this.autoTrack) {
			if (this.trackedFactKeys.length > 0) {
				this.unsubs.push(this.system.facts.$store.subscribe(this.trackedFactKeys, onUpdate));
			} else if (this.trackedDeriveKeys.length === 0) {
				this.unsubs.push(this.system.facts.$store.subscribeAll(onUpdate));
			}
			if (this.trackedDeriveKeys.length > 0) {
				this.unsubs.push(this.system.subscribe(this.trackedDeriveKeys, onUpdate));
			}
		} else {
			this.unsubs.push(this.system.facts.$store.subscribeAll(onUpdate));
		}
	}

	protected subscribe(): void {
		const result = this.runWithTracking();
		this.value = result.value;
		this.trackedFactKeys = result.factKeys;
		this.trackedDeriveKeys = result.deriveKeys;
		this.resubscribe();
	}

	hostDisconnected(): void {
		for (const unsub of this.unsubs) unsub();
		this.unsubs = [];
		super.hostDisconnected();
	}
}

/**
 * Reactive controller that watches a fact or derivation and calls a callback on change.
 * The key is auto-detected — works with both fact keys and derivation keys.
 */
export class WatchController<T> extends DirectiveController {
	private key: string;
	private callback: (newValue: T, previousValue: T | undefined) => void;

	/** Watch a derivation or fact by key (auto-detected). When a key exists in both facts and derivations, the derivation overload takes priority. */
	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		key: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	);
	/**
	 * Watch a fact by explicit options.
	 * @deprecated Use `new WatchController(host, system, factKey, callback)` instead — facts are now auto-detected.
	 */
	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		options: { kind: "fact"; factKey: string },
		callback: (newValue: T, previousValue: T | undefined) => void,
	);
	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		keyOrOptions: string | { kind: "fact"; factKey: string },
		callback?: (newValue: T, previousValue: T | undefined) => void,
	) {
		super(host, system);
		if (typeof keyOrOptions === "string") {
			this.key = keyOrOptions;
		} else {
			this.key = keyOrOptions.factKey;
		}
		this.callback = callback!;
	}

	protected subscribe(): void {
		this.unsubscribe = this.system.watch<T>(this.key, this.callback);
	}
}

// ============================================================================
// New Controllers
// ============================================================================

/**
 * Reactive controller for requirement explanations.
 */
export class ExplainController extends DirectiveController {
	private requirementId: string;
	value: string | null;
	private unsubSettled?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: SingleModuleSystem<any>, requirementId: string) {
		super(host, system);
		this.requirementId = requirementId;
		this.value = system.explain(requirementId);
	}

	protected subscribe(): void {
		this.value = this.system.explain(this.requirementId);

		const update = () => {
			this.value = this.system.explain(this.requirementId);
			this.requestUpdate();
		};

		this.unsubscribe = this.system.facts.$store.subscribeAll(update);
		this.unsubSettled = this.system.onSettledChange(update);
	}

	hostDisconnected(): void {
		this.unsubSettled?.();
		super.hostDisconnected();
	}
}

/**
 * Reactive controller for constraint status.
 */
export class ConstraintStatusController extends DirectiveController {
	private constraintId?: string;
	value: ConstraintInfo[] | ConstraintInfo | null;
	private unsubSettled?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: SingleModuleSystem<any>, constraintId?: string) {
		super(host, system);
		this.constraintId = constraintId;
		this.value = this.getVal();
	}

	private getVal(): ConstraintInfo[] | ConstraintInfo | null {
		const inspection = this.system.inspect();
		if (!this.constraintId) return inspection.constraints;
		return inspection.constraints.find((c: ConstraintInfo) => c.id === this.constraintId) ?? null;
	}

	protected subscribe(): void {
		this.value = this.getVal();

		const update = () => {
			this.value = this.getVal();
			this.requestUpdate();
		};

		this.unsubscribe = this.system.facts.$store.subscribeAll(update);
		this.unsubSettled = this.system.onSettledChange(update);
	}

	hostDisconnected(): void {
		this.unsubSettled?.();
		super.hostDisconnected();
	}
}

/**
 * Reactive controller for optimistic updates.
 */
export class OptimisticUpdateController implements ReactiveController {
	private host: ReactiveControllerHost;
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	private system: SingleModuleSystem<any>;
	private statusPlugin?: StatusPlugin;
	private requirementType?: string;
	private snapshot: SystemSnapshot | null = null;
	private statusUnsub: (() => void) | null = null;

	isPending = false;
	error: Error | null = null;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: SingleModuleSystem<any>,
		statusPlugin?: StatusPlugin,
		requirementType?: string,
	) {
		this.host = host;
		this.system = system;
		this.statusPlugin = statusPlugin;
		this.requirementType = requirementType;
		host.addController(this);
	}

	hostConnected(): void {}

	hostDisconnected(): void {
		this.statusUnsub?.();
		this.statusUnsub = null;
	}

	rollback(): void {
		if (this.snapshot) {
			this.system.restore(this.snapshot);
			this.snapshot = null;
		}
		this.isPending = false;
		this.error = null;
		this.statusUnsub?.();
		this.statusUnsub = null;
		this.host.requestUpdate();
	}

	mutate(updateFn: () => void): void {
		this.snapshot = this.system.getSnapshot();
		this.isPending = true;
		this.error = null;
		this.system.batch(updateFn);
		this.host.requestUpdate();

		if (this.statusPlugin && this.requirementType) {
			this.statusUnsub?.();
			this.statusUnsub = this.statusPlugin.subscribe(() => {
				const status = this.statusPlugin!.getStatus(this.requirementType!);
				if (!status.isLoading && !status.hasError) {
					this.snapshot = null;
					this.isPending = false;
					this.statusUnsub?.();
					this.statusUnsub = null;
					this.host.requestUpdate();
				} else if (status.hasError) {
					this.error = status.lastError;
					this.rollback();
				}
			});
		}
	}
}

/**
 * Reactive controller that creates and manages a Directive system.
 * The system is automatically started when the host connects and destroyed when it disconnects.
 */
export class SystemController<M extends ModuleSchema> implements ReactiveController {
	private options: ModuleDef<M> | CreateSystemOptionsSingle<M>;
	private _system: SingleModuleSystem<M> | null = null;

	constructor(host: ReactiveControllerHost, options: ModuleDef<M> | CreateSystemOptionsSingle<M>) {
		this.options = options;
		host.addController(this);
	}

	get system(): SingleModuleSystem<M> {
		if (!this._system) {
			throw new Error(
				"[Directive] SystemController.system is not available. " +
				"This can happen if:\n" +
				"  1. Accessed before hostConnected (e.g., in a class field initializer)\n" +
				"  2. Accessed after hostDisconnected (system was destroyed)\n" +
				"Solution: Access system only in lifecycle methods (connectedCallback, render) " +
				"or after the element is connected to the DOM.",
			);
		}
		return this._system;
	}

	hostConnected(): void {
		const isModule = "id" in this.options && "schema" in this.options;
		const system = isModule
			? createSystem({ module: this.options as ModuleDef<M> })
			: createSystem(this.options as CreateSystemOptionsSingle<M>);
		this._system = system as unknown as SingleModuleSystem<M>;
		this._system.start();
	}

	hostDisconnected(): void {
		this._system?.destroy();
		this._system = null;
	}
}

/**
 * Module controller — zero-config all-in-one.
 * Creates system, starts it, subscribes to all facts/derivations.
 */
export class ModuleController<M extends ModuleSchema> implements ReactiveController {
	private host: ReactiveControllerHost;
	private moduleDef: ModuleDef<M>;
	private config?: {
		// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
		plugins?: Plugin<any>[];
		debug?: DebugConfig;
		errorBoundary?: ErrorBoundaryConfig;
		tickMs?: number;
		zeroConfig?: boolean;
		// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
		initialFacts?: Record<string, any>;
		status?: boolean;
	};

	private _system: SingleModuleSystem<M> | null = null;
	private unsubFacts?: () => void;
	private unsubDerived?: () => void;

	facts: InferFacts<M> = {} as InferFacts<M>;
	derived: InferDerivations<M> = {} as InferDerivations<M>;
	statusPlugin?: StatusPlugin;

	get system(): SingleModuleSystem<M> {
		if (!this._system) {
			throw new Error("[Directive] ModuleController.system is not available before hostConnected.");
		}
		return this._system;
	}

	get events(): SingleModuleSystem<M>["events"] {
		return this.system.events;
	}

	constructor(
		host: ReactiveControllerHost,
		moduleDef: ModuleDef<M>,
		config?: {
			// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
			plugins?: Plugin<any>[];
			debug?: DebugConfig;
			errorBoundary?: ErrorBoundaryConfig;
			tickMs?: number;
			zeroConfig?: boolean;
			// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
			initialFacts?: Record<string, any>;
			status?: boolean;
		},
	) {
		this.host = host;
		this.moduleDef = moduleDef;
		this.config = config;
		host.addController(this);
	}

	hostConnected(): void {
		const allPlugins = [...(this.config?.plugins ?? [])];

		if (this.config?.status) {
			const sp = createRequirementStatusPlugin();
			this.statusPlugin = sp;
			// biome-ignore lint/suspicious/noExplicitAny: Plugin generic issues
			allPlugins.push(sp.plugin as Plugin<any>);
		}

		// biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
		const system = createSystem({
			module: this.moduleDef,
			plugins: allPlugins.length > 0 ? allPlugins : undefined,
			debug: this.config?.debug,
			errorBoundary: this.config?.errorBoundary,
			tickMs: this.config?.tickMs,
			zeroConfig: this.config?.zeroConfig,
			initialFacts: this.config?.initialFacts,
		} as any) as unknown as SingleModuleSystem<M>;

		this._system = system;
		system.start();

		// Subscribe to all facts
		this.facts = system.facts.$store.toObject() as InferFacts<M>;
		this.unsubFacts = system.facts.$store.subscribeAll(() => {
			this.facts = system.facts.$store.toObject() as InferFacts<M>;
			this.host.requestUpdate();
		});

		// Subscribe to all derivations
		const derivationKeys = Object.keys(system.derive ?? {});
		const getDerived = (): InferDerivations<M> => {
			const result: Record<string, unknown> = {};
			for (const key of derivationKeys) {
				result[key] = system.read(key);
			}
			return result as InferDerivations<M>;
		};
		this.derived = getDerived();

		if (derivationKeys.length > 0) {
			this.unsubDerived = system.subscribe(derivationKeys, () => {
				this.derived = getDerived();
				this.host.requestUpdate();
			});
		}
	}

	hostDisconnected(): void {
		this.unsubFacts?.();
		this.unsubDerived?.();
		this._system?.destroy();
		this._system = null;
	}

	dispatch(event: InferEvents<M>): void {
		this.system.dispatch(event);
	}
}

// ============================================================================
// Factory Functions (active)
// ============================================================================

export function createDerived<T>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	key: string | string[],
): DerivedController<T> {
	return new DerivedController<T>(host, system, key);
}

export function createFact<T>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	factKey: string,
): FactController<T> {
	return new FactController<T>(host, system, factKey);
}

/**
 * Create an inspect controller.
 * Returns InspectState; pass `{ throttleMs }` for throttled updates.
 */
export function createInspect(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	options?: { throttleMs?: number },
): InspectController {
	return new InspectController(host, system, options);
}

export function createRequirementStatus(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
	type: string,
): RequirementStatusController {
	return new RequirementStatusController(host, statusPlugin, type);
}

export function createWatch<T>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): WatchController<T> {
	return new WatchController<T>(host, system, derivationId, callback);
}

export function createDirectiveSelector<R>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
	options?: { autoTrack?: boolean },
): DirectiveSelectorController<R> {
	return new DirectiveSelectorController<R>(host, system, selector, equalityFn, options);
}

export function createExplain(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	requirementId: string,
): ExplainController {
	return new ExplainController(host, system, requirementId);
}

export function createConstraintStatus(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	constraintId?: string,
): ConstraintStatusController {
	return new ConstraintStatusController(host, system, constraintId);
}

export function createOptimisticUpdate(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	statusPlugin?: StatusPlugin,
	requirementType?: string,
): OptimisticUpdateController {
	return new OptimisticUpdateController(host, system, statusPlugin, requirementType);
}

export function createModule<M extends ModuleSchema>(
	host: ReactiveControllerHost,
	moduleDef: ModuleDef<M>,
	config?: {
		// biome-ignore lint/suspicious/noExplicitAny: Plugin types vary
		plugins?: Plugin<any>[];
		debug?: DebugConfig;
		errorBoundary?: ErrorBoundaryConfig;
		tickMs?: number;
		zeroConfig?: boolean;
		// biome-ignore lint/suspicious/noExplicitAny: Facts type varies
		initialFacts?: Record<string, any>;
		status?: boolean;
	},
): ModuleController<M> {
	return new ModuleController<M>(host, moduleDef, config);
}

// ============================================================================
// Functional Helpers
// ============================================================================

export function useDispatch<M extends ModuleSchema = ModuleSchema>(
	system: SingleModuleSystem<M>,
): (event: InferEvents<M>) => void {
	assertSystem("useDispatch", system);
	return (event: InferEvents<M>) => {
		system.dispatch(event);
	};
}

/**
 * Returns the system's events dispatcher.
 */
export function useEvents<M extends ModuleSchema = ModuleSchema>(
	system: SingleModuleSystem<M>,
): SingleModuleSystem<M>["events"] {
	assertSystem("useEvents", system);
	return system.events;
}

import type { TimeTravelState } from "../../core/types.js";

/**
 * Reactive controller for time-travel state.
 * Triggers host updates when snapshots change or navigation occurs.
 *
 * @example
 * ```typescript
 * class MyElement extends LitElement {
 *   private tt = new TimeTravelController(this, system);
 *   render() {
 *     const { canUndo, undo } = this.tt.value ?? {};
 *     return html`<button ?disabled=${!canUndo} @click=${undo}>Undo</button>`;
 *   }
 * }
 * ```
 */
export class TimeTravelController implements ReactiveController {
	value: TimeTravelState | null = null;
	private _unsub?: () => void;

	constructor(
		private _host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		private _system: SingleModuleSystem<any>,
	) {
		this._host.addController(this);
	}

	hostConnected(): void {
		this.value = buildTimeTravelState(this._system);
		this._unsub = this._system.onTimeTravelChange(() => {
			this.value = buildTimeTravelState(this._system);
			this._host.requestUpdate();
		});
	}

	hostDisconnected(): void {
		this._unsub?.();
		this._unsub = undefined;
	}
}

/**
 * Functional helper for time-travel state (non-reactive, snapshot).
 * For reactive updates, use TimeTravelController.
 */
// biome-ignore lint/suspicious/noExplicitAny: System type varies
export function useTimeTravel(system: SingleModuleSystem<any>): TimeTravelState | null {
	assertSystem("useTimeTravel", system);
	return buildTimeTravelState(system);
}

export function getDerived<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	derivationId: string,
): () => T {
	return () => system.read(derivationId) as T;
}

export function getFact<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: SingleModuleSystem<any>,
	factKey: string,
): () => T | undefined {
	return () => system.facts.$store.get(factKey) as T | undefined;
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
	createDerived: <K extends keyof InferDerivations<M>>(
		host: ReactiveControllerHost,
		system: SingleModuleSystem<M>,
		derivationId: K,
	) => DerivedController<InferDerivations<M>[K]>;
	createFact: <K extends keyof InferFacts<M>>(
		host: ReactiveControllerHost,
		system: SingleModuleSystem<M>,
		factKey: K,
	) => FactController<InferFacts<M>[K]>;
	useDispatch: (system: SingleModuleSystem<M>) => (event: InferEvents<M>) => void;
	useEvents: (system: SingleModuleSystem<M>) => SingleModuleSystem<M>["events"];
	createWatch: <K extends string>(
		host: ReactiveControllerHost,
		system: SingleModuleSystem<M>,
		key: K,
		callback: (newValue: unknown, previousValue: unknown) => void,
	) => WatchController<unknown>;
} {
	return {
		createDerived: <K extends keyof InferDerivations<M>>(
			host: ReactiveControllerHost,
			system: SingleModuleSystem<M>,
			derivationId: K,
		) => createDerived<InferDerivations<M>[K]>(host, system, derivationId as string),
		createFact: <K extends keyof InferFacts<M>>(
			host: ReactiveControllerHost,
			system: SingleModuleSystem<M>,
			factKey: K,
		) => createFact<InferFacts<M>[K]>(host, system, factKey as string),
		useDispatch: (system: SingleModuleSystem<M>) => {
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useEvents: (system: SingleModuleSystem<M>) => system.events,
		createWatch: <K extends string>(
			host: ReactiveControllerHost,
			system: SingleModuleSystem<M>,
			key: K,
			callback: (newValue: unknown, previousValue: unknown) => void,
		) => createWatch<unknown>(host, system, key, callback),
	};
}


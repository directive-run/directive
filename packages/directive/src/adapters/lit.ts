/**
 * Lit Adapter - Consolidated Web Components integration for Directive
 *
 * Active Controllers: DerivationController, DerivationsController, FactController,
 * InspectController (with throttle), RequirementStatusController,
 * FactSelectorController, DerivedSelectorController, DirectiveSelectorController,
 * WatchController (with fact mode), SystemController,
 * ExplainController, ConstraintStatusController, OptimisticUpdateController, ModuleController
 *
 * Active Factories: createDerivation, createDerivations, createFact, createInspect,
 * createRequirementStatus, createWatch, createFactSelector, createDerivedSelector,
 * createDirectiveSelector, useFacts, useDispatch, useEvents, useTimeTravel,
 * getDerivation, getFact, createTypedHooks, shallowEqual
 *
 * 7 deprecated controllers + 7 deprecated factories for backward compatibility.
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import { createSystem } from "../core/system.js";
import { withTracking } from "../core/tracking.js";
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
	System,
	SystemInspection,
	SystemSnapshot,
} from "../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../utils/requirement-status.js";
import {
	type RequirementsState,
	type InspectState,
	type ConstraintInfo,
	computeRequirementsState,
	computeInspectState,
	createThrottle,
} from "./shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, RequirementsState, InspectState, ConstraintInfo };
export { shallowEqual } from "../utils/utils.js";

/** Type for the requirement status plugin return value */
type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

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
	protected system: System<any>;
	protected unsubscribe?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>) {
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
// Core Controllers (active, not deprecated)
// ============================================================================

/**
 * Reactive controller for a single derivation.
 */
export class DerivationController<T> extends DirectiveController {
	private derivationId: string;
	value: T;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		derivationId: string,
	) {
		super(host, system);
		this.derivationId = derivationId;
		this.value = system.read(derivationId) as T;

		if (process.env.NODE_ENV !== "production") {
			if (this.value === undefined) {
				console.warn(
					`[Directive] DerivationController("${derivationId}") returned undefined. ` +
					`Check that "${derivationId}" is defined in your module's derive property.`,
				);
			}
		}
	}

	protected subscribe(): void {
		this.value = this.system.read(this.derivationId) as T;
		this.unsubscribe = this.system.subscribe([this.derivationId], () => {
			this.value = this.system.read(this.derivationId) as T;
			this.requestUpdate();
		});
	}
}

/**
 * Reactive controller for multiple derivations.
 */
export class DerivationsController<
	T extends Record<string, unknown>,
> extends DirectiveController {
	private derivationIds: string[];
	value: T;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		derivationIds: string[],
	) {
		super(host, system);
		this.derivationIds = derivationIds;
		this.value = this.getValues();
	}

	private getValues(): T {
		const result: Record<string, unknown> = {};
		for (const id of this.derivationIds) {
			result[id] = this.system.read(id);
		}
		return result as T;
	}

	protected subscribe(): void {
		this.value = this.getValues();
		this.unsubscribe = this.system.subscribe(this.derivationIds, () => {
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
		system: System<any>,
		factKey: string,
	) {
		super(host, system);
		this.factKey = factKey;
		this.value = system.facts.$store.get(factKey) as T | undefined;
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
 * Replaces: InspectThrottledController, RequirementsController, RequirementsThrottledController, IsSettledController
 */
export class InspectController extends DirectiveController {
	value: InspectState;
	private throttleMs: number;
	private throttleCleanup?: () => void;
	private unsubSettled?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>, options?: { throttleMs?: number }) {
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

/** Default equality function for selectors */
function defaultEquality<T>(a: T, b: T): boolean {
	return Object.is(a, b);
}

/**
 * Reactive controller for a fact with selector function.
 */
export class FactSelectorController<T, R> extends DirectiveController {
	private factKey: string;
	private selector: (value: T | undefined) => R;
	private equalityFn: (a: R, b: R) => boolean;
	value: R;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		factKey: string,
		selector: (value: T | undefined) => R,
		equalityFn: (a: R, b: R) => boolean = defaultEquality,
	) {
		super(host, system);
		this.factKey = factKey;
		this.selector = selector;
		this.equalityFn = equalityFn;
		const initialValue = system.facts.$store.get(factKey) as T | undefined;
		this.value = selector(initialValue);
	}

	protected subscribe(): void {
		const initialValue = this.system.facts.$store.get(this.factKey) as T | undefined;
		this.value = this.selector(initialValue);
		this.unsubscribe = this.system.facts.$store.subscribe([this.factKey], () => {
			const newValue = this.system.facts.$store.get(this.factKey) as T | undefined;
			const newSelected = this.selector(newValue);
			if (!this.equalityFn(this.value, newSelected)) {
				this.value = newSelected;
				this.requestUpdate();
			}
		});
	}
}

/**
 * Reactive controller for a derivation with selector function.
 */
export class DerivedSelectorController<T, R> extends DirectiveController {
	private derivationId: string;
	private selector: (value: T) => R;
	private equalityFn: (a: R, b: R) => boolean;
	value: R;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		derivationId: string,
		selector: (value: T) => R,
		equalityFn: (a: R, b: R) => boolean = defaultEquality,
	) {
		super(host, system);
		this.derivationId = derivationId;
		this.selector = selector;
		this.equalityFn = equalityFn;
		const initialValue = system.read(derivationId) as T;
		this.value = selector(initialValue);
	}

	protected subscribe(): void {
		const initialValue = this.system.read(this.derivationId) as T;
		this.value = this.selector(initialValue);
		this.unsubscribe = this.system.subscribe([this.derivationId], () => {
			const newValue = this.system.read(this.derivationId) as T;
			const newSelected = this.selector(newValue);
			if (!this.equalityFn(this.value, newSelected)) {
				this.value = newSelected;
				this.requestUpdate();
			}
		});
	}
}

/**
 * Reactive controller for selecting across all facts.
 * Uses `withTracking()` for auto-tracking when constructed with `autoTrack: true`.
 */
export class DirectiveSelectorController<R> extends DirectiveController {
	private selector: (facts: Record<string, unknown>) => R;
	private equalityFn: (a: R, b: R) => boolean;
	private autoTrack: boolean;
	value: R;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		selector: (facts: Record<string, unknown>) => R,
		equalityFn: (a: R, b: R) => boolean = defaultEquality,
		options?: { autoTrack?: boolean },
	) {
		super(host, system);
		this.selector = selector;
		this.equalityFn = equalityFn;
		this.autoTrack = options?.autoTrack ?? false;
		this.value = selector(system.facts.$store.toObject());
	}

	protected subscribe(): void {
		this.value = this.selector(this.system.facts.$store.toObject());

		const getFacts = () => this.system.facts.$store.toObject();

		if (this.autoTrack) {
			const { deps } = withTracking(() => this.selector(getFacts()));
			const keys = Array.from(deps) as string[];

			const subscribeFn = keys.length === 0
				? (cb: () => void) => this.system.facts.$store.subscribeAll(cb)
				: (cb: () => void) => this.system.facts.$store.subscribe(keys, cb);

			this.unsubscribe = subscribeFn(() => {
				const newSelected = this.selector(getFacts());
				if (!this.equalityFn(this.value, newSelected)) {
					this.value = newSelected;
					this.requestUpdate();
				}
			});
		} else {
			this.unsubscribe = this.system.facts.$store.subscribeAll(() => {
				const newSelected = this.selector(getFacts());
				if (!this.equalityFn(this.value, newSelected)) {
					this.value = newSelected;
					this.requestUpdate();
				}
			});
		}
	}
}

/**
 * Reactive controller that watches a derivation or fact and calls a callback on change.
 */
export class WatchController<T> extends DirectiveController {
	private derivationId?: string;
	private factKey?: string;
	private callback: (newValue: T, previousValue: T | undefined) => void;

	/** Watch a derivation */
	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		derivationId: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	);
	/** Watch a fact */
	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		options: { kind: "fact"; factKey: string },
		callback: (newValue: T, previousValue: T | undefined) => void,
	);
	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		derivationIdOrOptions: string | { kind: "fact"; factKey: string },
		callback?: (newValue: T, previousValue: T | undefined) => void,
	) {
		super(host, system);
		if (typeof derivationIdOrOptions === "string") {
			this.derivationId = derivationIdOrOptions;
			this.callback = callback!;
		} else {
			this.factKey = derivationIdOrOptions.factKey;
			this.callback = callback!;
		}
	}

	protected subscribe(): void {
		if (this.factKey) {
			// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
			let prev = (this.system.facts as any)[this.factKey] as T | undefined;
			const factKey = this.factKey;
			this.unsubscribe = this.system.facts.$store.subscribe([factKey], () => {
				// biome-ignore lint/suspicious/noExplicitAny: Dynamic fact access
				const next = (this.system.facts as any)[factKey] as T;
				if (!Object.is(next, prev)) {
					this.callback(next, prev);
					prev = next;
				}
			});
		} else if (this.derivationId) {
			this.unsubscribe = this.system.watch<T>(this.derivationId, this.callback);
		}
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
	constructor(host: ReactiveControllerHost, system: System<any>, requirementId: string) {
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
	constructor(host: ReactiveControllerHost, system: System<any>, constraintId?: string) {
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
	private system: System<any>;
	private statusPlugin?: StatusPlugin;
	private requirementType?: string;
	private snapshot: SystemSnapshot | null = null;
	private statusUnsub: (() => void) | null = null;

	isPending = false;
	error: Error | null = null;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
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
	private _system: System<M> | null = null;

	constructor(host: ReactiveControllerHost, options: ModuleDef<M> | CreateSystemOptionsSingle<M>) {
		this.options = options;
		host.addController(this);
	}

	get system(): System<M> {
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
		this._system = system as unknown as System<M>;
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

	private _system: System<M> | null = null;
	private unsubFacts?: () => void;
	private unsubDerived?: () => void;

	facts: InferFacts<M> = {} as InferFacts<M>;
	derived: InferDerivations<M> = {} as InferDerivations<M>;
	statusPlugin?: StatusPlugin;

	get system(): System<M> {
		if (!this._system) {
			throw new Error("[Directive] ModuleController.system is not available before hostConnected.");
		}
		return this._system;
	}

	get events(): System<M>["events"] {
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
		} as any) as unknown as System<M>;

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

export function createDerivation<T>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): DerivationController<T> {
	return new DerivationController<T>(host, system, derivationId);
}

export function createDerivations<T extends Record<string, unknown>>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationIds: string[],
): DerivationsController<T> {
	return new DerivationsController<T>(host, system, derivationIds);
}

export function createFact<T>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
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
	system: System<any>,
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
	system: System<any>,
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): WatchController<T> {
	return new WatchController<T>(host, system, derivationId, callback);
}

export function createFactSelector<T, R>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	factKey: string,
	selector: (value: T | undefined) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): FactSelectorController<T, R> {
	return new FactSelectorController<T, R>(host, system, factKey, selector, equalityFn);
}

export function createDerivedSelector<T, R>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): DerivedSelectorController<T, R> {
	return new DerivedSelectorController<T, R>(host, system, derivationId, selector, equalityFn);
}

export function createDirectiveSelector<R>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
	options?: { autoTrack?: boolean },
): DirectiveSelectorController<R> {
	return new DirectiveSelectorController<R>(host, system, selector, equalityFn, options);
}

export function createExplain(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	requirementId: string,
): ExplainController {
	return new ExplainController(host, system, requirementId);
}

export function createConstraintStatus(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	constraintId?: string,
): ConstraintStatusController {
	return new ConstraintStatusController(host, system, constraintId);
}

export function createOptimisticUpdate(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
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

export function useFacts<M extends ModuleSchema>(system: System<M>): System<M>["facts"] {
	return system.facts;
}

export function useDispatch<M extends ModuleSchema = ModuleSchema>(
	system: System<M>,
): (event: InferEvents<M>) => void {
	return (event: InferEvents<M>) => {
		system.dispatch(event);
	};
}

/**
 * Returns the system's events dispatcher.
 */
export function useEvents<M extends ModuleSchema = ModuleSchema>(
	system: System<M>,
): System<M>["events"] {
	return system.events;
}

import type { TimeTravelState } from "../core/types.js";

function _buildTTState(system: System<ModuleSchema>): TimeTravelState | null {
	const debug = system.debug;
	if (!debug) return null;
	return {
		canUndo: debug.currentIndex > 0,
		canRedo: debug.currentIndex < debug.snapshots.length - 1,
		undo: () => debug.goBack(),
		redo: () => debug.goForward(),
		currentIndex: debug.currentIndex,
		totalSnapshots: debug.snapshots.length,
	};
}

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
		private _system: System<any>,
	) {
		this._host.addController(this);
	}

	hostConnected(): void {
		this.value = _buildTTState(this._system);
		this._unsub = this._system.onTimeTravelChange(() => {
			this.value = _buildTTState(this._system);
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
export function useTimeTravel(system: System<any>): TimeTravelState | null {
	return _buildTTState(system);
}

export function getDerivation<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): () => T {
	return () => system.read(derivationId) as T;
}

export function getFact<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	factKey: string,
): () => T | undefined {
	return () => system.facts.$store.get(factKey) as T | undefined;
}

// ============================================================================
// Typed Hooks Factory
// ============================================================================

export function createTypedHooks<M extends ModuleSchema>(): {
	createDerivation: <K extends keyof InferDerivations<M>>(
		host: ReactiveControllerHost,
		system: System<M>,
		derivationId: K,
	) => DerivationController<InferDerivations<M>[K]>;
	createFact: <K extends keyof InferFacts<M>>(
		host: ReactiveControllerHost,
		system: System<M>,
		factKey: K,
	) => FactController<InferFacts<M>[K]>;
	useDispatch: (system: System<M>) => (event: InferEvents<M>) => void;
	useFacts: (system: System<M>) => System<M>["facts"];
	useEvents: (system: System<M>) => System<M>["events"];
} {
	return {
		createDerivation: <K extends keyof InferDerivations<M>>(
			host: ReactiveControllerHost,
			system: System<M>,
			derivationId: K,
		) => createDerivation<InferDerivations<M>[K]>(host, system, derivationId as string),
		createFact: <K extends keyof InferFacts<M>>(
			host: ReactiveControllerHost,
			system: System<M>,
			factKey: K,
		) => createFact<InferFacts<M>[K]>(host, system, factKey as string),
		useDispatch: (system: System<M>) => {
			return (event: InferEvents<M>) => {
				system.dispatch(event);
			};
		},
		useFacts: (system: System<M>) => system.facts,
		useEvents: (system: System<M>) => system.events,
	};
}

// ============================================================================
// Deprecated Controllers (one release cycle)
// ============================================================================

/**
 * @deprecated Use `InspectController` with `{ throttleMs }` option instead.
 */
export class InspectThrottledController extends DirectiveController {
	value: SystemInspection;
	private throttleMs: number;
	private throttleCleanup?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>, throttleMs = 100) {
		super(host, system);
		this.throttleMs = throttleMs;
		this.value = system.inspect();
	}

	protected subscribe(): void {
		this.value = this.system.inspect();
		const { throttled, cleanup } = createThrottle(() => {
			this.value = this.system.inspect();
			this.requestUpdate();
		}, this.throttleMs);
		this.throttleCleanup = cleanup;
		this.unsubscribe = this.system.facts.$store.subscribeAll(throttled);
	}

	hostDisconnected(): void {
		this.throttleCleanup?.();
		super.hostDisconnected();
	}
}

/**
 * @deprecated Use `InspectController` instead.
 */
export class RequirementsController extends DirectiveController {
	value: RequirementsState;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>) {
		super(host, system);
		this.value = computeRequirementsState(system.inspect());
	}

	protected subscribe(): void {
		this.value = computeRequirementsState(this.system.inspect());
		this.unsubscribe = this.system.facts.$store.subscribeAll(() => {
			this.value = computeRequirementsState(this.system.inspect());
			this.requestUpdate();
		});
	}
}

/**
 * @deprecated Use `InspectController` with `{ throttleMs }` option instead.
 */
export class RequirementsThrottledController extends DirectiveController {
	value: RequirementsState;
	private throttleMs: number;
	private throttleCleanup?: () => void;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>, throttleMs = 100) {
		super(host, system);
		this.throttleMs = throttleMs;
		this.value = computeRequirementsState(system.inspect());
	}

	protected subscribe(): void {
		this.value = computeRequirementsState(this.system.inspect());
		const { throttled, cleanup } = createThrottle(() => {
			this.value = computeRequirementsState(this.system.inspect());
			this.requestUpdate();
		}, this.throttleMs);
		this.throttleCleanup = cleanup;
		this.unsubscribe = this.system.facts.$store.subscribeAll(throttled);
	}

	hostDisconnected(): void {
		this.throttleCleanup?.();
		super.hostDisconnected();
	}
}

/**
 * @deprecated Use `InspectController` and check `.value.isSettled` instead.
 */
export class IsSettledController extends DirectiveController {
	value: boolean;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>) {
		super(host, system);
		this.value = system.isSettled;
	}

	protected subscribe(): void {
		this.value = this.system.isSettled;
		this.unsubscribe = this.system.facts.$store.subscribeAll(() => {
			this.value = this.system.isSettled;
			this.requestUpdate();
		});
	}
}

/**
 * @deprecated Use `RequirementStatusController` and check `.value.inflight > 0` instead.
 */
export class IsResolvingController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private type: string;
	private unsubscribe?: () => void;
	value: boolean;

	constructor(host: ReactiveControllerHost, statusPlugin: StatusPlugin, type: string) {
		this.host = host;
		this.statusPlugin = statusPlugin;
		this.type = type;
		this.value = statusPlugin.getStatus(type).inflight > 0;
		host.addController(this);
	}

	hostConnected(): void {
		this.value = this.statusPlugin.getStatus(this.type).inflight > 0;
		this.unsubscribe = this.statusPlugin.subscribe(() => {
			this.value = this.statusPlugin.getStatus(this.type).inflight > 0;
			this.host.requestUpdate();
		});
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}
}

/**
 * @deprecated Use `RequirementStatusController` and check `.value.lastError` instead.
 */
export class LatestErrorController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private type: string;
	private unsubscribe?: () => void;
	value: Error | null;

	constructor(host: ReactiveControllerHost, statusPlugin: StatusPlugin, type: string) {
		this.host = host;
		this.statusPlugin = statusPlugin;
		this.type = type;
		this.value = statusPlugin.getStatus(type).lastError;
		host.addController(this);
	}

	hostConnected(): void {
		this.value = this.statusPlugin.getStatus(this.type).lastError;
		this.unsubscribe = this.statusPlugin.subscribe(() => {
			this.value = this.statusPlugin.getStatus(this.type).lastError;
			this.host.requestUpdate();
		});
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}
}

/**
 * @deprecated Use `RequirementStatusController` for individual types or keep for dashboard use.
 */
export class RequirementStatusesController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private unsubscribe?: () => void;
	value: Map<string, RequirementTypeStatus>;

	constructor(host: ReactiveControllerHost, statusPlugin: StatusPlugin) {
		this.host = host;
		this.statusPlugin = statusPlugin;
		this.value = statusPlugin.getAllStatus();
		host.addController(this);
	}

	hostConnected(): void {
		this.value = this.statusPlugin.getAllStatus();
		this.unsubscribe = this.statusPlugin.subscribe(() => {
			this.value = this.statusPlugin.getAllStatus();
			this.host.requestUpdate();
		});
	}

	hostDisconnected(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
	}
}

// ============================================================================
// Deprecated Factory Functions
// ============================================================================

/**
 * @deprecated Use `createInspect(host, system, { throttleMs })` instead.
 */
export function createInspectThrottled(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	throttleMs = 100,
): InspectThrottledController {
	return new InspectThrottledController(host, system, throttleMs);
}

/**
 * @deprecated Use `createInspect(host, system)` instead.
 */
export function createRequirements(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
): RequirementsController {
	return new RequirementsController(host, system);
}

/**
 * @deprecated Use `createInspect(host, system, { throttleMs })` instead.
 */
export function createRequirementsThrottled(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	throttleMs = 100,
): RequirementsThrottledController {
	return new RequirementsThrottledController(host, system, throttleMs);
}

/**
 * @deprecated Use `createInspect(host, system)` and check `.value.isSettled`.
 */
export function createIsSettled(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
): IsSettledController {
	return new IsSettledController(host, system);
}

/**
 * @deprecated Use `createRequirementStatus(host, plugin, type)` and check `.value.inflight > 0`.
 */
export function createIsResolving(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
	type: string,
): IsResolvingController {
	return new IsResolvingController(host, statusPlugin, type);
}

/**
 * @deprecated Use `createRequirementStatus(host, plugin, type)` and check `.value.lastError`.
 */
export function createLatestError(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
	type: string,
): LatestErrorController {
	return new LatestErrorController(host, statusPlugin, type);
}

/**
 * @deprecated Keep for dashboard use or use individual `RequirementStatusController` instances.
 */
export function createRequirementStatuses(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
): RequirementStatusesController {
	return new RequirementStatusesController(host, statusPlugin);
}

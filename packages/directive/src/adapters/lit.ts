/**
 * Lit Adapter - Web Components integration for Directive
 *
 * Features:
 * - Reactive Controllers for derivations and facts
 * - Context protocol integration via @lit/context
 * - Automatic cleanup on disconnect
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import { createSystem, type CreateSystemOptions } from "../core/system.js";
import type { DerivationsDef, Facts, ModuleDef, Schema, System, SystemInspection } from "../core/types.js";

// ============================================================================
// Context
// ============================================================================

/**
 * Context key for Directive system.
 * Use with @lit/context for dependency injection across shadow DOM boundaries.
 *
 * @example
 * ```ts
 * import { createContext, provide, consume } from '@lit/context';
 * import { directiveContext } from 'directive/lit';
 *
 * // In parent component
 * @provide({ context: directiveContext })
 * system = createSystem({ modules: [myModule] });
 *
 * // In child component
 * @consume({ context: directiveContext })
 * system!: System<MySchema>;
 * ```
 */
export const directiveContext = Symbol("directive");

// ============================================================================
// Reactive Controllers
// ============================================================================

/**
 * Base controller that manages system subscription lifecycle.
 */
abstract class DirectiveController implements ReactiveController {
	protected host: ReactiveControllerHost;
	protected system: System<Schema>;
	protected unsubscribe?: () => void;

	constructor(host: ReactiveControllerHost, system: System<Schema>) {
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

/**
 * Reactive controller for a single derivation.
 * Automatically updates the host element when the derivation value changes.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { DerivationController } from 'directive/lit';
 *
 * class StatusDisplay extends LitElement {
 *   private isRed = new DerivationController<boolean>(this, system, 'isRed');
 *
 *   render() {
 *     return html`<div>${this.isRed.value ? 'Red' : 'Not Red'}</div>`;
 *   }
 * }
 * ```
 */
export class DerivationController<T> extends DirectiveController {
	private derivationId: string;
	value: T;

	constructor(
		host: ReactiveControllerHost,
		system: System<Schema>,
		derivationId: string,
	) {
		super(host, system);
		this.derivationId = derivationId;
		this.value = system.read(derivationId) as T;

		// Dev warning for invalid derivation IDs
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
 * Returns an object with all requested derivation values.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { DerivationsController } from 'directive/lit';
 *
 * class StatusDisplay extends LitElement {
 *   private state = new DerivationsController<{ isRed: boolean; elapsed: number }>(
 *     this, system, ['isRed', 'elapsed']
 *   );
 *
 *   render() {
 *     const { isRed, elapsed } = this.state.value;
 *     return html`<div>${isRed ? `Red for ${elapsed}s` : 'Not Red'}</div>`;
 *   }
 * }
 * ```
 */
export class DerivationsController<
	T extends Record<string, unknown>,
> extends DirectiveController {
	private derivationIds: string[];
	value: T;

	constructor(
		host: ReactiveControllerHost,
		system: System<Schema>,
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
 * Automatically updates when the fact changes.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { FactController } from 'directive/lit';
 *
 * class PhaseDisplay extends LitElement {
 *   private phase = new FactController<string>(this, system, 'phase');
 *
 *   render() {
 *     return html`<div>Current phase: ${this.phase.value}</div>`;
 *   }
 * }
 * ```
 */
export class FactController<T> extends DirectiveController {
	private factKey: string;
	value: T | undefined;

	constructor(
		host: ReactiveControllerHost,
		system: System<Schema>,
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
 * Reactive controller for system inspection data.
 * Updates on every fact change - use sparingly in production.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { InspectionController } from 'directive/lit';
 *
 * class Inspector extends LitElement {
 *   private inspection = new InspectionController(this, system);
 *
 *   render() {
 *     return html`<div>Unmet: ${this.inspection.value.unmet.length}</div>`;
 *   }
 * }
 * ```
 */
export class InspectionController extends DirectiveController {
	value: SystemInspection;

	constructor(host: ReactiveControllerHost, system: System<Schema>) {
		super(host, system);
		this.value = system.inspect();
	}

	protected subscribe(): void {
		this.value = this.system.inspect();
		this.unsubscribe = this.system.facts.$store.subscribeAll(() => {
			this.value = this.system.inspect();
			this.requestUpdate();
		});
	}
}

/**
 * Reactive controller that watches a derivation and calls a callback on change.
 *
 * @example
 * ```ts
 * import { LitElement } from 'lit';
 * import { WatchController } from 'directive/lit';
 *
 * class PhaseWatcher extends LitElement {
 *   private watcher = new WatchController<string>(
 *     this,
 *     system,
 *     'phase',
 *     (newPhase, oldPhase) => {
 *       console.log(`Phase changed from ${oldPhase} to ${newPhase}`);
 *     }
 *   );
 * }
 * ```
 */
export class WatchController<T> extends DirectiveController {
	private derivationId: string;
	private callback: (newValue: T, previousValue: T | undefined) => void;

	constructor(
		host: ReactiveControllerHost,
		system: System<Schema>,
		derivationId: string,
		callback: (newValue: T, previousValue: T | undefined) => void,
	) {
		super(host, system);
		this.derivationId = derivationId;
		this.callback = callback;
	}

	protected subscribe(): void {
		this.unsubscribe = this.system.watch<T>(this.derivationId, this.callback);
	}
}

// ============================================================================
// Factory Functions (for consistency with other adapters)
// ============================================================================

/**
 * Create a derivation controller.
 * Factory function alternative to `new DerivationController()`.
 *
 * @example
 * ```ts
 * class MyElement extends LitElement {
 *   private isRed = createDerivation<boolean>(this, system, 'isRed');
 * }
 * ```
 */
export function createDerivation<T>(
	host: ReactiveControllerHost,
	system: System<Schema>,
	derivationId: string,
): DerivationController<T> {
	return new DerivationController<T>(host, system, derivationId);
}

/**
 * Create a derivations controller for multiple values.
 *
 * @example
 * ```ts
 * class MyElement extends LitElement {
 *   private state = createDerivations<{ isRed: boolean; elapsed: number }>(
 *     this, system, ['isRed', 'elapsed']
 *   );
 * }
 * ```
 */
export function createDerivations<T extends Record<string, unknown>>(
	host: ReactiveControllerHost,
	system: System<Schema>,
	derivationIds: string[],
): DerivationsController<T> {
	return new DerivationsController<T>(host, system, derivationIds);
}

/**
 * Create a fact controller.
 *
 * @example
 * ```ts
 * class MyElement extends LitElement {
 *   private phase = createFact<string>(this, system, 'phase');
 * }
 * ```
 */
export function createFact<T>(
	host: ReactiveControllerHost,
	system: System<Schema>,
	factKey: string,
): FactController<T> {
	return new FactController<T>(host, system, factKey);
}

/**
 * Get direct access to facts for mutations.
 * Returns the facts proxy - changes will trigger updates in any controllers.
 *
 * @example
 * ```ts
 * class Controls extends LitElement {
 *   private facts = useFacts<MySchema>(system);
 *
 *   handleClick() {
 *     this.facts.count = (this.facts.count ?? 0) + 1;
 *   }
 * }
 * ```
 */
export function useFacts<S extends Schema>(system: System<S>): Facts<S> {
	return system.facts;
}

/**
 * Get dispatch function for sending events.
 *
 * @example
 * ```ts
 * class Controls extends LitElement {
 *   private dispatch = useDispatch(system);
 *
 *   handleClick() {
 *     this.dispatch({ type: 'tick' });
 *   }
 * }
 * ```
 */
export function useDispatch(system: System<Schema>) {
	return (event: { type: string; [key: string]: unknown }) => {
		system.dispatch(event);
	};
}

/**
 * Get time-travel debug API (if enabled).
 */
export function useTimeTravel(system: System<Schema>) {
	return system.debug;
}

/**
 * Create an inspection controller.
 *
 * @example
 * ```ts
 * class Inspector extends LitElement {
 *   private inspection = createInspection(this, system);
 * }
 * ```
 */
export function createInspection(
	host: ReactiveControllerHost,
	system: System<Schema>,
): InspectionController {
	return new InspectionController(host, system);
}

/**
 * Create a watch controller.
 *
 * @example
 * ```ts
 * class MyElement extends LitElement {
 *   private watcher = createWatch<string>(this, system, 'phase', (newVal, oldVal) => {
 *     console.log('Phase changed:', newVal);
 *   });
 * }
 * ```
 */
export function createWatch<T>(
	host: ReactiveControllerHost,
	system: System<Schema>,
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): WatchController<T> {
	return new WatchController<T>(host, system, derivationId, callback);
}

// ============================================================================
// System Controller (like XState's useActorRef)
// ============================================================================

/** Options for SystemController */
export type SystemControllerOptions<S extends Schema> =
	| ModuleDef<S, DerivationsDef<S>>
	| CreateSystemOptions<S>;

/**
 * Reactive controller that creates and manages a Directive system.
 * The system is automatically started when the host connects and destroyed when it disconnects.
 *
 * @see {@link DerivationController} for reading derived values
 * @see {@link FactController} for reactive fact access
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { SystemController, DerivationController } from 'directive/lit';
 *
 * class CounterElement extends LitElement {
 *   private directive = new SystemController(this, counterModule);
 *
 *   // Access the system
 *   private count = new DerivationController(this, this.directive.system, 'count');
 *
 *   render() {
 *     return html`
 *       <button @click=${() => this.directive.system.facts.count++}>
 *         Count: ${this.count.value}
 *       </button>
 *     `;
 *   }
 * }
 * ```
 */
export class SystemController<S extends Schema> implements ReactiveController {
	private options: SystemControllerOptions<S>;
	private _system: System<S> | null = null;

	constructor(host: ReactiveControllerHost, options: SystemControllerOptions<S>) {
		this.options = options;
		host.addController(this);
	}

	get system(): System<S> {
		if (!this._system) {
			throw new Error("[Directive] SystemController.system accessed before hostConnected");
		}
		return this._system;
	}

	hostConnected(): void {
		// Check if options is a module or system options
		const isModule = "id" in this.options && "schema" in this.options;

		this._system = isModule
			? createSystem({ modules: [this.options as ModuleDef<S, DerivationsDef<S>>] })
			: createSystem(this.options as CreateSystemOptions<S>);

		this._system.start();
	}

	hostDisconnected(): void {
		this._system?.destroy();
		this._system = null;
	}
}

// ============================================================================
// Functional Helpers (for parity with other adapters)
// ============================================================================

/**
 * Create a derivation value getter.
 * Functional alternative for use outside of class components.
 *
 * @see {@link DerivationController} for class-based usage
 *
 * @example
 * ```ts
 * const isRed = useDerivation<boolean>(system, 'isRed');
 * console.log(isRed()); // Get current value
 * ```
 */
export function useDerivation<T>(
	system: System<Schema>,
	derivationId: string,
): () => T {
	return () => system.read(derivationId) as T;
}

/**
 * Create a fact value getter.
 * Functional alternative for use outside of class components.
 *
 * @see {@link FactController} for class-based usage
 *
 * @example
 * ```ts
 * const phase = useFact<string>(system, 'phase');
 * console.log(phase()); // Get current value
 * ```
 */
export function useFact<T>(
	system: System<Schema>,
	factKey: string,
): () => T | undefined {
	return () => system.facts.$store.get(factKey) as T | undefined;
}

/**
 * Lit Adapter - Web Components integration for Directive
 *
 * Features:
 * - Reactive Controllers for derivations and facts
 * - Context protocol integration via @lit/context
 * - Automatic cleanup on disconnect
 * - RequirementStatusController for loading/error states
 * - createTypedHooks for schema-specific hooks
 */

import type { ReactiveController, ReactiveControllerHost } from "lit";
import { createSystem } from "../core/system.js";
import type { CreateSystemOptionsSingle, ModuleSchema, InferFacts, InferDerivations, InferEvents } from "../core/types.js";
import type { ModuleDef, System, SystemInspection } from "../core/types.js";
import {
	createRequirementStatusPlugin,
	type RequirementTypeStatus,
} from "../utils/requirement-status.js";
import {
	type RequirementsState,
	computeRequirementsState,
	createThrottle,
} from "./shared.js";

// Re-export for convenience
export type { RequirementTypeStatus, RequirementsState };

/** Type for the requirement status plugin return value */
type StatusPlugin = ReturnType<typeof createRequirementStatusPlugin>;

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
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
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
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		derivationIds: string[],
	) {
		super(host, system);
		this.derivationIds = derivationIds;
		this.value = this.getValues();

		// Dev warning for invalid derivation IDs
		if (process.env.NODE_ENV !== "production") {
			for (const id of derivationIds) {
				if (this.value[id as keyof T] === undefined) {
					console.warn(
						`[Directive] DerivationsController("${id}") returned undefined. ` +
							`Check that "${id}" is defined in your module's derive property.`,
					);
				}
			}
		}
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
 * Reactive controller for system inspection data.
 * Updates on every fact change - use sparingly in production.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { InspectController } from 'directive/lit';
 *
 * class Inspector extends LitElement {
 *   private inspection = new InspectController(this, system);
 *
 *   render() {
 *     return html`<div>Unmet: ${this.inspection.value.unmet.length}</div>`;
 *   }
 * }
 * ```
 */
export class InspectController extends DirectiveController {
	value: SystemInspection;

	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	constructor(host: ReactiveControllerHost, system: System<any>) {
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
 * Reactive controller for current requirements state.
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { RequirementsController } from 'directive/lit';
 *
 * class LoadingIndicator extends LitElement {
 *   private requirements = new RequirementsController(this, system);
 *
 *   render() {
 *     if (!this.requirements.value.isWorking) return html``;
 *     return html`<spinner-element></spinner-element>`;
 *   }
 * }
 * ```
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
 * Throttled version of InspectController.
 * Limits update frequency to prevent performance issues with high-frequency changes.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { InspectThrottledController } from 'directive/lit';
 *
 * class Inspector extends LitElement {
 *   private inspection = new InspectThrottledController(this, system, 100);
 *
 *   render() {
 *     return html`<div>Unmet: ${this.inspection.value.unmet.length}</div>`;
 *   }
 * }
 * ```
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
 * Throttled version of RequirementsController.
 * Limits update frequency to prevent performance issues with high-frequency changes.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { RequirementsThrottledController } from 'directive/lit';
 *
 * class LoadingIndicator extends LitElement {
 *   private requirements = new RequirementsThrottledController(this, system, 100);
 *
 *   render() {
 *     if (!this.requirements.value.isWorking) return html``;
 *     return html`<spinner-element></spinner-element>`;
 *   }
 * }
 * ```
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
 * Reactive controller for checking if the system has settled.
 * Automatically updates when the settled state changes.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { IsSettledController } from 'directive/lit';
 *
 * class LoadingIndicator extends LitElement {
 *   private settled = new IsSettledController(this, system);
 *
 *   render() {
 *     if (!this.settled.value) return html`<spinner-el></spinner-el>`;
 *     return html`<content-el></content-el>`;
 *   }
 * }
 * ```
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
 * Reactive controller for requirement status.
 * Tracks loading/error states for requirement types.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { RequirementStatusController } from 'directive/lit';
 *
 * class UserLoader extends LitElement {
 *   private status = new RequirementStatusController(this, statusPlugin, 'FETCH_USER');
 *
 *   render() {
 *     if (this.status.value.isLoading) return html`<spinner-el></spinner-el>`;
 *     if (this.status.value.hasError) return html`<error-el .message=${this.status.value.lastError?.message}></error-el>`;
 *     return html`<user-content></user-content>`;
 *   }
 * }
 * ```
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

/**
 * Reactive controller for checking if a requirement type is being resolved.
 * Simplified version of RequirementStatusController.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { IsResolvingController } from 'directive/lit';
 *
 * class SaveButton extends LitElement {
 *   private isSaving = new IsResolvingController(this, statusPlugin, 'SAVE_DATA');
 *
 *   render() {
 *     return html`
 *       <button ?disabled=${this.isSaving.value}>
 *         ${this.isSaving.value ? 'Saving...' : 'Save'}
 *       </button>
 *     `;
 *   }
 * }
 * ```
 */
export class IsResolvingController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private type: string;
	private unsubscribe?: () => void;
	value: boolean;

	constructor(
		host: ReactiveControllerHost,
		statusPlugin: StatusPlugin,
		type: string,
	) {
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
 * Reactive controller for getting the last error for a requirement type.
 * Simplified version of RequirementStatusController.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { LatestErrorController } from 'directive/lit';
 *
 * class ErrorDisplay extends LitElement {
 *   private error = new LatestErrorController(this, statusPlugin, 'FETCH_USER');
 *
 *   render() {
 *     if (!this.error.value) return html``;
 *     return html`<div class="error">${this.error.value.message}</div>`;
 *   }
 * }
 * ```
 */
export class LatestErrorController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private type: string;
	private unsubscribe?: () => void;
	value: Error | null;

	constructor(
		host: ReactiveControllerHost,
		statusPlugin: StatusPlugin,
		type: string,
	) {
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
 * Reactive controller for getting status of all tracked requirement types.
 * Useful for dashboard/admin UIs that need to show all requirement states.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { AllRequirementStatusesController } from 'directive/lit';
 *
 * class RequirementsDashboard extends LitElement {
 *   private allStatuses = new AllRequirementStatusesController(this, statusPlugin);
 *
 *   render() {
 *     return html`
 *       <ul>
 *         ${Array.from(this.allStatuses.value.entries()).map(([type, status]) => html`
 *           <li>${type}: ${status.isLoading ? 'Loading' : status.hasError ? 'Error' : 'Ready'}</li>
 *         `)}
 *       </ul>
 *     `;
 *   }
 * }
 * ```
 */
export class AllRequirementStatusesController implements ReactiveController {
	private host: ReactiveControllerHost;
	private statusPlugin: StatusPlugin;
	private unsubscribe?: () => void;
	value: Map<string, RequirementTypeStatus>;

	constructor(
		host: ReactiveControllerHost,
		statusPlugin: StatusPlugin,
	) {
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
// Selector Controllers (like XState's useSelector)
// ============================================================================

/** Default equality function for selectors */
function defaultEquality<T>(a: T, b: T): boolean {
	return a === b;
}

/**
 * Reactive controller for a fact with selector function.
 *
 * This allows fine-grained subscriptions - the host only re-renders when
 * the selected value changes (according to the equality function).
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { FactSelectorController } from 'directive/lit';
 *
 * class UserName extends LitElement {
 *   // Only re-render when user's name changes, not other user properties
 *   private userName = new FactSelectorController<User, string>(
 *     this, system, 'user', (u) => u?.name ?? 'Guest'
 *   );
 *
 *   render() {
 *     return html`<span>${this.userName.value}</span>`;
 *   }
 * }
 * ```
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
 *
 * This allows fine-grained subscriptions - the host only re-renders when
 * the selected value changes (according to the equality function).
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { DerivationSelectorController } from 'directive/lit';
 *
 * class StatusLabel extends LitElement {
 *   // Only re-render when status text changes
 *   private statusText = new DerivationSelectorController<Status, string>(
 *     this, system, 'status', (s) => s?.label ?? 'Unknown'
 *   );
 *
 *   render() {
 *     return html`<span>${this.statusText.value}</span>`;
 *   }
 * }
 * ```
 */
export class DerivationSelectorController<T, R> extends DirectiveController {
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
 *
 * This allows selecting derived values across multiple facts with fine-grained
 * re-rendering control.
 *
 * @example
 * ```ts
 * import { LitElement, html } from 'lit';
 * import { DirectiveSelectorController } from 'directive/lit';
 *
 * class Summary extends LitElement {
 *   private summary = new DirectiveSelectorController(
 *     this, system,
 *     (facts) => ({ count: facts.items?.length ?? 0, loading: facts.loading ?? false }),
 *     (a, b) => a.count === b.count && a.loading === b.loading
 *   );
 *
 *   render() {
 *     return html`<div>${this.summary.value.count} items</div>`;
 *   }
 * }
 * ```
 */
export class DirectiveSelectorController<R> extends DirectiveController {
	private selector: (facts: Record<string, unknown>) => R;
	private equalityFn: (a: R, b: R) => boolean;
	value: R;

	constructor(
		host: ReactiveControllerHost,
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
		selector: (facts: Record<string, unknown>) => R,
		equalityFn: (a: R, b: R) => boolean = defaultEquality,
	) {
		super(host, system);
		this.selector = selector;
		this.equalityFn = equalityFn;
		this.value = selector(system.facts.$store.toObject());
	}

	protected subscribe(): void {
		this.value = this.selector(this.system.facts.$store.toObject());
		this.unsubscribe = this.system.facts.$store.subscribeAll(() => {
			const newSelected = this.selector(this.system.facts.$store.toObject());
			if (!this.equalityFn(this.value, newSelected)) {
				this.value = newSelected;
				this.requestUpdate();
			}
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
		// biome-ignore lint/suspicious/noExplicitAny: System type varies
		system: System<any>,
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
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
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
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
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
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	factKey: string,
): FactController<T> {
	return new FactController<T>(host, system, factKey);
}

/**
 * Get direct access to facts for mutations.
 *
 * WARNING: The returned facts object is NOT reactive. Use this for event handlers
 * and imperative code, not for rendering. Use `DerivationController` or `FactController`
 * for reactive values. Changes to facts will trigger updates in controllers that
 * subscribe to the affected derivations.
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
export function useFacts<M extends ModuleSchema>(system: System<M>): System<M>["facts"] {
	return system.facts;
}

/**
 * Get dispatch function for sending events.
 *
 * @returns A dispatch function typed to the system's event schema
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
export function useDispatch<M extends ModuleSchema = ModuleSchema>(
	system: System<M>,
): (event: InferEvents<M>) => void {
	return (event: InferEvents<M>) => {
		system.dispatch(event);
	};
}

/**
 * Get time-travel debug API (if enabled).
 */
// biome-ignore lint/suspicious/noExplicitAny: System type varies
export function useTimeTravel(system: System<any>) {
	return system.debug;
}

/**
 * Create an inspect controller.
 *
 * @example
 * ```ts
 * class Inspector extends LitElement {
 *   private inspection = createInspect(this, system);
 * }
 * ```
 */
export function createInspect(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
): InspectController {
	return new InspectController(host, system);
}

/**
 * Create a requirements controller.
 *
 * Provides a focused view of just requirements without full inspection overhead.
 *
 * @example
 * ```ts
 * class LoadingIndicator extends LitElement {
 *   private requirements = createRequirements(this, system);
 *
 *   render() {
 *     if (!this.requirements.value.isWorking) return html``;
 *     return html`<spinner-element></spinner-element>`;
 *   }
 * }
 * ```
 */
export function createRequirements(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
): RequirementsController {
	return new RequirementsController(host, system);
}

/**
 * Create a throttled inspect controller.
 *
 * Limits update frequency to prevent performance issues with high-frequency changes.
 *
 * @param host - The reactive controller host (LitElement)
 * @param system - The Directive system
 * @param throttleMs - Minimum time between updates in milliseconds (default: 100)
 * @returns A throttled inspect controller
 *
 * @example
 * ```ts
 * class Inspector extends LitElement {
 *   private inspection = createInspectThrottled(this, system, 100);
 *
 *   render() {
 *     return html`<div>Unmet: ${this.inspection.value.unmet.length}</div>`;
 *   }
 * }
 * ```
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
 * Create a throttled requirements controller.
 *
 * Limits update frequency to prevent performance issues with high-frequency changes.
 *
 * @param host - The reactive controller host (LitElement)
 * @param system - The Directive system
 * @param throttleMs - Minimum time between updates in milliseconds (default: 100)
 * @returns A throttled requirements controller
 *
 * @example
 * ```ts
 * class LoadingIndicator extends LitElement {
 *   private requirements = createRequirementsThrottled(this, system, 100);
 *
 *   render() {
 *     if (!this.requirements.value.isWorking) return html``;
 *     return html`<spinner-element></spinner-element>`;
 *   }
 * }
 * ```
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
 * Create an is-settled controller.
 *
 * Tracks whether the system has settled (no pending operations).
 *
 * @example
 * ```ts
 * class LoadingIndicator extends LitElement {
 *   private settled = createIsSettled(this, system);
 *
 *   render() {
 *     if (!this.settled.value) return html`<spinner-el></spinner-el>`;
 *     return html`<content-el></content-el>`;
 *   }
 * }
 * ```
 */
export function createIsSettled(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
): IsSettledController {
	return new IsSettledController(host, system);
}

/**
 * Create a requirement status controller.
 *
 * @example
 * ```ts
 * class UserLoader extends LitElement {
 *   private status = createRequirementStatus(this, statusPlugin, 'FETCH_USER');
 * }
 * ```
 */
export function createRequirementStatus(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
	type: string,
): RequirementStatusController {
	return new RequirementStatusController(host, statusPlugin, type);
}

/**
 * Create an is-resolving controller.
 *
 * Simplified version of createRequirementStatus that only tracks resolving state.
 *
 * @example
 * ```ts
 * class SaveButton extends LitElement {
 *   private isSaving = createIsResolving(this, statusPlugin, 'SAVE_DATA');
 *
 *   render() {
 *     return html`
 *       <button ?disabled=${this.isSaving.value}>
 *         ${this.isSaving.value ? 'Saving...' : 'Save'}
 *       </button>
 *     `;
 *   }
 * }
 * ```
 */
export function createIsResolving(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
	type: string,
): IsResolvingController {
	return new IsResolvingController(host, statusPlugin, type);
}

/**
 * Create a latest-error controller.
 *
 * Simplified version of createRequirementStatus that only tracks the last error.
 *
 * @example
 * ```ts
 * class ErrorDisplay extends LitElement {
 *   private error = createLatestError(this, statusPlugin, 'FETCH_USER');
 *
 *   render() {
 *     if (!this.error.value) return html``;
 *     return html`<div class="error">${this.error.value.message}</div>`;
 *   }
 * }
 * ```
 */
export function createLatestError(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
	type: string,
): LatestErrorController {
	return new LatestErrorController(host, statusPlugin, type);
}

/**
 * Create an all-requirement-statuses controller.
 *
 * Returns a controller that tracks all requirement types with their current status.
 * Useful for dashboard/admin UIs that need to show all requirement states.
 *
 * @example
 * ```ts
 * class RequirementsDashboard extends LitElement {
 *   private allStatuses = createAllRequirementStatuses(this, statusPlugin);
 *
 *   render() {
 *     return html`
 *       <ul>
 *         ${Array.from(this.allStatuses.value.entries()).map(([type, status]) => html`
 *           <li>${type}: ${status.isLoading ? 'Loading' : status.hasError ? 'Error' : 'Ready'}</li>
 *         `)}
 *       </ul>
 *     `;
 *   }
 * }
 * ```
 */
export function createAllRequirementStatuses(
	host: ReactiveControllerHost,
	statusPlugin: StatusPlugin,
): AllRequirementStatusesController {
	return new AllRequirementStatusesController(host, statusPlugin);
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
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
	callback: (newValue: T, previousValue: T | undefined) => void,
): WatchController<T> {
	return new WatchController<T>(host, system, derivationId, callback);
}

/**
 * Create a fact selector controller.
 *
 * Only re-renders when the selected value changes.
 *
 * @example
 * ```ts
 * class UserName extends LitElement {
 *   private userName = createFactSelector<User, string>(
 *     this, system, 'user', (u) => u?.name ?? 'Guest'
 *   );
 *
 *   render() {
 *     return html`<span>${this.userName.value}</span>`;
 *   }
 * }
 * ```
 */
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

/**
 * Create a derivation selector controller.
 *
 * Only re-renders when the selected value changes.
 *
 * @example
 * ```ts
 * class StatusLabel extends LitElement {
 *   private statusText = createDerivationSelector<Status, string>(
 *     this, system, 'status', (s) => s?.label ?? 'Unknown'
 *   );
 *
 *   render() {
 *     return html`<span>${this.statusText.value}</span>`;
 *   }
 * }
 * ```
 */
export function createDerivationSelector<T, R>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
	selector: (value: T) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): DerivationSelectorController<T, R> {
	return new DerivationSelectorController<T, R>(host, system, derivationId, selector, equalityFn);
}

/**
 * Create a directive selector controller.
 *
 * Selects across all facts with fine-grained re-rendering.
 *
 * @example
 * ```ts
 * class Summary extends LitElement {
 *   private summary = createDirectiveSelector(
 *     this, system,
 *     (facts) => ({ count: facts.items?.length ?? 0 }),
 *     (a, b) => a.count === b.count
 *   );
 *
 *   render() {
 *     return html`<div>${this.summary.value.count} items</div>`;
 *   }
 * }
 * ```
 */
export function createDirectiveSelector<R>(
	host: ReactiveControllerHost,
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	selector: (facts: Record<string, unknown>) => R,
	equalityFn: (a: R, b: R) => boolean = defaultEquality,
): DirectiveSelectorController<R> {
	return new DirectiveSelectorController<R>(host, system, selector, equalityFn);
}

// ============================================================================
// System Controller (like XState's useActorRef)
// ============================================================================

/** Options for SystemController */
export type SystemControllerOptions<M extends ModuleSchema> =
	| ModuleDef<M>
	| CreateSystemOptionsSingle<M>;

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
export class SystemController<M extends ModuleSchema> implements ReactiveController {
	private options: SystemControllerOptions<M>;
	private _system: System<M> | null = null;

	constructor(host: ReactiveControllerHost, options: SystemControllerOptions<M>) {
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
		// Check if options is a module or system options
		const isModule = "id" in this.options && "schema" in this.options;

		const system = isModule
			? createSystem({ module: this.options as ModuleDef<M> })
			: createSystem(this.options as CreateSystemOptionsSingle<M>);

		// Cast to System<M> - the underlying type matches
		this._system = system as unknown as System<M>;
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
 * Create a derivation value getter (non-reactive).
 *
 * WARNING: This returns a getter function that reads the current value on each call.
 * It does NOT trigger re-renders when the value changes. For reactive updates in
 * LitElement, use {@link DerivationController} instead.
 *
 * @see {@link DerivationController} for reactive class-based usage
 *
 * @example
 * ```ts
 * const getIsRed = getDerivation<boolean>(system, 'isRed');
 * console.log(getIsRed()); // Get current value (non-reactive)
 * ```
 */
export function getDerivation<T>(
	// biome-ignore lint/suspicious/noExplicitAny: System type varies
	system: System<any>,
	derivationId: string,
): () => T {
	return () => system.read(derivationId) as T;
}

/**
 * Create a fact value getter (non-reactive).
 *
 * WARNING: This returns a getter function that reads the current value on each call.
 * It does NOT trigger re-renders when the value changes. For reactive updates in
 * LitElement, use {@link FactController} instead.
 *
 * @see {@link FactController} for reactive class-based usage
 *
 * @returns A getter function that returns the current fact value, or undefined if not set
 *
 * @example
 * ```ts
 * const getPhase = getFact<string>(system, 'phase');
 * console.log(getPhase()); // Get current value (non-reactive)
 * ```
 */
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

/**
 * Create typed controllers and helpers for a specific system schema.
 *
 * This provides better type inference than the generic controllers.
 *
 * @example
 * ```ts
 * import { createTypedHooks } from 'directive/lit';
 *
 * // Define your schema
 * const schema = {
 *   facts: { count: t.number(), user: t.any<User | null>() },
 *   derivations: { doubled: t.number() },
 *   events: { increment: {}, setUser: { user: t.any<User>() } },
 *   requirements: {},
 * } satisfies ModuleSchema;
 *
 * // Create typed hooks
 * const { createDerivation, createFact, useDispatch } = createTypedHooks<typeof schema>();
 *
 * class Counter extends LitElement {
 *   private count = createFact(this, system, "count"); // Type: FactController<number>
 *   private doubled = createDerivation(this, system, "doubled"); // Type: DerivationController<number>
 * }
 * ```
 */
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
	};
}

/**
 * Devtools Plugin - Browser devtools integration
 *
 * Exposes the system to browser devtools via window.__DIRECTIVE__
 */

import type { Plugin, ModuleSchema, System } from "../core/types.js";

export interface DevtoolsPluginOptions {
	/** Name for this system in devtools */
	name?: string;
	/** Enable trace logging */
	trace?: boolean;
}

interface DevtoolsState<M extends ModuleSchema> {
	system: System<M> | null;
	events: Array<{ timestamp: number; type: string; data: unknown }>;
	maxEvents: number;
}

declare global {
	interface Window {
		__DIRECTIVE__?: {
			systems: Map<string, DevtoolsState<ModuleSchema>>;
			getSystem(name?: string): System<ModuleSchema> | null;
			getSystems(): string[];
			inspect(name?: string): unknown;
			getEvents(name?: string): Array<{ timestamp: number; type: string; data: unknown }>;
		};
	}
}

/**
 * Initialize global devtools object.
 */
function initDevtools(): NonNullable<Window["__DIRECTIVE__"]> {
	if (typeof window === "undefined") {
		// Return no-op for non-browser environments
		return {
			systems: new Map(),
			getSystem: () => null,
			getSystems: () => [],
			inspect: () => null,
			getEvents: () => [],
		};
	}

	if (!window.__DIRECTIVE__) {
		const systems = new Map<string, DevtoolsState<ModuleSchema>>();

		window.__DIRECTIVE__ = {
			systems,
			getSystem(name) {
				if (name) {
					return systems.get(name)?.system ?? null;
				}
				// Return first system if no name specified
				const first = systems.values().next().value;
				return first?.system ?? null;
			},
			getSystems() {
				return [...systems.keys()];
			},
			inspect(name) {
				const system = this.getSystem(name);
				return system?.inspect() ?? null;
			},
			getEvents(name) {
				if (name) {
					return systems.get(name)?.events ?? [];
				}
				const first = systems.values().next().value;
				return first?.events ?? [];
			},
		};
	}

	return window.__DIRECTIVE__;
}

/**
 * Create a devtools plugin.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [devtoolsPlugin({ name: "my-app" })],
 * });
 *
 * // In browser console:
 * // __DIRECTIVE__.inspect()
 * // __DIRECTIVE__.getEvents()
 * ```
 */
export function devtoolsPlugin<M extends ModuleSchema = ModuleSchema>(
	options: DevtoolsPluginOptions = {},
): Plugin<M> {
	const { name = "default", trace = false } = options;

	const devtools = initDevtools();
	const state: DevtoolsState<M> = {
		system: null,
		events: [],
		maxEvents: 1000,
	};

	devtools.systems.set(name, state as DevtoolsState<ModuleSchema>);

	const addEvent = (type: string, data: unknown) => {
		if (!trace) return;

		state.events.push({
			timestamp: Date.now(),
			type,
			data,
		});

		// Keep events bounded
		if (state.events.length > state.maxEvents) {
			state.events.shift();
		}
	};

	return {
		name: "devtools",

		onInit: (system) => {
			state.system = system;
			addEvent("init", {});

			if (typeof window !== "undefined") {
				console.log(
					`%c[Directive Devtools]%c System "${name}" initialized. Access via window.__DIRECTIVE__`,
					"color: #7c3aed; font-weight: bold",
					"color: inherit",
				);
			}
		},

		onStart: () => addEvent("start", {}),
		onStop: () => addEvent("stop", {}),

		onDestroy: () => {
			addEvent("destroy", {});
			devtools.systems.delete(name);
		},

		onFactSet: (key, value, prev) => {
			addEvent("fact.set", { key, value, prev });
		},

		onFactsBatch: (changes) => {
			addEvent("facts.batch", { changes });
		},

		onReconcileStart: () => {
			addEvent("reconcile.start", {});
		},

		onReconcileEnd: (result) => {
			addEvent("reconcile.end", result);
		},

		onConstraintEvaluate: (id, active) => {
			addEvent("constraint.evaluate", { id, active });
		},

		onRequirementCreated: (req) => {
			addEvent("requirement.created", { id: req.id, type: req.requirement.type });
		},

		onRequirementMet: (req, byResolver) => {
			addEvent("requirement.met", { id: req.id, byResolver });
		},

		onResolverStart: (resolver, req) => {
			addEvent("resolver.start", { resolver, requirementId: req.id });
		},

		onResolverComplete: (resolver, req, duration) => {
			addEvent("resolver.complete", { resolver, requirementId: req.id, duration });
		},

		onResolverError: (resolver, req, error) => {
			addEvent("resolver.error", { resolver, requirementId: req.id, error: String(error) });
		},

		onSnapshot: (snapshot) => {
			addEvent("timetravel.snapshot", { id: snapshot.id, trigger: snapshot.trigger });
		},

		onTimeTravel: (from, to) => {
			addEvent("timetravel.jump", { from, to });
		},

		onError: (error) => {
			addEvent("error", { source: error.source, sourceId: error.sourceId, message: error.message });
		},
	};
}

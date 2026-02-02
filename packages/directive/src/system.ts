/**
 * System - The top-level API for creating a Directive runtime
 *
 * A system combines modules with plugins and configuration.
 */

import { createEngine } from "./engine.js";
import type {
	DebugConfig,
	DerivationsDef,
	ErrorBoundaryConfig,
	ModuleDef,
	Plugin,
	Schema,
	System,
} from "./types.js";

// ============================================================================
// System Configuration
// ============================================================================

/** Options for createSystem */
export interface CreateSystemOptions<S extends Schema> {
	/** Modules to include in the system */
	modules: Array<ModuleDef<S, DerivationsDef<S>>>;
	/** Plugins to register */
	plugins?: Array<Plugin<S>>;
	/** Debug configuration */
	debug?: DebugConfig;
	/** Error boundary configuration */
	errorBoundary?: ErrorBoundaryConfig;
	/**
	 * Tick interval for time-based systems (ms).
	 *
	 * When set, automatically dispatches `{ type: "tick" }` events at this interval
	 * after `system.start()` is called. The interval is cleared when `system.stop()`
	 * is called.
	 *
	 * Define a handler in your module's `events` property to respond to tick events.
	 *
	 * @example
	 * ```typescript
	 * const module = createModule("timer", {
	 *   schema: { elapsed: t.number() },
	 *   init: (facts) => { facts.elapsed = 0; },
	 *   events: {
	 *     tick: (facts) => { facts.elapsed += 1; },
	 *   },
	 * });
	 *
	 * const system = createSystem({
	 *   modules: [module],
	 *   tickMs: 1000, // Dispatch { type: "tick" } every second
	 * });
	 * ```
	 */
	tickMs?: number;
	/**
	 * Enable zero-config mode with sensible defaults.
	 *
	 * When true, automatically enables:
	 * - Time-travel debugging in development (process.env.NODE_ENV !== 'production')
	 * - Skip recovery strategy for errors (prevents cascading failures)
	 *
	 * @default false
	 */
	zeroConfig?: boolean;
}

/**
 * Create a Directive system.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [trafficLight],
 *   plugins: [loggingPlugin(), devtoolsPlugin()],
 *   debug: { timeTravel: true, maxSnapshots: 100 },
 * });
 *
 * system.start();
 * ```
 *
 * @example Zero-config mode
 * ```ts
 * // Enable sensible defaults for development
 * const system = createSystem({
 *   modules: [myModule],
 *   zeroConfig: true, // Enables time-travel in dev, skip recovery for errors
 * });
 * ```
 */
export function createSystem<S extends Schema>(
	options: CreateSystemOptions<S>,
): System<S> {
	// Apply zero-config defaults if enabled
	let debug = options.debug;
	let errorBoundary = options.errorBoundary;

	if (options.zeroConfig) {
		const isDev = process.env.NODE_ENV !== "production";

		// Enable time-travel in development by default
		debug = {
			timeTravel: isDev,
			maxSnapshots: 100,
			...options.debug,
		};

		// Use skip recovery strategy by default (prevents cascading failures)
		errorBoundary = {
			onConstraintError: "skip",
			onResolverError: "skip",
			onEffectError: "skip",
			onDerivationError: "skip",
			...options.errorBoundary,
		};
	}

	const engine = createEngine({
		modules: options.modules,
		plugins: options.plugins,
		debug,
		errorBoundary,
		tickMs: options.tickMs,
	});

	// If tickMs is specified, wrap the system with tick interval management
	if (options.tickMs && options.tickMs > 0) {
		let tickInterval: ReturnType<typeof setInterval> | null = null;
		const tickMs = options.tickMs;

		// Create wrapper that composes tick behavior
		const system: System<S> = {
			facts: engine.facts,
			debug: engine.debug,

			start(): void {
				engine.start();
				tickInterval = setInterval(() => {
					engine.dispatch({ type: "tick" });
				}, tickMs);
			},

			stop(): void {
				if (tickInterval) {
					clearInterval(tickInterval);
					tickInterval = null;
				}
				engine.stop();
			},

			destroy(): void {
				this.stop();
				engine.destroy();
			},

			dispatch: engine.dispatch.bind(engine),
			read: engine.read.bind(engine),
			subscribe: engine.subscribe.bind(engine),
			watch: engine.watch.bind(engine),
			inspect: engine.inspect.bind(engine),
			settle: engine.settle.bind(engine),
			explain: engine.explain.bind(engine),
		};

		return system;
	}

	return engine;
}

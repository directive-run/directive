/**
 * System - The top-level API for creating a Directive runtime
 *
 * A system combines modules with plugins and configuration.
 */

import { createEngine } from "./engine.js";
import type {
	DebugConfig,
	ErrorBoundaryConfig,
	ModuleDef,
	ModuleSchema,
	Plugin,
	System,
} from "./types.js";

// ============================================================================
// System Configuration
// ============================================================================

/** Options for createSystem */
export interface CreateSystemOptions<M extends ModuleSchema> {
	/** Modules to include in the system */
	modules: Array<ModuleDef<M>>;
	/** Plugins to register */
	// biome-ignore lint/suspicious/noExplicitAny: Plugins are schema-agnostic
	plugins?: Array<Plugin<any>>;
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
	 *   schema: {
	 *     facts: { elapsed: t.number() },
	 *     derivations: {},
	 *     events: { tick: {} },
	 *     requirements: {},
	 *   },
	 *   init: (facts) => { facts.elapsed = 0; },
	 *   derive: {},
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
 * Create a Directive system with full type inference.
 *
 * The consolidated schema provides:
 * - Derivation composition (`derive.otherDerivation` is typed)
 * - Event dispatch (`system.dispatch({ type: "..." })` has autocomplete)
 * - Resolver requirements (`req.payload` is typed based on requirement type)
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [trafficLight],
 *   plugins: [loggingPlugin()],
 *   debug: { timeTravel: true },
 * });
 *
 * system.start();
 * system.dispatch({ type: "tick" }); // Fully typed from schema.events
 * const isRed = system.derive.isRed; // Typed as boolean from schema.derivations
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
export function createSystem<const M extends ModuleSchema>(
	options: CreateSystemOptions<M>,
): System<M> {
	// Validate tickMs if provided
	if (options.tickMs !== undefined && options.tickMs <= 0) {
		throw new Error("[Directive] tickMs must be a positive number");
	}

	// Dev-mode warning: tickMs set without tick event handler
	if (process.env.NODE_ENV !== "production" && options.tickMs && options.tickMs > 0) {
		const hasTickHandler = options.modules.some(
			(m) => m.events && "tick" in m.events,
		);
		if (!hasTickHandler) {
			console.warn(
				`[Directive] tickMs is set to ${options.tickMs}ms but no module defines a "tick" event handler. ` +
					`The system will dispatch { type: "tick" } events but they will be ignored. ` +
					`Add a tick handler to one of your modules, or remove tickMs if not needed.`,
			);
		}
	}

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

	// Convert ModuleDef to the engine's expected format
	// The engine internally works with flat schema format, so we transform
	// the consolidated schema to extract facts and requirements
	const engineModules = options.modules.map((mod) => ({
		id: mod.id,
		// Extract facts schema from consolidated schema
		schema: mod.schema.facts,
		// Extract requirements schema (for typed resolvers)
		requirements: mod.schema.requirements,
		init: mod.init,
		derive: mod.derive,
		events: mod.events,
		effects: mod.effects,
		constraints: mod.constraints,
		resolvers: mod.resolvers,
		hooks: mod.hooks,
	}));

	const engine = createEngine({
		// biome-ignore lint/suspicious/noExplicitAny: Module format conversion
		modules: engineModules as any,
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
		const system: System<M> = {
			facts: engine.facts,
			debug: engine.debug,
			derive: engine.derive,
			events: engine.events,

			get isRunning() {
				return engine.isRunning;
			},

			get isSettled() {
				return engine.isSettled;
			},

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
			getSnapshot: engine.getSnapshot.bind(engine),
			restore: engine.restore.bind(engine),
			batch: engine.batch.bind(engine),
		// biome-ignore lint/suspicious/noExplicitAny: Type narrowing for System
		} as any;

		return system;
	}

	// biome-ignore lint/suspicious/noExplicitAny: Type narrowing for System
	return engine as any;
}

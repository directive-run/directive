/**
 * System Builder API
 *
 * Fluent builder for creating Directive systems.
 *
 * @example Single module
 * ```typescript
 * import { system } from 'directive';
 *
 * const sys = system()
 *   .module(counterModule)
 *   .plugins([loggingPlugin()])
 *   .debug({ timeTravel: true })
 *   .build();
 * ```
 *
 * @example Multiple modules
 * ```typescript
 * const sys = system()
 *   .modules({ auth: authModule, cart: cartModule })
 *   .plugins([loggingPlugin()])
 *   .build();
 * ```
 */

import { createSystem } from "./system.js";
import type {
	ModuleSchema,
	ModuleDef,
	ModulesMap,
	Plugin,
	DebugConfig,
	ErrorBoundaryConfig,
	InferFacts,
	ExtractSchema,
	SingleModuleSystem,
	NamespacedSystem,
} from "./types.js";

// ============================================================================
// Builder Types
// ============================================================================

/** Initial builder — must choose .module() or .modules() */
export interface SystemBuilderStart {
	module<S extends ModuleSchema>(mod: ModuleDef<S>): SingleModuleSystemBuilder<S>;
	modules<const Modules extends ModulesMap>(mods: Modules): NamespacedSystemBuilder<Modules>;
}

/** Builder for single-module system */
export interface SingleModuleSystemBuilder<S extends ModuleSchema> {
	plugins(plugins: Array<Plugin<ModuleSchema>>): SingleModuleSystemBuilder<S>;
	debug(config: DebugConfig): SingleModuleSystemBuilder<S>;
	errorBoundary(config: ErrorBoundaryConfig): SingleModuleSystemBuilder<S>;
	tickMs(ms: number): SingleModuleSystemBuilder<S>;
	zeroConfig(enabled?: boolean): SingleModuleSystemBuilder<S>;
	initialFacts(facts: Partial<InferFacts<S>>): SingleModuleSystemBuilder<S>;
	build(): SingleModuleSystem<S>;
}

/** Builder for namespaced multi-module system */
export interface NamespacedSystemBuilder<Modules extends ModulesMap> {
	plugins(plugins: Array<Plugin<ModuleSchema>>): NamespacedSystemBuilder<Modules>;
	debug(config: DebugConfig): NamespacedSystemBuilder<Modules>;
	errorBoundary(config: ErrorBoundaryConfig): NamespacedSystemBuilder<Modules>;
	tickMs(ms: number): NamespacedSystemBuilder<Modules>;
	zeroConfig(enabled?: boolean): NamespacedSystemBuilder<Modules>;
	initialFacts(facts: Partial<{
		[K in keyof Modules]: Partial<InferFacts<ExtractSchema<Modules[K]>>>;
	}>): NamespacedSystemBuilder<Modules>;
	initOrder(order: "auto" | "declaration" | Array<keyof Modules & string>): NamespacedSystemBuilder<Modules>;
	build(): NamespacedSystem<Modules>;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a system using the fluent builder pattern.
 * Choose `.module()` for single-module or `.modules()` for namespaced.
 *
 * @example
 * ```typescript
 * const sys = system()
 *   .module(counterModule)
 *   .plugins([loggingPlugin()])
 *   .build();
 * ```
 */
export function system(): SystemBuilderStart {
	return {
		module<S extends ModuleSchema>(mod: ModuleDef<S>): SingleModuleSystemBuilder<S> {
			return createSingleBuilder<S>(mod);
		},
		modules<const Modules extends ModulesMap>(mods: Modules): NamespacedSystemBuilder<Modules> {
			return createNamespacedBuilder<Modules>(mods);
		},
	};
}

function createSingleBuilder<S extends ModuleSchema>(
	mod: ModuleDef<S>,
): SingleModuleSystemBuilder<S> {
	let _plugins: Array<Plugin<ModuleSchema>> | undefined;
	let _debug: DebugConfig | undefined;
	let _errorBoundary: ErrorBoundaryConfig | undefined;
	let _tickMs: number | undefined;
	let _zeroConfig: boolean | undefined;
	let _initialFacts: Partial<InferFacts<S>> | undefined;

	const builder: SingleModuleSystemBuilder<S> = {
		plugins(plugins) {
			_plugins = plugins;
			return builder;
		},
		debug(config) {
			_debug = config;
			return builder;
		},
		errorBoundary(config) {
			_errorBoundary = config;
			return builder;
		},
		tickMs(ms) {
			_tickMs = ms;
			return builder;
		},
		zeroConfig(enabled = true) {
			_zeroConfig = enabled;
			return builder;
		},
		initialFacts(facts) {
			_initialFacts = facts;
			return builder;
		},
		build(): SingleModuleSystem<S> {
			return createSystem<S>({
				module: mod,
				plugins: _plugins,
				debug: _debug,
				errorBoundary: _errorBoundary,
				tickMs: _tickMs,
				zeroConfig: _zeroConfig,
				initialFacts: _initialFacts,
			});
		},
	};

	return builder;
}

function createNamespacedBuilder<Modules extends ModulesMap>(
	mods: Modules,
): NamespacedSystemBuilder<Modules> {
	let _plugins: Array<Plugin<ModuleSchema>> | undefined;
	let _debug: DebugConfig | undefined;
	let _errorBoundary: ErrorBoundaryConfig | undefined;
	let _tickMs: number | undefined;
	let _zeroConfig: boolean | undefined;
	// biome-ignore lint/suspicious/noExplicitAny: Partial namespaced facts typing
	let _initialFacts: any;
	let _initOrder: "auto" | "declaration" | Array<keyof Modules & string> | undefined;

	const builder: NamespacedSystemBuilder<Modules> = {
		plugins(plugins) {
			_plugins = plugins;
			return builder;
		},
		debug(config) {
			_debug = config;
			return builder;
		},
		errorBoundary(config) {
			_errorBoundary = config;
			return builder;
		},
		tickMs(ms) {
			_tickMs = ms;
			return builder;
		},
		zeroConfig(enabled = true) {
			_zeroConfig = enabled;
			return builder;
		},
		initialFacts(facts) {
			_initialFacts = facts;
			return builder;
		},
		initOrder(order) {
			_initOrder = order;
			return builder;
		},
		build(): NamespacedSystem<Modules> {
			return createSystem<Modules>({
				modules: mods,
				plugins: _plugins,
				debug: _debug,
				errorBoundary: _errorBoundary,
				tickMs: _tickMs,
				zeroConfig: _zeroConfig,
				initialFacts: _initialFacts,
				initOrder: _initOrder,
			});
		},
	};

	return builder;
}

/**
 * System with Status Plugin Helper
 *
 * Convenience function for creating a system with status tracking enabled.
 */

import { createSystem } from "../core/system.js";
import type {
  DebugConfig,
  ErrorBoundaryConfig,
  ModuleDef,
  ModuleSchema,
  Plugin,
  SingleModuleSystem,
} from "../core/types.js";
import { createRequirementStatusPlugin } from "./requirement-status.js";

/** Options for createSystemWithStatus */
export interface CreateSystemWithStatusOptions<M extends ModuleSchema> {
  /** The module to use for the system */
  module: ModuleDef<M>;
  /** Additional plugins to include alongside the status plugin */
  // biome-ignore lint/suspicious/noExplicitAny: Plugin generic contravariance issues
  plugins?: Plugin<any>[];
  /** Debug configuration */
  debug?: DebugConfig;
  /** Error boundary configuration */
  errorBoundary?: ErrorBoundaryConfig;
  /** Tick interval in milliseconds */
  tickMs?: number;
  /** Enable zero-config mode */
  zeroConfig?: boolean;
  /** Initial facts to set on the system */
  // biome-ignore lint/suspicious/noExplicitAny: Facts type varies by module
  initialFacts?: Record<string, any>;
}

/** Return type for createSystemWithStatus */
export interface SystemWithStatus<M extends ModuleSchema> {
  /**
   * The Directive system instance.
   * This is a SingleModuleSystem - use system.facts, system.dispatch(), etc.
   */
  system: SingleModuleSystem<M>;
  /** The status plugin for use with useRequirementStatus hooks */
  statusPlugin: ReturnType<typeof createRequirementStatusPlugin>;
}

/**
 * Create a Directive system with a status plugin pre-configured.
 *
 * This is a convenience wrapper around `createSystem` and `createRequirementStatusPlugin`
 * that handles the wiring automatically. The status plugin is added to the system's
 * plugins array so it receives lifecycle events.
 *
 * @param options - System configuration options
 * @returns An object containing both the system and the statusPlugin
 *
 * @example
 * ```tsx
 * import { createSystemWithStatus } from '@directive-run/core';
 * import { useRequirementStatus, useFact } from '@directive-run/react';
 *
 * // Simple setup - no provider needed
 * const { system, statusPlugin } = createSystemWithStatus({
 *   module: myModule,
 * });
 * system.start();
 *
 * function App() {
 *   const data = useFact(system, "data");
 *   return <LoadingIndicator />;
 * }
 *
 * function LoadingIndicator() {
 *   const status = useRequirementStatus(statusPlugin, "FETCH_DATA");
 *   if (status.isLoading) return <Spinner />;
 *   if (status.hasError) return <Error message={status.lastError?.message} />;
 *   return <Content />;
 * }
 * ```
 */
export function createSystemWithStatus<M extends ModuleSchema>(
  options: CreateSystemWithStatusOptions<M>,
): SystemWithStatus<M> {
  // Create the status plugin
  const statusPlugin = createRequirementStatusPlugin();

  // Add the plugin to the options
  const existingPlugins = options.plugins ?? [];

  // Create the system with the status plugin included
  // Use type assertion to bypass overload resolution issues
  // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
  const allPlugins = [...existingPlugins, statusPlugin.plugin] as Plugin<any>[];
  // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
  const system = createSystem({
    module: options.module,
    plugins: allPlugins,
    debug: options.debug,
    errorBoundary: options.errorBoundary,
    tickMs: options.tickMs,
    zeroConfig: options.zeroConfig,
    initialFacts: options.initialFacts,
    // biome-ignore lint/suspicious/noExplicitAny: Required for overload compatibility
  } as any);

  return {
    // The system returned by createSystem with a single module is a SingleModuleSystem
    system: system as SingleModuleSystem<M>,
    statusPlugin,
  };
}

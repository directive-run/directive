/**
 * createQueryModule — Convenience wrapper for withQueries + createModule.
 *
 * Combines query/mutation/subscription definitions and a module config
 * into a ModuleDef in one call. The returned module works in both
 * single-module and multi-module (namespaced) systems.
 *
 * @module
 */

import { createModule } from "@directive-run/core";
import type {
  ModuleConfig,
  ModuleDef,
  ModuleSchema,
} from "@directive-run/core";
import { withQueries } from "./with-queries.js";
import type { AnyQueryDefinition } from "./with-queries.js";

/**
 * Create a module with query/mutation/subscription definitions merged in.
 *
 * @param id - Module identifier (used as namespace in multi-module systems)
 * @param definitions - Array of query, mutation, subscription, or infinite query definitions
 * @param config - Module config (schema, init, events, etc.)
 * @returns A standard ModuleDef that works in any Directive system
 *
 * @example
 * ```typescript
 * const dataModule = createQueryModule("data", [userQuery, updateMutation], {
 *   schema: { facts: { userId: t.string() } },
 *   init: (facts) => { facts.userId = ""; },
 * });
 *
 * // Single-module system
 * const system = createSystem({ module: dataModule });
 *
 * // Multi-module system
 * const system = createSystem({ modules: { data: dataModule, auth: authModule } });
 * ```
 */
export function createQueryModule<const M extends ModuleSchema>(
  id: string,
  definitions: AnyQueryDefinition[],
  config: ModuleConfig<M>,
): ModuleDef<M> {
  // biome-ignore lint/suspicious/noExplicitAny: withQueries returns untyped config, cast back to preserve M
  const merged = withQueries(definitions, config as any);

  return createModule(id, merged as ModuleConfig<M>);
}

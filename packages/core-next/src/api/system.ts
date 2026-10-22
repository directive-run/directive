/**
 * The 1.35 `createSystem`: the system core (core.ts) on its own kernel with
 * every L0 part wired in. Each part is its own module and plugs in through
 * the kernel's feature registry, so a system built from the core without
 * them (`createSystemCore` in core.ts) bundles none of them.
 */

import isDevelopment from "#is-development";
import { type ErrorSource, type SystemPart, createSystemCore } from "./core.js";
import { withEffects } from "./effects.js";
import { withInspect } from "./inspect.js";
import { createNamespacedSystem } from "./namespaced.js";
import { withObserve } from "./observe.js";
import { withPlugins } from "./plugins.js";
import type { ModuleSchema, System, SystemOptions } from "./types.js";
import { withValidation } from "./validate.js";

export { DirectiveError } from "./core.js";
export { createModule, createModuleFactory } from "./module.js";
export type { ErrorSource };

export function createSystem<const M extends ModuleSchema>(
  options: SystemOptions<M>,
): System<M> {
  const parts: SystemPart[] = [
    withEffects,
    withInspect,
    withObserve,
    // Last: its onInit pass starts once the system is complete.
    withPlugins(options.plugins),
  ];
  if (isDevelopment) {
    // Writes are checked in development only, so production drops the part.
    parts.unshift(withValidation);
  }

  if (!options || (!("module" in options) && !("modules" in options))) {
    throw new Error(
      "[Directive] createSystem requires either `{ module }` (single-module form) or `{ modules: { name: module } }` (namespaced form). Got an options object with neither.",
    );
  }
  if ("module" in options) {
    return createSystemCore(options, parts);
  }
  const modules = options.modules as Record<string, unknown>;
  if (Array.isArray(modules)) {
    throw new Error(
      "[Directive] createSystem expects modules as an object, not an array.\n\nInstead of:\n  createSystem({ modules: [authModule, dataModule] })\n\nUse:\n  createSystem({ modules: { auth: authModule, data: dataModule } })\n\nOr for a single module:\n  createSystem({ module: counterModule })",
    );
  }
  if (modules && typeof modules === "object" && "id" in modules && "schema" in modules) {
    throw new Error(
      "[Directive] A single module was passed to `modules:`. For a single module, use `module:` instead:\n\n  createSystem({ module: myModule })\n\nFor multiple modules, wrap in an object:\n  createSystem({ modules: { myName: myModule } })",
    );
  }

  return createNamespacedSystem(options, parts) as System<M>;
}

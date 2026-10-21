/**
 * The 1.35 `createSystem`: the system core (core.ts) on its own kernel with
 * every L0 part wired in. Each part is its own module and plugs in through
 * the kernel's feature registry, so a system built from the core without
 * them (`createSystemCore` in core.ts) bundles none of them.
 */

import { type ErrorSource, createSystemCore } from "./core.js";
import { withEffects } from "./effects.js";
import { withInspect } from "./inspect.js";
import { withObserve } from "./observe.js";
import { withPlugins } from "./plugins.js";
import type { ModuleSchema, System, SystemOptions } from "./types.js";
import { withValidation } from "./validate.js";

export { DirectiveError, createModule } from "./core.js";
export type { ErrorSource };

export function createSystem<const M extends ModuleSchema>(
  options: SystemOptions<M>,
): System<M> {
  return createSystemCore(options, [
    withValidation,
    withEffects,
    withInspect,
    withObserve,
    // Last: its onInit pass starts once the system is complete.
    withPlugins(options.plugins),
  ]);
}

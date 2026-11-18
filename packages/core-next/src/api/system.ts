/**
 * The 1.35 `createSystem`: the system core (core.ts) on its own kernel with
 * every L0 part wired in. Each part is its own module and plugs in through
 * the kernel's feature registry, so a system built from the core without
 * them (`createSystemCore` in core.ts) bundles none of them.
 */

import isDevelopment from "#is-development";
import type {
  CreateSystemOptionsNamed,
  CreateSystemOptionsSingle,
  ModuleSchema as ModuleSchema135,
  ModulesMap,
  NamespacedSystem,
  SingleModuleSystem,
} from "../types/index.js";
import { withBatch } from "./batch.js";
import {
  type ErrorSource,
  type SystemPart,
  checkTick,
  createSystemCore,
} from "./core.js";
import { withDefaults } from "./defaults.js";
import { withDynamic } from "./dynamic.js";
import { withEffects } from "./effects.js";
import { type ErrorBoundaryConfig, withErrorBoundary } from "./errors.js";
import { withHistory } from "./history.js";
import { withInspect } from "./inspect.js";
import { withMeta } from "./meta.js";
import { withMissing } from "./missing.js";
import { createNamespacedSystem } from "./namespaced.js";
import { withObserve } from "./observe.js";
import { withPlugins } from "./plugins.js";
import { withPredicates } from "./predicate.js";
import { withReconcile } from "./reconcile.js";
import { withRestore } from "./restore.js";
import { withSources } from "./sources.js";
import { withTrace } from "./trace.js";
import type { ModuleSchema, System, SystemOptions } from "./types.js";
import { withValidation } from "./validate.js";

export { DirectiveError } from "./core.js";
export { createModule, createModuleFactory } from "./module.js";
export type { ErrorSource };

/**
 * The public signatures are 1.35's two overloads, on 1.35's types (src/types/,
 * copied from 1.35): `{ module }` gives a SingleModuleSystem, `{ modules }` a
 * NamespacedSystem (`system.facts.auth.token`).
 *
 * Declared with 1.35's types but not built yet: the dynamic `constraints`/`resolvers`/`effects` controls,
 * `registerModule`/`unregisterModule` and the distributable snapshot calls
 * throw `featureMissing` (api/missing.ts, slice P3-F3).
 */
export function createSystem<S extends ModuleSchema135>(
  options: CreateSystemOptionsSingle<S>,
): SingleModuleSystem<S>;
export function createSystem<const Modules extends ModulesMap>(
  options: CreateSystemOptionsNamed<Modules>,
): NamespacedSystem<Modules>;
/**
 * @internal The implementation, on core-next's own types (api/types.ts).
 * `O` erases to `any` and `object` is a supertype of both overloads' returns,
 * which is what lets 1.35's overloads sit on it unchanged.
 */
export function createSystem<
  const M extends ModuleSchema,
  O extends SystemOptions<M> = SystemOptions<M>,
>(options: O): object {
  if (!options || (!("module" in options) && !("modules" in options))) {
    throw new Error(
      "[Directive] createSystem requires either `{ module }` (single-module form) or `{ modules: { name: module } }` (namespaced form). Got an options object with neither.",
    );
  }
  // 1.35's zeroConfig turns history on in development when no option is
  // given (system.ts:926–933).
  const history = options.zeroConfig
    ? (options.history ?? isDevelopment)
    : options.history;
  const parts: SystemPart[] = [
    // L11: first, so the parts after it read its hooks at registration.
    withPredicates,
    // L9a: every 1.35 system has `meta`; it freezes the definitions' meta.
    withMeta,
    withEffects,
    // L7a: a resolver's `batch:` option needs no import (A1); before the
    // resolvers, which take its window from the context.
    withBatch,
    // L2: constraints -> requirements -> resolvers.
    withReconcile,
    withInspect,
    withObserve,
    // L5: in the alpha a module's `sources:` key needs no import (A1).
    withSources,
    // L6: restore() is on every 1.35 system, with no import (B6).
    withRestore,
    // L6c: `.default()` fills facts still undefined after initialize ((al)).
    withDefaults,
    // L8: the `history:` option needs no import (A1, O1).
    withHistory(history as never),
    // L10a: register, assign, unregister and call on the four kinds; every
    // 1.35 system has them.
    withDynamic,
    // 1.35 members 2.0 has not built: they throw featureMissing (P3-F3).
    withMissing,
    // Its onInit pass starts once the system is complete.
    withPlugins(options.plugins),
    // L9b: after the plugins, so `onTraceComplete` follows the hook that
    // settled the run. Off, it subscribes to nothing.
    withTrace(options.trace as never),
  ];
  if (isDevelopment) {
    // Writes are checked in development only, so production drops the part.
    parts.unshift(withValidation);
    // 1.35's snapshotModules checks (system.ts:271–280, 1116–1122).
    const listed = (options.history as { snapshotModules?: string[] })
      ?.snapshotModules;
    if (listed && "module" in options) {
      console.warn(
        "[Directive] history.snapshotModules has no effect in single-module mode. Use history.snapshotEvents on the module definition instead, or switch to createSystem({ modules: { ... } }) for multi-module filtering.",
      );
    } else if (listed) {
      const names = Object.keys(options.modules as object);
      for (const name of listed) {
        if (!names.includes(name)) {
          console.warn(
            `[Directive] history.snapshotModules entry "${name}" doesn't match any module. Available modules: ${names.join(", ")}`,
          );
        }
      }
    }
  }
  // 1.35's zeroConfig sets the four sources to skip; an explicit
  // errorBoundary wins. Without either, the core skips every error.
  const boundary: ErrorBoundaryConfig | undefined = options.zeroConfig
    ? {
        onConstraintError: "skip",
        onResolverError: "skip",
        onEffectError: "skip",
        onDerivationError: "skip",
        ...options.errorBoundary,
      }
    : options.errorBoundary;
  if (boundary) {
    parts.unshift(withErrorBoundary(boundary));
  }

  if ("module" in options) {
    const m = options.module as Record<string, any>;
    // L10: what a running system registers goes in its own maps, not the
    // module's, which another system may share.
    return createSystemCore(
      {
        ...options,
        module: m && {
          ...m,
          schema: { ...m.schema, facts: { ...m.schema?.facts } },
          hooks_: m.hooks ? [m.hooks] : [],
          derive: { ...m.derive },
          events: { ...m.events },
          effects: { ...m.effects },
          sources: { ...m.sources },
          constraints: { ...m.constraints },
          resolvers: { ...m.resolvers },
        },
      } as never,
      parts,
    );
  }
  const modules = options.modules as Record<string, unknown>;
  if (Array.isArray(modules)) {
    throw new Error(
      "[Directive] createSystem expects modules as an object, not an array.\n\nInstead of:\n  createSystem({ modules: [authModule, dataModule] })\n\nUse:\n  createSystem({ modules: { auth: authModule, data: dataModule } })\n\nOr for a single module:\n  createSystem({ module: counterModule })",
    );
  }
  if (
    modules &&
    typeof modules === "object" &&
    "id" in modules &&
    "schema" in modules
  ) {
    throw new Error(
      "[Directive] A single module was passed to `modules:`. For a single module, use `module:` instead:\n\n  createSystem({ module: myModule })\n\nFor multiple modules, wrap in an object:\n  createSystem({ modules: { myName: myModule } })",
    );
  }

  checkTick(options.tickMs);

  return createNamespacedSystem(options, parts, !!history) as System<M>;
}

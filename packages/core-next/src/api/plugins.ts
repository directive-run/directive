/**
 * The 1.35 plugin manager, as a system part. Plugins are called from the
 * kernel's event stream: the system emits one record per occurrence
 * (`fact.set`, `effect.run`, …) and this part maps each record to its 1.35
 * hook, calling every plugin in registration order and logging (never
 * rethrowing) a plugin's error. It listens only while a plugin is
 * registered, so a system with none builds no records.
 */

import type { KernelEvent } from "../kernel.js";
import type { SystemPart } from "./core.js";
import type { Plugin } from "./types.js";

/** A plugin that takes the raw record instead of a 1.35 hook (observers). */
export interface StreamPlugin extends Plugin {
  event_?: (event: KernelEvent) => void;
}

export interface PluginManager {
  readonly list: readonly Plugin[];
  register(plugin: Plugin): void;
  unregister(name: string): void;
  /** Deliver a record straight to the plugins (after the kernel is gone). */
  deliver_(event: KernelEvent): void;
}

declare module "../kernel.js" {
  interface KernelFeatures {
    /** Added by `withPlugins`. */
    plugins: PluginManager;
  }
}

/** Record kind → the 1.35 hook and the record fields passed as its arguments. */
const HOOKS: Record<string, string[]> = {
  "system.start": ["onStart", "system"],
  "system.stop": ["onStop", "system"],
  "system.destroy": ["onDestroy", "system"],
  "fact.set": ["onFactSet", "key", "value", "prev"],
  "fact.batch": ["onFactsBatch", "changes"],
  "derivation.invalidate": ["onDerivationInvalidate", "id"],
  "derivation.compute": ["onDerivationCompute", "id", "value", "deps"],
  error: ["onError", "error"],
  "error.recovery": ["onErrorRecovery", "error", "strategy"],
  "reconcile.start": ["onReconcileStart", "snapshot"],
  "reconcile.end": ["onReconcileEnd", "result"],
  "effect.run": ["onEffectRun", "id"],
  "effect.error": ["onEffectError", "id", "error"],
  "effect.write-blocked": ["onEffectWriteBlocked", "id", "key"],
  // L2: reconcile.ts.
  "constraint.evaluate": ["onConstraintEvaluate", "id", "active", "explain"],
  "constraint.error": ["onConstraintError", "id", "error"],
  "requirement.created": ["onRequirementCreated", "req"],
  "requirement.met": ["onRequirementMet", "req", "resolver"],
  "requirement.canceled": ["onRequirementCanceled", "req"],
  "resolver.start": ["onResolverStart", "resolver", "req"],
  "resolver.complete": ["onResolverComplete", "resolver", "req", "duration"],
  "resolver.error": ["onResolverError", "resolver", "req", "error"],
  "resolver.retry": ["onResolverRetry", "resolver", "req", "attempt"],
  "resolver.cancel": ["onResolverCancel", "resolver", "req"],
};

const logError = (plugin: Plugin, hook: string, error: unknown): void => {
  console.error("[Directive] Plugin error:", {
    plugin: plugin.name,
    hook,
    error,
  });
};

/** The tick structure matches 1.35's, so onInit lands on the same microtask. */
async function safeAsync(plugin: Plugin, fn: () => unknown): Promise<unknown> {
  try {
    return await (fn() ?? Promise.resolve());
  } catch (error) {
    logError(plugin, "onInit", error);

    return undefined;
  }
}

/** onInit may be async; plugins added while it runs are initialised too. */
async function init(plugins: Plugin[], system: unknown): Promise<void> {
  const done = new WeakSet<Plugin>();
  for (let pass = 0; pass < 100; pass++) {
    const todo = plugins.filter((p) => !done.has(p));
    if (todo.length === 0) {
      break;
    }
    for (const plugin of todo) {
      done.add(plugin);
      await safeAsync(plugin, () =>
        plugin.onInit
          ? (plugin.onInit as (s: unknown) => unknown)(system)
          : undefined,
      );
    }
  }
}

/** The plugins part, with the plugins a system starts with. */
export function withPlugins(initial: readonly Plugin[] = []): SystemPart {
  return ({ kernel, system }) => {
    const plugins: StreamPlugin[] = [];
    let off: (() => void) | null = null;
    const dispatch = (event: KernelEvent): void => {
      const spec = HOOKS[event.at];
      if (!spec) {
        return;
      }
      const hook = spec[0]!;
      for (const plugin of plugins.slice()) {
        try {
          if (plugin.event_) {
            plugin.event_(event);
          } else {
            (plugin[hook] as ((...a: unknown[]) => unknown) | undefined)?.(
              ...spec.slice(1).map((field) => event[field]),
            );
          }
        } catch (error) {
          logError(plugin, hook, error);
        }
      }
    };
    const manager: PluginManager = {
      list: plugins,
      register(plugin) {
        const index = plugins.findIndex((p) => p.name === plugin.name);
        if (index !== -1) {
          console.warn(
            `[Directive] Plugin "${plugin.name}" is already registered, replacing...`,
          );
          plugins.splice(index, 1);
        }
        plugins.push(plugin);
        off ??= kernel.hooks.on(dispatch);
      },
      deliver_: dispatch,
      unregister(name) {
        const index = plugins.findIndex((p) => p.name === name);
        if (index !== -1) {
          plugins.splice(index, 1);
        }
        if (plugins.length === 0 && off) {
          off();
          off = null;
        }
      },
    };
    kernel.define("plugins", manager);
    for (const plugin of initial) {
      manager.register(plugin);
    }
    init(plugins, system).catch(() => {});
  };
}

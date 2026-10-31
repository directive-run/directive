/**
 * The 1.35 plugin manager, as a system part. Plugins are called from the
 * kernel's event stream: the system emits one record per occurrence
 * (`fact.set`, `effect.run`, …) and this part maps each record to its 1.35
 * hook, calling every plugin in registration order and logging (never
 * rethrowing) a plugin's error. It listens only while a plugin is
 * registered, so a system with none builds no records.
 *
 * As in 1.35 (plugins.ts:305–308), each call walks a snapshot of the list
 * and reads the hook off the plugin object when it calls it, so a hook added
 * after `register` fires and a deleted one stops. Its `wants_` answers the
 * kernel's {@link Hooks.wants} the same way, reading `plugin[hook]` across
 * the list when a record is due: one property read per plugin, nothing kept,
 * so a record nobody's hook reads is never built.
 */

import isDevelopment from "#is-development";
import type { EventKind, KernelEvent } from "../kernel.js";
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
  /** True when a registered plugin reads records of kind `at` now. */
  wants_(at: EventKind): boolean;
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
  "constraint.binding.disabled": [
    "onConstraintBindingDisabled",
    "id",
    "reason",
  ],
  "requirement.created": ["onRequirementCreated", "req"],
  "requirement.met": ["onRequirementMet", "req", "resolver"],
  "requirement.canceled": ["onRequirementCanceled", "req"],
  "resolver.start": ["onResolverStart", "resolver", "req"],
  "resolver.complete": ["onResolverComplete", "resolver", "req", "duration"],
  "resolver.error": ["onResolverError", "resolver", "req", "error"],
  "resolver.retry": ["onResolverRetry", "resolver", "req", "attempt"],
  "resolver.cancel": ["onResolverCancel", "resolver", "req"],
  "resolver.write.rejected": ["onResolverWriteRejected", "event"],
  // L3: system.notify, defined below.
  "guardrail.blocked": [
    "onGuardrailBlocked",
    "plugin",
    "key",
    "kind",
    "count",
    "category",
  ],
  "guardrail.coverage": [
    "onGuardrailCoverage",
    "plugin",
    "screenedCount",
    "screenedDigest",
    "reason",
  ],
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
    const wants = (at: EventKind): boolean => {
      const hook = HOOKS[at]?.[0];
      if (hook) {
        for (const plugin of plugins) {
          if (plugin.event_ || plugin[hook]) {
            return true;
          }
        }
      }

      return false;
    };
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
        off ??= kernel.hooks.on(Object.assign(dispatch, { wants_: wants }));
      },
      deliver_: dispatch,
      wants_: wants,
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
    // 1.35's system.notify (engine.ts:2823–2880): silent once destroyed or
    // with no plugin; a blocked report must name a registered plugin, and its
    // re-entry through the hooks stops at depth 4.
    let depth = 0;
    (system as { notify?: unknown }).notify = {
      guardrailBlocked(
        plugin: string,
        key: string,
        kind: string,
        count: number,
        category?: string,
      ) {
        if (kernel.disposed || plugins.length === 0 || depth >= 4) {
          return;
        }
        if (!plugins.some((p) => p.name === plugin)) {
          if (isDevelopment) {
            console.warn(
              `[Directive] system.notify.guardrailBlocked called with unknown plugin "${plugin}". Event dropped.`,
            );
          }

          return;
        }
        depth++;
        try {
          kernel.hooks.emit("guardrail.blocked", {
            plugin,
            key,
            kind,
            count,
            category,
          });
        } finally {
          depth--;
        }
      },
      guardrailCoverage(
        plugin: string,
        screenedCount: number,
        screenedDigest: string,
        reason: string,
      ) {
        if (!kernel.disposed && plugins.length > 0) {
          kernel.hooks.emit("guardrail.coverage", {
            plugin,
            screenedCount,
            screenedDigest,
            reason,
          });
        }
      },
    };
    for (const plugin of initial) {
      manager.register(plugin);
    }
    init(plugins, system).catch(() => {});
  };
}

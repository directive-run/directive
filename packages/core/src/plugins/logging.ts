/**
 * Logging Plugin - Console logging for Directive events
 */

import type { ModuleSchema, Plugin } from "../core/types.js";

export interface LoggingPluginOptions {
  /** Log level */
  level?: "debug" | "info" | "warn" | "error";
  /** Filter function to include/exclude events */
  filter?: (event: string) => boolean;
  /** Custom logger (defaults to console) */
  logger?: Pick<
    Console,
    "debug" | "info" | "warn" | "error" | "group" | "groupEnd"
  >;
  /** Prefix for log messages */
  prefix?: string;
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Create a logging plugin.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [loggingPlugin({ level: "debug" })],
 * });
 * ```
 */
export function loggingPlugin<M extends ModuleSchema = ModuleSchema>(
  options: LoggingPluginOptions = {},
): Plugin<M> {
  const {
    level = "info",
    filter = () => true,
    logger = console,
    prefix = "[Directive]",
  } = options;

  const minLevel = LOG_LEVELS[level];

  const log = (
    eventLevel: keyof typeof LOG_LEVELS,
    event: string,
    ...args: unknown[]
  ) => {
    if (LOG_LEVELS[eventLevel] < minLevel) return;
    if (!filter(event)) return;
    logger[eventLevel](`${prefix} ${event}`, ...args);
  };

  return {
    name: "logging",

    onInit: () => log("debug", "init"),
    onStart: () => log("info", "start"),
    onStop: () => log("info", "stop"),
    onDestroy: () => log("debug", "destroy"),

    onFactSet: (key, value, prev) => {
      log("debug", "fact.set", { key, value, prev });
    },

    onFactDelete: (key, prev) => {
      log("debug", "fact.delete", { key, prev });
    },

    onFactsBatch: (changes) => {
      log("debug", "facts.batch", { count: changes.length, changes });
    },

    onDerivationCompute: (id, value, deps) => {
      log("debug", "derivation.compute", { id, value, deps });
    },

    onDerivationInvalidate: (id) => {
      log("debug", "derivation.invalidate", { id });
    },

    onReconcileStart: () => {
      log("debug", "reconcile.start");
    },

    onReconcileEnd: (result) => {
      log("debug", "reconcile.end", {
        unmet: result.unmet.length,
        inflight: result.inflight.length,
        completed: result.completed.length,
        canceled: result.canceled.length,
      });
    },

    onConstraintEvaluate: (id, active) => {
      log("debug", "constraint.evaluate", { id, active });
    },

    onConstraintError: (id, error) => {
      log("error", "constraint.error", { id, error });
    },

    onRequirementCreated: (req) => {
      log("debug", "requirement.created", {
        id: req.id,
        type: req.requirement.type,
      });
    },

    onRequirementMet: (req, byResolver) => {
      log("info", "requirement.met", { id: req.id, byResolver });
    },

    onRequirementCanceled: (req) => {
      log("debug", "requirement.canceled", { id: req.id });
    },

    onResolverStart: (resolver, req) => {
      log("debug", "resolver.start", { resolver, requirementId: req.id });
    },

    onResolverComplete: (resolver, req, duration) => {
      log("info", "resolver.complete", {
        resolver,
        requirementId: req.id,
        duration,
      });
    },

    onResolverError: (resolver, req, error) => {
      log("error", "resolver.error", {
        resolver,
        requirementId: req.id,
        error,
      });
    },

    onResolverRetry: (resolver, req, attempt) => {
      log("warn", "resolver.retry", {
        resolver,
        requirementId: req.id,
        attempt,
      });
    },

    onResolverCancel: (resolver, req) => {
      log("debug", "resolver.cancel", { resolver, requirementId: req.id });
    },

    onEffectRun: (id) => {
      log("debug", "effect.run", { id });
    },

    onEffectError: (id, error) => {
      log("error", "effect.error", { id, error });
    },

    onSnapshot: (snapshot) => {
      log("debug", "timetravel.snapshot", {
        id: snapshot.id,
        trigger: snapshot.trigger,
      });
    },

    onTimeTravel: (from, to) => {
      log("info", "timetravel.jump", { from, to });
    },

    onError: (error) => {
      log("error", "error", {
        source: error.source,
        sourceId: error.sourceId,
        message: error.message,
      });
    },

    onErrorRecovery: (error, strategy) => {
      log("warn", "error.recovery", {
        source: error.source,
        sourceId: error.sourceId,
        strategy,
      });
    },
  };
}

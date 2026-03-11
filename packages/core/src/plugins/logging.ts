/**
 * Logging Plugin - Console logging for Directive events
 */

import type { ModuleSchema, Plugin } from "../core/types.js";

/**
 * Configuration for the {@link loggingPlugin}.
 *
 * @remarks
 * All fields are optional. The defaults produce `[Directive]`-prefixed
 * `console.info`-level output for every lifecycle event.
 *
 * | Field    | Default         | Description |
 * |----------|-----------------|-------------|
 * | `level`  | `"info"`        | Minimum severity to emit. |
 * | `filter` | `() => true`    | Predicate that receives the event name (e.g., `"fact.set"`) and returns whether to log it. |
 * | `logger` | `console`       | Any object implementing `debug`, `info`, `warn`, `error`, `group`, and `groupEnd`. |
 * | `prefix` | `"[Directive]"` | String prepended to every log line. |
 *
 * @public
 */
export interface LoggingPluginOptions {
  /** Minimum log level; events below this severity are silenced. */
  level?: "debug" | "info" | "warn" | "error";
  /** Predicate that receives the event name and returns whether to log it. */
  filter?: (event: string) => boolean;
  /** Custom logger object (defaults to `console`). */
  logger?: Pick<
    Console,
    "debug" | "info" | "warn" | "error" | "group" | "groupEnd"
  >;
  /** String prepended to every log message. */
  prefix?: string;
}

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Create a plugin that logs Directive lifecycle events to a configurable logger.
 *
 * @remarks
 * Every plugin hook is mapped to a log call at an appropriate severity:
 * - `debug` -- init, destroy, fact changes, derivation compute/invalidate, reconcile, constraint evaluate, resolver start/cancel, effect run, snapshot
 * - `info` -- start, stop, requirement met, resolver complete, time-travel jump
 * - `warn` -- resolver retry, error recovery
 * - `error` -- constraint error, resolver error, effect error, system error
 *
 * @param options - Optional {@link LoggingPluginOptions} to control level, filtering, logger backend, and prefix.
 * @returns A {@link Plugin} that can be passed to `createSystem`'s `plugins` array.
 *
 * @example
 * ```ts
 * const system = createSystem({
 *   modules: [myModule],
 *   plugins: [loggingPlugin({ level: "debug" })],
 * });
 * ```
 *
 * @public
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

    onHistoryNavigate: (from, to) => {
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

    onDefinitionRegister: (type, id) => {
      log("info", "definition.register", { type, id });
    },

    onDefinitionAssign: (type, id) => {
      log("info", "definition.assign", { type, id });
    },

    onDefinitionUnregister: (type, id) => {
      log("info", "definition.unregister", { type, id });
    },

    onDefinitionCall: (type, id, props) => {
      log("debug", "definition.call", { type, id, props });
    },
  };
}

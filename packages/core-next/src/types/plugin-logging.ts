/**
 * Copied from 1.35 (packages/core/src/plugins/logging.ts): its type declarations only,
 * unchanged. Types, no runtime code.
 */

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

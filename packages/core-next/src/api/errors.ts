/**
 * The error boundary (1.35's errors.ts): which strategy each error gets, the
 * retry-later queue and its poller. A part, installed only when the system
 * has an `errorBoundary` (or `zeroConfig`); without it every error is
 * skipped by the core's own `reportError`.
 *
 * It only decides. The core's `reportError` emits the records around the
 * decision and throws under "throw"; each caller acts on the strategy it
 * gets back, at the place 1.35's engine does (core.ts for derivations,
 * effects.ts, reconcile.ts for constraints and resolvers).
 *
 * - Retry-later keeps one entry and one attempt count per source id, as 1.35
 *   does: two requirements of one resolver share them. A due entry runs a
 *   pass; a constraint's is asked again by name. A resolver is not run
 *   again (1.35's behaviour; candidate (p) is not approved).
 * - The poller is 1.35's interval, `min(max(delayMs, 250), 500)` ms, on the
 *   kernel clock: owned by the system, re-armed only while something waits,
 *   and not keeping a Node process alive (`keepAlive: false`). It is not
 *   part of `isSettled`, so `settle()` resolves while an entry waits.
 */

import isDevelopment from "#is-development";
import type {
  DirectiveError,
  ErrorSource,
  ErrorsFeature,
  ReconcileFeature,
  Strategy,
  SystemPart,
} from "./core.js";

/** A strategy, or a function of the error and the source id that picks one. */
export type ErrorHandler =
  | Strategy
  | ((error: Error, id: string) => Strategy | undefined | void);

export interface RetryLaterConfig {
  /** Delay before the first retry (default 1000 ms). */
  delayMs?: number;
  /** Retries before falling back to "skip" (default 3). */
  maxRetries?: number;
  /** Each retry waits this much longer (default 2). */
  backoffMultiplier?: number;
  /** Longest delay (default 30000 ms). */
  maxDelayMs?: number;
}

export interface ErrorBoundaryConfig {
  onConstraintError?: ErrorHandler;
  onResolverError?: ErrorHandler;
  onEffectError?: ErrorHandler;
  onDerivationError?: ErrorHandler;
  /** Hears every error, after the plugins' onError. */
  onError?: (error: DirectiveError) => void;
  retryLater?: RetryLaterConfig;
}

declare module "../kernel.js" {
  interface KernelFeatures {
    /** Added by `withErrorBoundary` (errors.ts). */
    errors: ErrorsFeature;
  }
}

const OPTION = {
  constraint: "onConstraintError",
  resolver: "onResolverError",
  effect: "onEffectError",
  derivation: "onDerivationError",
} as const;

export const withErrorBoundary =
  (config: ErrorBoundaryConfig): SystemPart =>
  (context) => {
    const { kernel, system } = context;
    const { clock } = kernel;
    const {
      delayMs = 1000,
      maxRetries = 3,
      backoffMultiplier = 2,
      maxDelayMs = 30000,
    } = config.retryLater ?? {};
    /** Waiting retry-later entries by source id: [source, due time]. */
    const waiting = new Map<string, [ErrorSource, number]>();
    /** Retry-later attempts by source id, for at most 1000 sources (1.35). */
    const attempts = new Map<string, number>();
    /** The poller's timer on the kernel clock; 0 when not polling. */
    let poller = 0;
    const fire = () => {
      poller = 0;
      const now = clock.now();
      const due: [string, ErrorSource][] = [];
      for (const [id, [source, at]] of waiting) {
        if (at <= now) {
          due.push([id, source]);
          waiting.delete(id);
        }
      }
      // 1.35's interval keeps going while anything waits, and stops after
      // the poll that finds nothing left.
      if (waiting.size > 0) {
        poll();
      }
      for (const [id, source] of due) {
        // A constraint is asked again by name: a pass with no changed keys
        // would carry its last answer forward (1.35).
        if (source === "constraint") {
          (
            kernel.features as { reconcile?: ReconcileFeature }
          ).reconcile?.dirty_(id);
        }
        context.schedule();
      }
    };
    /** Start polling unless it is already, or the system is not running. */
    const poll = () => {
      if (!poller && system.isRunning) {
        poller = clock.setTimeout(fire, Math.min(Math.max(delayMs, 250), 500), {
          owner: kernel.owner,
          kind: "retry-later",
          keepAlive: false,
        });
      }
    };
    context.decide_ = (source, sourceId, error, wrapped, _info, warn) => {
      try {
        config.onError?.(wrapped);
      } catch (e) {
        console.error("[Directive] Error in config.onError callback:", e);
      }
      const handler = config[OPTION[source as keyof typeof OPTION]];
      let strategy: Strategy =
        typeof handler === "string"
          ? handler
          : source === "system"
            ? "throw"
            : "skip";
      if (typeof handler === "function") {
        // The handler hears what was thrown, as an Error; anything but a
        // string back is a skip, and so is a handler that throws.
        try {
          const result = handler(
            error instanceof Error ? error : new Error(String(error)),
            sourceId,
          );
          if (typeof result === "string") {
            strategy = result;
          }
        } catch (e) {
          console.error("[Directive] Error in error handler callback:", e);
        }
      }
      if (strategy === "retry-later") {
        const attempt = (attempts.get(sourceId) ?? 0) + 1;
        attempts.set(sourceId, attempt);
        if (attempts.size > 1000) {
          attempts.delete(attempts.keys().next().value!);
        }
        if (attempt <= maxRetries) {
          waiting.set(sourceId, [
            source,
            clock.now() +
              Math.min(
                delayMs * backoffMultiplier ** (attempt - 1),
                maxDelayMs,
              ),
          ]);
          poll();
        } else {
          attempts.delete(sourceId);
          if (isDevelopment) {
            console.warn(
              `[Directive] ${source} "${sourceId}" exceeded max retry-later attempts. Skipping.`,
            );
          }
          strategy = "skip";
        }
      }
      if (strategy === "skip" && handler === undefined && !config.onError) {
        warn();
      }

      return strategy;
    };
    kernel.define("errors", {
      start_() {
        // 1.35 polls from start() when retryLater is configured.
        if (config.retryLater) {
          poll();
        }
      },
      stop_() {
        clock.clearTimeout(poller);
        poller = 0;
        waiting.clear();
      },
      clear_(id) {
        attempts.delete(id);
        waiting.delete(id);
      },
    });
  };

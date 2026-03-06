/**
 * Service Hooks — route architect events to external services
 * (Slack, Postgres, monitoring, etc.)
 *
 * Wraps event subscriptions and audit log polling into a single
 * unsubscribe function. Supports resilient hooks with retry,
 * dead letter, filtering, and timeouts.
 */

import type {
  ArchitectServiceHooks,
  ArchitectAnalysis,
  ArchitectAction,
  AuditEntry,
  KillResult,
} from "./types.js";

// ============================================================================
// Types
// ============================================================================

export interface WireServiceHooksOptions {
  /** The service hooks to wire. */
  hooks: ArchitectServiceHooks;
  /** Subscribe to architect events. Returns an unsubscribe function. */
  subscribe: (
    event: string,
    handler: (...args: unknown[]) => void,
  ) => () => void;
  /** Get audit log entries since a given index. */
  getAuditLog?: () => AuditEntry[];
  /** Polling interval for audit log (ms). Default: 5000 */
  auditPollInterval?: number;
}

/** Retry policy for resilient hooks. */
export interface RetryPolicy {
  /** Maximum number of attempts (including initial). Default: 3 */
  maxAttempts?: number;
  /** Base delay between retries in ms. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay between retries in ms. Default: 30000 */
  maxDelayMs?: number;
  /** Backoff strategy. Default: "exponential" */
  strategy?: "fixed" | "exponential" | "linear";
  /** Jitter factor 0-1 added to delay. Default: 0.1 */
  jitter?: number;
}

/** Resilient hook configuration with retry, dead letter, and filtering. */
export interface ResilientHookConfig<T> {
  /** The handler function. */
  handler: (payload: T) => void | Promise<void>;
  /** Retry policy for failed deliveries. */
  retry?: RetryPolicy;
  /** Called when all retry attempts are exhausted. */
  onDeadLetter?: (payload: T, error: Error, attempts: number) => void | Promise<void>;
  /** Filter function — return false to skip delivery. */
  filter?: (payload: T) => boolean;
  /** Timeout for handler execution in ms. Default: 10000 */
  timeoutMs?: number;
}

// ============================================================================
// Retry Engine
// ============================================================================

/**
 * Execute a handler with retry logic. Never throws.
 */
export async function executeWithRetry<T>(
  payload: T,
  config: ResilientHookConfig<T>,
): Promise<void> {
  const maxAttempts = config.retry?.maxAttempts ?? 3;
  const baseDelayMs = config.retry?.baseDelayMs ?? 1000;
  const maxDelayMs = config.retry?.maxDelayMs ?? 30_000;
  const strategy = config.retry?.strategy ?? "exponential";
  const jitter = config.retry?.jitter ?? 0.1;
  const timeoutMs = config.timeoutMs ?? 10_000;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = withTimeout(config.handler(payload), timeoutMs);

      if (result && typeof result === "object" && "then" in result) {
        await result;
      }

      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < maxAttempts) {
        const delay = computeDelay(attempt, baseDelayMs, maxDelayMs, strategy, jitter);
        await sleep(delay);
      }
    }
  }

  // All attempts exhausted — send to dead letter
  if (config.onDeadLetter && lastError) {
    try {
      const dlResult = config.onDeadLetter(payload, lastError, maxAttempts);

      if (dlResult && typeof dlResult === "object" && "then" in dlResult) {
        await (dlResult as Promise<void>);
      }
    } catch {
      // Dead letter handler errors are swallowed
    }
  }
}

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  strategy: "fixed" | "exponential" | "linear",
  jitter: number,
): number {
  let delay: number;

  switch (strategy) {
    case "fixed":
      delay = baseDelayMs;
      break;
    case "linear":
      delay = baseDelayMs * attempt;
      break;
    case "exponential":
    default:
      delay = baseDelayMs * Math.pow(2, attempt - 1);
      break;
  }

  // Apply jitter
  if (jitter > 0) {
    const jitterAmount = delay * jitter * Math.random();
    delay += jitterAmount;
  }

  return Math.min(delay, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(
  valueOrPromise: T | Promise<T>,
  timeoutMs: number,
): T | Promise<T> {
  if (!valueOrPromise || typeof valueOrPromise !== "object" || !("then" in valueOrPromise)) {
    return valueOrPromise;
  }

  const promise = valueOrPromise as Promise<T>;

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Hook timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ============================================================================
// Type Detection
// ============================================================================

/** Check if a hook value is a ResilientHookConfig vs a raw function. */
function isResilientConfig<T>(
  hook: ((payload: T) => void | Promise<void>) | ResilientHookConfig<T>,
): hook is ResilientHookConfig<T> {
  return typeof hook === "object" && hook !== null && "handler" in hook;
}

/**
 * Wrap a hook (raw function or ResilientHookConfig) into a unified handler.
 * Raw functions behave exactly as before (no retry, errors swallowed).
 * Resilient configs get retry, dead letter, and filtering.
 */
function wrapHook<T>(
  hook: ((payload: T) => void | Promise<void>) | ResilientHookConfig<T>,
): (payload: T) => void {
  if (!isResilientConfig(hook)) {
    // Raw function — backward compatible, errors swallowed
    return (payload: T) => safeCall(() => hook(payload));
  }

  // Resilient config — retry, filter, dead letter
  return (payload: T) => {
    // Apply filter
    if (hook.filter && !hook.filter(payload)) {
      return;
    }

    // Fire-and-forget with retry
    executeWithRetry(payload, hook).catch(() => {
      // Final safety net — never throws
    });
  };
}

// ============================================================================
// Wire Service Hooks
// ============================================================================

/**
 * Wire service hooks to architect events.
 * Returns an unsubscribe function that cleans up all subscriptions.
 */
export function wireServiceHooks(options: WireServiceHooksOptions): () => void {
  const { hooks, subscribe, getAuditLog, auditPollInterval = 5000 } = options;
  const unsubscribers: Array<() => void> = [];

  // Item 3: Wire analysis events — use "analysis-complete" event name
  if (hooks.onAnalysis) {
    const handle = wrapHook(hooks.onAnalysis);

    unsubscribers.push(
      subscribe("analysis-complete", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        handle((event?.analysis ?? event) as ArchitectAnalysis);
      }),
    );
  }

  // Item 3: Wire action events — use "applied" event name
  if (hooks.onAction) {
    const handle = wrapHook(hooks.onAction);

    unsubscribers.push(
      subscribe("applied", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        handle((event?.action ?? event) as ArchitectAction);
      }),
    );
  }

  // Wire error events
  if (hooks.onError) {
    const handle = wrapHook(hooks.onError);

    unsubscribers.push(
      subscribe("error", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        handle((event?.error ?? event) as Error);
      }),
    );
  }

  // Item 3: Wire kill events — use "killed" event name
  if (hooks.onKill) {
    const handle = wrapHook(hooks.onKill);

    unsubscribers.push(
      subscribe("killed", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        handle((event?.killResult ?? event) as KillResult);
      }),
    );
  }

  // Poll audit log
  if (hooks.onAudit && getAuditLog) {
    const handle = wrapHook(hooks.onAudit);
    let lastSeenCount = getAuditLog().length;

    const timer = setInterval(() => {
      const entries = getAuditLog();

      if (entries.length > lastSeenCount) {
        const newEntries = entries.slice(lastSeenCount);
        lastSeenCount = entries.length;

        for (const entry of newEntries) {
          handle(entry);
        }
      }
    }, auditPollInterval);

    unsubscribers.push(() => clearInterval(timer));
  }

  // Return cleanup function
  return () => {
    for (const unsub of unsubscribers) {
      unsub();
    }

    unsubscribers.length = 0;
  };
}

// ============================================================================
// Helpers
// ============================================================================

function safeCall(fn: () => void | Promise<void>): void {
  try {
    const result = fn();

    if (result && typeof result === "object" && "catch" in result) {
      (result as Promise<void>).catch(() => {
        // Swallow async errors from hooks — they should not crash the architect
      });
    }
  } catch {
    // Swallow sync errors from hooks
  }
}

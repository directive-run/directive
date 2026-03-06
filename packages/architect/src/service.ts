/**
 * Service Hooks — route architect events to external services
 * (Slack, Postgres, monitoring, etc.)
 *
 * Wraps event subscriptions and audit log polling into a single
 * unsubscribe function.
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

  // Wire analysis events
  if (hooks.onAnalysis) {
    const handler = hooks.onAnalysis;

    unsubscribers.push(
      subscribe("analysis", (...args: unknown[]) => {
        safeCall(() => handler(args[0] as ArchitectAnalysis));
      }),
    );
  }

  // Wire action events
  if (hooks.onAction) {
    const handler = hooks.onAction;

    unsubscribers.push(
      subscribe("action", (...args: unknown[]) => {
        safeCall(() => handler(args[0] as ArchitectAction));
      }),
    );
  }

  // Wire error events
  if (hooks.onError) {
    const handler = hooks.onError;

    unsubscribers.push(
      subscribe("error", (...args: unknown[]) => {
        safeCall(() => handler(args[0] as Error));
      }),
    );
  }

  // Wire kill events
  if (hooks.onKill) {
    const handler = hooks.onKill;

    unsubscribers.push(
      subscribe("kill", (...args: unknown[]) => {
        safeCall(() => handler(args[0] as KillResult));
      }),
    );
  }

  // Poll audit log
  if (hooks.onAudit && getAuditLog) {
    const handler = hooks.onAudit;
    let lastSeenCount = getAuditLog().length;

    const timer = setInterval(() => {
      const entries = getAuditLog();

      if (entries.length > lastSeenCount) {
        const newEntries = entries.slice(lastSeenCount);
        lastSeenCount = entries.length;

        for (const entry of newEntries) {
          safeCall(() => handler(entry));
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

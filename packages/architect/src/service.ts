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

  // Item 3: Wire analysis events — use "analysis-complete" event name
  if (hooks.onAnalysis) {
    const handler = hooks.onAnalysis;

    unsubscribers.push(
      subscribe("analysis-complete", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        safeCall(() => handler((event?.analysis ?? event) as ArchitectAnalysis));
      }),
    );
  }

  // Item 3: Wire action events — use "applied" event name
  if (hooks.onAction) {
    const handler = hooks.onAction;

    unsubscribers.push(
      subscribe("applied", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        safeCall(() => handler((event?.action ?? event) as ArchitectAction));
      }),
    );
  }

  // Wire error events
  if (hooks.onError) {
    const handler = hooks.onError;

    unsubscribers.push(
      subscribe("error", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        safeCall(() => handler((event?.error ?? event) as Error));
      }),
    );
  }

  // Item 3: Wire kill events — use "killed" event name
  if (hooks.onKill) {
    const handler = hooks.onKill;

    unsubscribers.push(
      subscribe("killed", (...args: unknown[]) => {
        const event = args[0] as Record<string, unknown> | undefined;
        safeCall(() => handler((event?.killResult ?? event) as KillResult));
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

/**
 * Client-Side AI Event Bridge for DevTools
 *
 * Dispatches AI debug events (guardrail checks, agent lifecycle, etc.) via
 * CustomEvent so that DevTools AI tabs populate without requiring a server-side
 * SSE stream.
 *
 * Usage:
 * ```ts
 * import { emitDevToolsEvent } from '@directive-run/core/plugins'
 *
 * const result = detectPII(text)
 * emitDevToolsEvent({
 *   type: 'guardrail_check',
 *   guardrailName: 'pii-detection',
 *   guardrailType: 'input',
 *   passed: !result.detected,
 * })
 * ```
 */

/** The CustomEvent name that DevTools listens for. */
export const DEVTOOLS_EVENT_NAME = "directive-devtools-event";

/** Keys that must never propagate into event objects. */
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Session nonce — random prefix to avoid ID collisions across HMR reloads.
 * Each module evaluation gets a unique nonce, so even if the counter on
 * `window` resets, IDs from different sessions won't collide.
 */
const SESSION_NONCE = Math.random().toString(36).slice(2, 8);

/**
 * Get the next event ID. Stored on `window` to survive HMR reloads
 * (module re-evaluation resets module-level variables, but `window` persists).
 * Returns a unique numeric ID by combining a session nonce hash with a counter.
 */
function getNextId(): number {
  if (typeof window !== "undefined") {
    const key = `__DIRECTIVE_BRIDGE_ID_${SESSION_NONCE}__`;
    const w = window as unknown as Record<string, unknown>;
    const current = (w[key] as number | undefined) ?? 0;
    w[key] = current + 1;

    return current + 1;
  }

  return 1;
}

/**
 * Strip prototype-pollution keys from an event object.
 */
function sanitizeEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  let needsSanitize = false;
  for (const key of BLOCKED_KEYS) {
    if (key in event) {
      needsSanitize = true;
      break;
    }
  }

  if (!needsSanitize) {
    return event;
  }

  const clean: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(event)) {
    if (!BLOCKED_KEYS.has(key)) {
      clean[key] = value;
    }
  }

  return clean;
}

/**
 * Emit a single AI debug event into DevTools via the client-side bridge.
 *
 * The event is dispatched as a CustomEvent on `window`. The DevTools
 * `useDevToolsStream` hook listens for these and pushes them into the
 * connection module's event array — the same path as SSE events.
 *
 * Fields `id`, `timestamp`, and `snapshotId` are auto-assigned if not provided.
 */
export function emitDevToolsEvent(
  event: Record<string, unknown> & { type: string },
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const safe = sanitizeEvent(event);
    const full = {
      id: getNextId(),
      timestamp: Date.now(),
      snapshotId: null,
      ...safe,
    };

    window.dispatchEvent(
      new CustomEvent(DEVTOOLS_EVENT_NAME, { detail: full }),
    );
  } catch {
    // DevTools bridge must never crash the host application
  }
}

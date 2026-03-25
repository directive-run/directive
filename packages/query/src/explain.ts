/**
 * explainQuery — Human-readable causal chain for why a query fetched.
 *
 * Wraps Directive's built-in explain() with query-aware formatting.
 * No competitor has this — it requires a constraint engine underneath.
 *
 * @module
 */

import type { ResourceState } from "./types.js";

const PREFIX = "_q_";

/**
 * Explain why a query is in its current state.
 *
 * @param system - The Directive system instance
 * @param queryName - The query name (e.g., "user")
 * @returns Human-readable explanation string
 *
 * @example
 * ```typescript
 * console.log(explainQuery(system, "user"));
 * // Query "user" is fetching because:
 * //   - Cache key changed from "user-41" to "user-42"
 * //   - Previous data was 45s old (refetchAfter: 30s)
 * ```
 */
export function explainQuery(
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  system: any,
  queryName: string,
): string {
  const stateKey = `${PREFIX}${queryName}_state`;
  const keyKey = `${PREFIX}${queryName}_key`;

  // Get the query's ResourceState
  const state = system.facts?.$store?.get(stateKey) as
    | ResourceState<unknown>
    | undefined;
  const currentKey = system.facts?.$store?.get(keyKey) as string | null;

  if (!state) {
    return `Query "${queryName}" has not been initialized.`;
  }

  const lines: string[] = [`Query "${queryName}"`];

  // Status line
  switch (state.status) {
    case "pending":
      lines.push(
        state.isFetching
          ? "  Status: fetching (first load)"
          : "  Status: pending (waiting for trigger)",
      );
      break;
    case "success":
      lines.push(
        state.isFetching
          ? "  Status: refetching in background (stale-while-revalidate)"
          : `  Status: success (fresh${state.isStale ? ", becoming stale" : ""})`,
      );
      break;
    case "error":
      lines.push(
        `  Status: error (${state.failureCount} failure${state.failureCount !== 1 ? "s" : ""})`,
      );
      break;
  }

  // Cache key
  if (currentKey) {
    lines.push(`  Cache key: ${currentKey}`);
  } else {
    lines.push("  Cache key: null (query disabled)");
  }

  // Data age
  if (state.dataUpdatedAt) {
    const ageMs = Date.now() - state.dataUpdatedAt;
    const ageSec = Math.round(ageMs / 1000);
    lines.push(`  Data age: ${ageSec}s`);
  }

  // Error details
  if (state.error) {
    const errorMsg =
      state.error instanceof Error
        ? state.error.message
        : String(state.error);
    lines.push(`  Error: ${errorMsg}`);
  }

  // Failure tracking
  if (state.failureCount > 0) {
    lines.push(`  Failures: ${state.failureCount}`);
  }

  // Try to get the engine's explain() for the underlying requirement
  try {
    const inspection = system.inspect?.();
    if (inspection?.unmet) {
      const queryReq = inspection.unmet.find(
        (r: { requirement: { type: string } }) =>
          r.requirement.type === `QUERY_${queryName.toUpperCase()}`,
      );
      if (queryReq) {
        lines.push("  Pending requirement: " + queryReq.id);
        const explanation = system.explain?.(queryReq.id);
        if (explanation) {
          lines.push("  Engine explanation:");
          // Indent each line of the engine's explain output
          for (const line of explanation.split("\n")) {
            lines.push(`    ${line}`);
          }
        }
      }
    }
  } catch {
    // explain() may not be available — skip silently
  }

  return lines.join("\n");
}

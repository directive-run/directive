/**
 * explainQuery — Human-readable causal chain for why a query fetched.
 *
 * Wraps Directive's built-in explain() with query-aware formatting.
 * No competitor has this — it requires a constraint engine underneath.
 *
 * @module
 */

import { PREFIX } from "./internal.js";
import type { ResourceState } from "./types.js";

/**
 * Explain why a query is in its current state.
 *
 * Shows status, cache key, data age, trigger reason, and the engine's
 * causal explanation when available.
 *
 * @param system - The Directive system instance
 * @param queryName - The query name (e.g., "user")
 * @returns Human-readable explanation string
 *
 * @example
 * ```typescript
 * console.log(explainQuery(system, "user"));
 * // Query "user"
 * //   Status: refetching in background (stale-while-revalidate)
 * //   Cache key: {"userId":"42"}
 * //   Data age: 45s
 * //   Trigger: key changed (previous: {"userId":"41"})
 * ```
 */
export function explainQuery(
  // biome-ignore lint/suspicious/noExplicitAny: System type varies
  system: any,
  queryName: string,
): string {
  const stateKey = `${PREFIX}${queryName}_state`;
  const keyKey = `${PREFIX}${queryName}_key`;
  const triggerKey = `${PREFIX}${queryName}_trigger`;

  // Read facts via the internal store or the public proxy
  const readFact = (key: string): unknown => {
    try {
      return system.facts?.$store?.get(key) ?? system.facts?.[key];
    } catch {
      return undefined;
    }
  };

  const state = readFact(stateKey) as ResourceState<unknown> | undefined;
  const currentKey = readFact(keyKey) as string | null;
  const triggerValue = readFact(triggerKey);

  // Read the derived state (includes placeholderData/keepPreviousData processing)
  let derivedState: ResourceState<unknown> | undefined;
  try {
    derivedState = system.read?.(queryName) as
      | ResourceState<unknown>
      | undefined;
  } catch {
    // read() may not be available
  }

  if (!state) {
    return `Query "${queryName}" has not been initialized.`;
  }

  const lines: string[] = [`Query "${queryName}"`];

  // --- Status ---
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

  // --- Cache key ---
  if (currentKey) {
    lines.push(`  Cache key: ${currentKey}`);
  } else {
    lines.push("  Cache key: null (query disabled)");
  }

  // --- Data age ---
  if (state.dataUpdatedAt) {
    const ageMs = Date.now() - state.dataUpdatedAt;
    const ageSec = Math.round(ageMs / 1000);
    lines.push(`  Data age: ${ageSec}s`);
  }

  // --- Trigger reason (causal chain) ---
  if (state.isFetching || state.isPending) {
    const triggerNum = typeof triggerValue === "number" ? triggerValue : 0;
    if (triggerNum > 0) {
      lines.push("  Trigger: manual (refetch/invalidate)");
    } else if (state.isPending && state.data === null && !state.isFetching) {
      lines.push("  Trigger: awaiting key (query disabled or key is null)");
    } else if (state.isPending && state.data === null) {
      lines.push("  Trigger: initial fetch (no cached data)");
    }
  }

  // Show if previous data is being held (keepPreviousData)
  const effectiveState = derivedState ?? state;
  if (effectiveState.isPreviousData) {
    lines.push("  Showing previous data (keepPreviousData active)");
  }

  // --- Error details ---
  if (state.error) {
    const errorMsg =
      state.error instanceof Error ? state.error.message : String(state.error);
    lines.push(`  Error: ${errorMsg}`);
  }

  // --- Failure tracking ---
  if (state.failureCount > 0) {
    lines.push(`  Failures: ${state.failureCount}`);
  }

  // --- Engine's explain() for the underlying requirement ---
  try {
    const inspection = system.inspect?.();
    if (inspection?.unmet) {
      const reqTypeName = `QUERY_${queryName.toUpperCase()}`;
      const queryReq = inspection.unmet.find(
        (r: { requirement: { type: string } }) =>
          r.requirement.type === reqTypeName,
      );
      if (queryReq) {
        lines.push(`  Pending requirement: ${queryReq.id}`);
        const explanation = system.explain?.(queryReq.id);
        if (explanation) {
          lines.push("  Engine explanation:");
          for (const line of explanation.split("\n")) {
            lines.push(`    ${line}`);
          }
        }
      }
    }

    // Show causal chain from trace entries
    const traceEntries = system.trace as
      | Array<{
          factChanges: Array<{
            key: string;
            oldValue: unknown;
            newValue: unknown;
          }>;
          constraintsHit: Array<{
            id: string;
            priority: number;
            deps: string[];
          }>;
          requirementsAdded: Array<{
            type: string;
            fromConstraint: string;
          }>;
          resolversCompleted: Array<{
            resolver: string;
            duration: number;
          }>;
        }>
      | null
      | undefined;

    if (traceEntries && traceEntries.length > 0) {
      // Find the most recent trace entry that involved this query
      const reqTypeName = `QUERY_${queryName.toUpperCase()}`;
      const constraintName = `${PREFIX}${queryName}_fetch`;

      for (let i = traceEntries.length - 1; i >= 0; i--) {
        const entry = traceEntries[i]!;
        const relevantConstraint = entry.constraintsHit?.find(
          (c) => c.id === constraintName || c.id.includes(queryName),
        );
        const relevantReq = entry.requirementsAdded?.find(
          (r) => r.type === reqTypeName,
        );

        if (relevantConstraint || relevantReq) {
          lines.push("  Last fetch causal chain:");

          // What facts changed to trigger this
          if (entry.factChanges?.length > 0) {
            const relevant = entry.factChanges.filter(
              (fc) => !fc.key.startsWith("_q_") || fc.key.includes(queryName),
            );
            for (const fc of relevant) {
              const oldStr =
                typeof fc.oldValue === "string"
                  ? `"${fc.oldValue}"`
                  : JSON.stringify(fc.oldValue);
              const newStr =
                typeof fc.newValue === "string"
                  ? `"${fc.newValue}"`
                  : JSON.stringify(fc.newValue);
              lines.push(`    Fact changed: ${fc.key} ${oldStr} -> ${newStr}`);
            }
          }

          // Which constraint fired
          if (relevantConstraint) {
            lines.push(
              `    Constraint: ${relevantConstraint.id} (priority ${relevantConstraint.priority})`,
            );
            if (relevantConstraint.deps?.length > 0) {
              lines.push(
                `    Dependencies: ${relevantConstraint.deps.join(", ")}`,
              );
            }
          }

          // Resolver completion
          if (entry.resolversCompleted?.length > 0) {
            const resolver = entry.resolversCompleted.find((r) =>
              r.resolver.includes(queryName),
            );
            if (resolver) {
              lines.push(`    Resolved in: ${resolver.duration}ms`);
            }
          }

          break; // Only show the most recent relevant entry
        }
      }
    }
  } catch {
    // explain()/trace() may not be available — skip silently
  }

  return lines.join("\n");
}

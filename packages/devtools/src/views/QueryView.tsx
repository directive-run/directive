import { useCallback, useEffect, useMemo, useState } from "react";
import {
  QUERY_LANE_COLORS,
  QUERY_SPAN_COLORS,
  QUERY_STATUS_COLORS,
} from "../lib/colors";
import { BLOCKED_KEYS } from "../lib/constants";
import { formatAge, formatDuration } from "../lib/time-format";
import type { DebugEvent } from "../lib/types";

// ============================================================================
// Types
// ============================================================================

type QueryKind = "query" | "mutation" | "subscription" | "infinite";

interface QueryEntry {
  name: string;
  kind: QueryKind;
  status: "pending" | "success" | "error" | "disabled";
  data: unknown;
  error: string | null;
  dataUpdatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  failureCount: number;
  cacheKey: string | null;
}

interface FetchSpan {
  queryName: string;
  startTime: number;
  endTime: number | null;
  status: "success" | "error" | "pending";
  duration?: number;
  resolver?: string;
}

interface TriggerDot {
  queryName: string;
  timestamp: number;
  type: "constraint" | "tag_invalidate" | "fact_change";
  detail?: string;
}

interface ExplainStep {
  icon: string;
  label: string;
  detail?: string;
  color: string;
}

type SubTab = "list" | "timeline" | "explain";

// ============================================================================
// Constants
// ============================================================================

/** Known suffixes used by @directive-run/query's buildKey() — longest first */
const KNOWN_SUFFIXES = [
  "_initial_resolve",
  "_next_resolve",
  "_prev_resolve",
  "_prevData",
  "_trigger",
  "_initial",
  "_resolve",
  "_online",
  "_state",
  "_focus",
  "_fetch",
  "_next",
  "_prev",
  "_poll",
  "_vars",
  "_key",
  "_sub",
  "_gc",
] as const;

const KIND_LABELS: Record<QueryKind, string> = {
  query: "Query",
  mutation: "Mutation",
  subscription: "Sub",
  infinite: "Infinite",
};

const KIND_COLORS: Record<QueryKind, string> = {
  query: "bg-cyan-500/20 text-cyan-400",
  mutation: "bg-fuchsia-500/20 text-fuchsia-400",
  subscription: "bg-teal-500/20 text-teal-400",
  infinite: "bg-violet-500/20 text-violet-400",
};

/** Sort priority for query status (lower = higher priority) */
const STATUS_ORDER: Record<string, number> = {
  fetching: 0,
  pending: 1,
  success: 2,
  error: 3,
  disabled: 4,
};

// ============================================================================
// Helpers
// ============================================================================

/** @internal Get the effective display status (fetching overrides base status) */
export function getEffectiveStatus(q: QueryEntry): string {
  if (q.isFetching) {
    return "fetching";
  }

  return q.status;
}

/**
 * @internal Extract query name from a _q_ prefixed ID.
 * Strips known suffixes from the right instead of splitting on first underscore,
 * so query names with underscores (e.g., user_profile) are preserved.
 */
export function extractQueryName(id: string): string | null {
  if (!id.startsWith("_q_")) {
    return null;
  }
  const rest = id.slice(3); // strip "_q_"

  // Try longest suffixes first (e.g., _initial_resolve before _initial)
  for (const suffix of KNOWN_SUFFIXES) {
    if (rest.endsWith(suffix)) {
      const name = rest.slice(0, -suffix.length);

      // Empty name means the "name" IS the suffix (e.g., _q__state)
      return name.length > 0 ? name : null;
    }
  }

  // Fallback: return the whole rest if no known suffix matched
  return rest || null;
}

/**
 * @internal Detect query kind from snapshot fact keys and state shape.
 *
 * Detection strategy uses FACT keys (not constraint/effect keys):
 * - Mutation: has `_q_{name}_vars` fact
 * - Infinite: state.pages is an array (InfiniteResourceState)
 * - Subscription: has `_q_{name}_key` but NO `_q_{name}_trigger`
 * - Query: everything else
 */
export function detectKind(
  name: string,
  // biome-ignore lint/suspicious/noExplicitAny: snapshot shape is untyped
  snapshot: any,
): QueryKind {
  // Mutations have a _vars fact for storing variables
  if (snapshot[`_q_${name}_vars`] !== undefined) {
    return "mutation";
  }

  // Infinite queries have pages array in their ResourceState
  const state = snapshot[`_q_${name}_state`] as
    | Record<string, unknown>
    | undefined;
  if (state && Array.isArray(state.pages)) {
    return "infinite";
  }

  // Subscriptions have _key but no _trigger (queries always have _trigger)
  if (
    snapshot[`_q_${name}_key`] !== undefined &&
    snapshot[`_q_${name}_trigger`] === undefined
  ) {
    return "subscription";
  }

  return "query";
}

/** @internal Safely stringify data, handling circular refs and BigInt */
export function safeStringify(data: unknown, maxLen = 500): string {
  try {
    const str = JSON.stringify(
      data,
      (_key, value) => {
        if (typeof value === "bigint") {
          return `${value}n`;
        }

        return value;
      },
      2,
    );
    if (!str) {
      return "[undefined]";
    }
    if (str.length <= maxLen) {
      return str;
    }

    return `${str.slice(0, maxLen)}\n... (truncated, ${str.length} chars total)`;
  } catch {
    return "[unserializable]";
  }
}

/** @internal Parse events into timeline spans and trigger dots */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: event type branching
export function parseTimelineData(events: DebugEvent[]): {
  spans: FetchSpan[];
  triggers: TriggerDot[];
} {
  const spans: FetchSpan[] = [];
  const triggers: TriggerDot[] = [];
  const inflight = new Map<
    string,
    { queryName: string; timestamp: number; resolver: string }
  >();

  for (const event of events) {
    const type = event.type as string;
    const ts = event.timestamp;

    if (type === "resolver_start") {
      const resolverId = (event.resolverId ?? event.resolver ?? "") as string;
      const queryName = extractQueryName(resolverId);
      if (queryName) {
        inflight.set(resolverId, {
          queryName,
          timestamp: ts,
          resolver: resolverId,
        });
      }
    } else if (type === "resolver_complete") {
      const resolverId = (event.resolverId ?? event.resolver ?? "") as string;
      const start = inflight.get(resolverId);
      if (start) {
        spans.push({
          queryName: start.queryName,
          startTime: start.timestamp,
          endTime: ts,
          status: "success",
          duration: (event.durationMs as number) ?? ts - start.timestamp,
          resolver: resolverId,
        });
        inflight.delete(resolverId);
      }
    } else if (type === "resolver_error") {
      const resolverId = (event.resolverId ?? event.resolver ?? "") as string;
      const start = inflight.get(resolverId);
      if (start) {
        spans.push({
          queryName: start.queryName,
          startTime: start.timestamp,
          endTime: ts,
          status: "error",
          duration: ts - start.timestamp,
          resolver: resolverId,
        });
        inflight.delete(resolverId);
      }
    } else if (type === "constraint_evaluate") {
      const constraintId = (event.constraintId ??
        event.constraint ??
        "") as string;
      const queryName = extractQueryName(constraintId);
      if (queryName && event.active) {
        triggers.push({
          queryName,
          timestamp: ts,
          type: "constraint",
          detail: constraintId.slice(3),
        });
      }
    }
  }

  for (const [, start] of inflight) {
    spans.push({
      queryName: start.queryName,
      startTime: start.timestamp,
      endTime: null,
      status: "pending",
      resolver: start.resolver,
    });
  }

  return { spans, triggers };
}

/** @internal Build explain steps for a specific query */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: status branching for UI
export function buildExplainSteps(
  queryName: string,
  query: QueryEntry,
  events: DebugEvent[],
): ExplainStep[] {
  const steps: ExplainStep[] = [];
  const prefix = `_q_${queryName}`;

  const relevantEvents = events.filter((e) => {
    const id = (e.resolverId ??
      e.resolver ??
      e.constraintId ??
      e.constraint ??
      "") as string;

    return extractQueryName(id) === queryName;
  });

  let lastConstraint: string | null = null;
  let lastResolverStart: number | null = null;

  for (const event of relevantEvents) {
    const type = event.type as string;

    if (type === "constraint_evaluate" && event.active) {
      const id = (event.constraintId ?? event.constraint ?? "") as string;
      const suffix = id.slice(prefix.length + 1);
      lastConstraint = suffix;
      steps.push({
        icon: "\u26A1",
        label: `Constraint triggered: ${suffix || "shouldFetch"}`,
        detail: "Query conditions met \u2013 fetch needed",
        color: "text-indigo-400",
      });
    } else if (type === "resolver_start") {
      lastResolverStart = event.timestamp;
      steps.push({
        icon: "\u2192",
        label: "Fetcher started",
        detail: lastConstraint
          ? `Triggered by ${lastConstraint}`
          : "Resolver executing",
        color: "text-blue-400",
      });
    } else if (type === "resolver_complete") {
      const duration = (event.durationMs as number) ?? 0;
      steps.push({
        icon: "\u2713",
        label: `Fetched successfully (${formatDuration(duration)})`,
        detail: lastResolverStart
          ? `Started at ${new Date(lastResolverStart).toLocaleTimeString()}`
          : undefined,
        color: "text-emerald-400",
      });
      lastConstraint = null;
      lastResolverStart = null;
    } else if (type === "resolver_error") {
      const errorMsg = (event.errorMessage ??
        event.error ??
        "Unknown") as string;
      steps.push({
        icon: "\u2717",
        label: "Fetch failed",
        detail: errorMsg,
        color: "text-red-400",
      });
      lastConstraint = null;
      lastResolverStart = null;
    }
  }

  // If no events, build from current state
  if (steps.length === 0) {
    if (query.status === "disabled") {
      steps.push({
        icon: "\u23F8",
        label: "Query is disabled",
        detail: "Key returned null \u2013 query not active",
        color: "text-zinc-400",
      });
    } else if (query.status === "pending") {
      steps.push({
        icon: "\u23F3",
        label: "Waiting for data",
        detail: query.isFetching
          ? "Currently fetching"
          : "Fetch not yet started",
        color: "text-amber-400",
      });
    } else if (query.status === "success") {
      steps.push({
        icon: "\u2713",
        label: "Data loaded",
        detail: query.dataUpdatedAt
          ? `Last updated ${formatAge(query.dataUpdatedAt)}`
          : "Has cached data",
        color: "text-emerald-400",
      });
      if (query.isStale) {
        steps.push({
          icon: "\u23F0",
          label: "Data is stale",
          detail: "Will refetch on next trigger",
          color: "text-amber-400",
        });
      }
    } else if (query.status === "error") {
      steps.push({
        icon: "\u2717",
        label: `${KIND_LABELS[query.kind]} errored`,
        detail: query.error ?? "Unknown error",
        color: "text-red-400",
      });
      if (query.failureCount > 1) {
        steps.push({
          icon: "\u21BB",
          label: `Failed ${query.failureCount} times`,
          detail: "Retry attempts exhausted or ongoing",
          color: "text-red-400",
        });
      }
    }

    if (query.cacheKey) {
      steps.push({
        icon: "\uD83D\uDDDD",
        label: `Cache key: ${query.cacheKey}`,
        color: "text-zinc-500",
      });
    }
  }

  return steps;
}

/** @internal Extract queries from snapshot and/or events */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: snapshot parsing with type coercion
export function extractQueries(
  events: DebugEvent[],
  // biome-ignore lint/suspicious/noExplicitAny: snapshot shape is untyped at boundary
  snapshot: any,
): QueryEntry[] {
  const queries: QueryEntry[] = [];

  if (snapshot) {
    const seen = new Set<string>();
    for (const key of Object.keys(snapshot)) {
      if (BLOCKED_KEYS.has(key)) {
        continue;
      }
      if (!key.startsWith("_q_") || !key.endsWith("_state")) {
        continue;
      }

      const name = key.slice(3, -6);
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);

      const state = snapshot[key] as Record<string, unknown> | undefined;
      if (!state) {
        continue;
      }

      const rawStatus = state.status as string | undefined;
      const status: QueryEntry["status"] =
        rawStatus === "pending" ||
        rawStatus === "success" ||
        rawStatus === "error"
          ? rawStatus
          : "disabled";

      queries.push({
        name,
        kind: detectKind(name, snapshot),
        status,
        data: state.data ?? null,
        error:
          state.error instanceof Error
            ? state.error.message
            : state.error
              ? String(state.error)
              : null,
        dataUpdatedAt: (state.dataUpdatedAt as number) ?? null,
        isFetching: (state.isFetching as boolean) ?? false,
        isStale: (state.isStale as boolean) ?? false,
        failureCount: (state.failureCount as number) ?? 0,
        cacheKey: (snapshot[`_q_${name}_key`] as string) ?? null,
      });
    }
  }

  // Fallback: extract from events for systems without snapshots
  if (queries.length === 0 && events.length > 0) {
    const queryNames = new Set<string>();
    for (const event of events) {
      const id = (event.constraintId ??
        event.constraint ??
        event.resolverId ??
        event.resolver ??
        "") as string;
      if (typeof id === "string" && id.startsWith("_q_")) {
        const name = extractQueryName(id);
        if (name) {
          queryNames.add(name);
        }
      }
    }
    for (const name of queryNames) {
      queries.push({
        name,
        kind: "query",
        status: "disabled",
        data: null,
        error: null,
        dataUpdatedAt: null,
        isFetching: false,
        isStale: false,
        failureCount: 0,
        cacheKey: null,
      });
    }
  }

  // Sort: fetching first, then pending, then success, then error, then disabled
  queries.sort(
    (a, b) =>
      (STATUS_ORDER[getEffectiveStatus(a)] ?? 9) -
        (STATUS_ORDER[getEffectiveStatus(b)] ?? 9) ||
      a.name.localeCompare(b.name),
  );

  return queries;
}

// ============================================================================
// Hook: live-updating tick for formatAge freshness
// ============================================================================

function useAgeTick(intervalMs = 5000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);

    return () => clearInterval(id);
  }, [intervalMs]);

  return tick;
}

// ============================================================================
// JsonTree — Interactive collapsible data explorer
// ============================================================================

const TYPE_COLORS: Record<string, string> = {
  string: "text-emerald-400",
  number: "text-amber-400",
  boolean: "text-violet-400",
  null: "text-zinc-500",
  key: "text-cyan-300",
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: type-based branching for value rendering
function JsonNode({
  label,
  value,
  depth,
}: {
  label?: string;
  value: unknown;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  if (value === null) {
    return (
      <div
        className="flex items-baseline gap-1"
        style={{ paddingLeft: depth * 12 }}
      >
        {label && <span className={TYPE_COLORS.key}>{label}:</span>}
        <span className={TYPE_COLORS.null}>null</span>
      </div>
    );
  }

  if (value === undefined) {
    return (
      <div
        className="flex items-baseline gap-1"
        style={{ paddingLeft: depth * 12 }}
      >
        {label && <span className={TYPE_COLORS.key}>{label}:</span>}
        <span className={TYPE_COLORS.null}>undefined</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return (
      <div
        className="flex items-baseline gap-1"
        style={{ paddingLeft: depth * 12 }}
      >
        {label && <span className={TYPE_COLORS.key}>{label}:</span>}
        <span className={TYPE_COLORS.string}>
          &quot;{value.length > 120 ? `${value.slice(0, 117)}...` : value}&quot;
        </span>
      </div>
    );
  }

  if (typeof value === "number" || typeof value === "bigint") {
    return (
      <div
        className="flex items-baseline gap-1"
        style={{ paddingLeft: depth * 12 }}
      >
        {label && <span className={TYPE_COLORS.key}>{label}:</span>}
        <span className={TYPE_COLORS.number}>{String(value)}</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div
        className="flex items-baseline gap-1"
        style={{ paddingLeft: depth * 12 }}
      >
        {label && <span className={TYPE_COLORS.key}>{label}:</span>}
        <span className={TYPE_COLORS.boolean}>{String(value)}</span>
      </div>
    );
  }

  // Arrays and objects
  if (typeof value === "object") {
    const isArray = Array.isArray(value);
    const entries = isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);
    const count = entries.length;
    const preview = isArray ? `Array(${count})` : `{${count} keys}`;
    const openBrace = isArray ? "[" : "{";
    const closeBrace = isArray ? "]" : "}";

    if (count === 0) {
      return (
        <div
          className="flex items-baseline gap-1"
          style={{ paddingLeft: depth * 12 }}
        >
          {label && <span className={TYPE_COLORS.key}>{label}:</span>}
          <span className="text-zinc-500">{isArray ? "[]" : "{}"}</span>
        </div>
      );
    }

    return (
      <div style={{ paddingLeft: depth * 12 }}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-baseline gap-1 hover:bg-zinc-800/50 rounded px-0.5 -ml-0.5"
        >
          <span className="text-zinc-600 w-3 text-center">
            {expanded ? "\u25BE" : "\u25B8"}
          </span>
          {label && <span className={TYPE_COLORS.key}>{label}:</span>}
          {!expanded && (
            <span className="text-zinc-500">
              {openBrace} {preview} {closeBrace}
            </span>
          )}
          {expanded && <span className="text-zinc-600">{openBrace}</span>}
        </button>
        {expanded && (
          <>
            {entries.slice(0, 100).map(([k, v]) => (
              <JsonNode
                key={k}
                label={isArray ? undefined : k}
                value={v}
                depth={depth + 1}
              />
            ))}
            {count > 100 && (
              <div
                className="text-zinc-600 italic"
                style={{ paddingLeft: (depth + 1) * 12 }}
              >
                ... {count - 100} more entries
              </div>
            )}
            <div style={{ paddingLeft: depth * 12 }}>
              <span className="text-zinc-600">{closeBrace}</span>
            </div>
          </>
        )}
      </div>
    );
  }

  // Fallback for functions, symbols, etc.
  return (
    <div
      className="flex items-baseline gap-1"
      style={{ paddingLeft: depth * 12 }}
    >
      {label && <span className={TYPE_COLORS.key}>{label}:</span>}
      <span className="text-zinc-500">{String(value)}</span>
    </div>
  );
}

function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="max-h-48 overflow-auto rounded bg-zinc-900 p-2 text-[10px] font-mono leading-4">
      <JsonNode value={data} depth={0} />
    </div>
  );
}

// ============================================================================
// Query Actions — dispatch actions to the host system
// ============================================================================

const DEVTOOLS_ACTION_EVENT = "directive-devtools-action";

function dispatchQueryAction(
  queryName: string,
  action: "refetch" | "invalidate" | "reset",
) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.dispatchEvent(
      new CustomEvent(DEVTOOLS_ACTION_EVENT, {
        detail: { target: "query", queryName, action, timestamp: Date.now() },
      }),
    );
  } catch {
    // Devtools actions must never crash the panel
  }
}

// ============================================================================
// Query List Panel
// ============================================================================

function QueryListPanel({
  queries,
  filter,
  onFilterChange,
}: {
  queries: QueryEntry[];
  filter: string;
  onFilterChange: (value: string) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  useAgeTick();

  const filtered = useMemo(() => {
    if (!filter) {
      return queries;
    }
    const lower = filter.toLowerCase();

    return queries.filter(
      (q) =>
        q.name.toLowerCase().includes(lower) ||
        getEffectiveStatus(q).includes(lower) ||
        q.kind.includes(lower) ||
        (q.isStale && "stale".includes(lower)),
    );
  }, [queries, filter]);

  if (queries.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
        No queries detected. Add{" "}
        <code className="mx-1 rounded bg-zinc-800 px-1 text-xs text-fuchsia-400">
          @directive-run/query
        </code>{" "}
        with{" "}
        <code className="mx-1 rounded bg-zinc-800 px-1 text-xs text-fuchsia-400">
          devtoolsPlugin()
        </code>{" "}
        to see queries here.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Search filter */}
      <input
        type="text"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Filter by name, status, or type..."
        aria-label="Filter queries"
        className="w-full rounded border border-zinc-700 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus-visible:ring-2 focus-visible:ring-cyan-500/50"
      />

      {filtered.length === 0 && (
        <div className="py-4 text-center text-xs text-zinc-500">
          No matches for &ldquo;{filter}&rdquo;
        </div>
      )}

      {filtered.map((q) => {
        const statusLabel = getEffectiveStatus(q);
        const isSelected = selected === q.name;

        return (
          <div key={q.name}>
            <button
              type="button"
              aria-expanded={isSelected}
              aria-controls={isSelected ? `query-detail-${q.name}` : undefined}
              onClick={() => setSelected(isSelected ? null : q.name)}
              className={`flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${
                isSelected ? "bg-zinc-800" : "hover:bg-zinc-800/50"
              }`}
            >
              {/* Kind badge */}
              <span
                className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${KIND_COLORS[q.kind]}`}
              >
                {KIND_LABELS[q.kind]}
              </span>

              {/* Status badge */}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  QUERY_STATUS_COLORS[statusLabel] ??
                  QUERY_STATUS_COLORS.disabled
                }`}
              >
                {statusLabel}
              </span>

              {/* Name */}
              <span className="font-mono text-zinc-200">{q.name}</span>

              {/* Cache age */}
              <span className="ml-auto text-zinc-500">
                {formatAge(q.dataUpdatedAt)}
              </span>

              {/* Stale indicator */}
              {q.isStale && (
                <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] text-amber-400">
                  stale
                </span>
              )}

              {/* Failure count */}
              {q.failureCount > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] text-red-400">
                  {q.failureCount}x
                </span>
              )}
            </button>

            {/* Expanded details */}
            {isSelected && (
              <div
                id={`query-detail-${q.name}`}
                className="ml-4 border-l border-zinc-700 py-2 pl-4 text-xs text-zinc-400"
              >
                {q.cacheKey && (
                  <div>
                    <span className="text-zinc-500">Cache key:</span>{" "}
                    <code className="text-zinc-300">{q.cacheKey}</code>
                  </div>
                )}
                {q.error && (
                  <div className="mt-1 text-red-400">Error: {q.error}</div>
                )}
                {q.data !== null && q.data !== undefined && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                      Data preview
                    </summary>
                    <div className="mt-1">
                      <JsonTree data={q.data} />
                    </div>
                  </details>
                )}

                {/* Action buttons */}
                <div className="mt-2 flex items-center gap-2">
                  {q.kind !== "mutation" && (
                    <button
                      type="button"
                      onClick={() => dispatchQueryAction(q.name, "refetch")}
                      className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                    >
                      Refetch
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => dispatchQueryAction(q.name, "invalidate")}
                    className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
                  >
                    Invalidate
                  </button>
                  <button
                    type="button"
                    onClick={() => dispatchQueryAction(q.name, "reset")}
                    className="rounded border border-red-900/50 bg-red-950/30 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-950/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Timeline Panel — Swim lanes with fetch bars
// ============================================================================

function TimelinePanel({
  queries,
  events,
}: {
  queries: QueryEntry[];
  events: DebugEvent[];
}) {
  const { spans, triggers } = useMemo(
    () => parseTimelineData(events),
    [events],
  );

  const allNames = useMemo(() => {
    const names = new Set<string>();
    for (const q of queries) {
      names.add(q.name);
    }
    for (const s of spans) {
      names.add(s.queryName);
    }
    for (const t of triggers) {
      names.add(t.queryName);
    }

    return [...names].sort();
  }, [queries, spans, triggers]);

  // Pre-group spans and triggers by query name — O(N+M) instead of O(N*M)
  const spansByName = useMemo(() => {
    const map = new Map<string, FetchSpan[]>();
    for (const s of spans) {
      const arr = map.get(s.queryName);
      if (arr) {
        arr.push(s);
      } else {
        map.set(s.queryName, [s]);
      }
    }

    return map;
  }, [spans]);

  const triggersByName = useMemo(() => {
    const map = new Map<string, TriggerDot[]>();
    for (const t of triggers) {
      const arr = map.get(t.queryName);
      if (arr) {
        arr.push(t);
      } else {
        map.set(t.queryName, [t]);
      }
    }

    return map;
  }, [triggers]);

  const queriesByName = useMemo(() => {
    const map = new Map<string, QueryEntry>();
    for (const q of queries) {
      map.set(q.name, q);
    }

    return map;
  }, [queries]);

  // Event-based timeline with swim lanes
  if (spans.length > 0 || triggers.length > 0) {
    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;
    for (const s of spans) {
      minTime = Math.min(minTime, s.startTime);
      maxTime = Math.max(maxTime, s.endTime ?? Date.now());
    }
    for (const t of triggers) {
      minTime = Math.min(minTime, t.timestamp);
      maxTime = Math.max(maxTime, t.timestamp);
    }

    const duration = Math.max(maxTime - minTime, 100);
    const padding = duration * 0.05;
    const rangeStart = minTime - padding;
    const rangeDuration = duration + padding * 2;

    return (
      <div className="space-y-1">
        <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-600">
          <span>{new Date(rangeStart).toLocaleTimeString()}</span>
          <span>
            {new Date(rangeStart + rangeDuration).toLocaleTimeString()}
          </span>
        </div>

        {allNames.map((name, laneIdx) => {
          const laneColor =
            QUERY_LANE_COLORS[laneIdx % QUERY_LANE_COLORS.length];
          const laneSpans = spansByName.get(name) ?? [];
          const laneTriggers = triggersByName.get(name) ?? [];
          const query = queriesByName.get(name);

          return (
            <div key={name} className="flex items-center gap-2">
              <div
                className="w-24 shrink-0 truncate text-right font-mono text-[10px]"
                style={{ color: laneColor }}
                title={name}
              >
                {name}
              </div>

              <div className="relative h-6 flex-1 rounded bg-zinc-800/50">
                {laneSpans.map((span) => {
                  const leftPct =
                    ((span.startTime - rangeStart) / rangeDuration) * 100;
                  const endTime = span.endTime ?? Date.now();
                  const widthPct =
                    ((endTime - span.startTime) / rangeDuration) * 100;

                  return (
                    <div
                      key={`${name}-${span.startTime}-${span.status}`}
                      className="absolute top-1 h-4 rounded"
                      style={{
                        left: `${Math.min(leftPct, 99)}%`,
                        width: `max(${Math.max(widthPct, 0.3)}%, 4px)`,
                        backgroundColor: QUERY_SPAN_COLORS[span.status],
                        opacity: 0.85,
                      }}
                      title={`${name}: ${span.status}${span.duration ? ` (${formatDuration(span.duration)})` : ""}`}
                    >
                      {widthPct > 8 && (
                        <span className="block truncate px-1 text-[8px] leading-4 text-white/90">
                          {span.duration
                            ? formatDuration(span.duration)
                            : "..."}
                        </span>
                      )}
                    </div>
                  );
                })}

                {laneTriggers.map((trigger) => {
                  const leftPct =
                    ((trigger.timestamp - rangeStart) / rangeDuration) * 100;

                  return (
                    <div
                      key={`${name}-trig-${trigger.timestamp}`}
                      className="absolute top-2 h-2 w-2 rounded-full bg-indigo-400"
                      style={{
                        left: `${Math.min(leftPct, 99)}%`,
                      }}
                      title={`Constraint: ${trigger.detail ?? trigger.type}`}
                    />
                  );
                })}

                {query && (
                  <div
                    className="absolute right-1 top-1.5 h-3 w-3 rounded-full"
                    style={{
                      backgroundColor: query.isFetching
                        ? QUERY_SPAN_COLORS.pending
                        : (QUERY_SPAN_COLORS[query.status] ?? "#71717a"),
                    }}
                    title={`Current: ${getEffectiveStatus(query)}`}
                  />
                )}
              </div>
            </div>
          );
        })}

        <div className="mt-3 flex items-center gap-4 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-4 rounded"
              style={{ backgroundColor: QUERY_SPAN_COLORS.success }}
            />
            Success
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-4 rounded"
              style={{ backgroundColor: QUERY_SPAN_COLORS.error }}
            />
            Error
          </span>
          <span className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-4 rounded"
              style={{ backgroundColor: QUERY_SPAN_COLORS.pending }}
            />
            Fetching
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-indigo-400" />
            Trigger
          </span>
        </div>
      </div>
    );
  }

  // Fallback: snapshot-based timeline using dataUpdatedAt
  if (queries.length > 0) {
    const withTimestamp = queries.filter((q) => q.dataUpdatedAt);
    if (withTimestamp.length === 0) {
      return (
        <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
          No fetch history yet. Queries will appear here after their first
          fetch.
        </div>
      );
    }

    let minTime = Number.POSITIVE_INFINITY;
    let maxTime = Number.NEGATIVE_INFINITY;
    for (const q of withTimestamp) {
      minTime = Math.min(minTime, q.dataUpdatedAt!);
      maxTime = Math.max(maxTime, q.dataUpdatedAt!);
    }
    const duration = Math.max(maxTime - minTime, 1000);
    const padding = duration * 0.1;
    const rangeStart = minTime - padding;
    const rangeDuration = duration + padding * 2;

    return (
      <div className="space-y-1">
        <div className="mb-2 flex items-center justify-between text-[10px] text-zinc-600">
          <span>{new Date(rangeStart).toLocaleTimeString()}</span>
          <span>
            {new Date(rangeStart + rangeDuration).toLocaleTimeString()}
          </span>
        </div>

        {queries.map((q, idx) => {
          const laneColor = QUERY_LANE_COLORS[idx % QUERY_LANE_COLORS.length];

          return (
            <div key={q.name} className="flex items-center gap-2">
              <div
                className="w-24 shrink-0 truncate text-right font-mono text-[10px]"
                style={{ color: laneColor }}
                title={q.name}
              >
                {q.name}
              </div>
              <div className="relative h-6 flex-1 rounded bg-zinc-800/50">
                {q.dataUpdatedAt && (
                  <div
                    className="absolute top-1 h-4 w-4 rounded-full"
                    style={{
                      left: `${Math.min(((q.dataUpdatedAt - rangeStart) / rangeDuration) * 100, 96)}%`,
                      backgroundColor: QUERY_SPAN_COLORS[q.status] ?? "#71717a",
                    }}
                    title={`${q.name}: ${q.status} – ${formatAge(q.dataUpdatedAt)}`}
                  />
                )}
              </div>
            </div>
          );
        })}

        <p className="mt-3 text-[10px] text-zinc-600">
          Showing last-fetched timestamps. Enable devtools events for detailed
          fetch bars.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
      No queries detected. Timeline will populate when queries start fetching.
    </div>
  );
}

// ============================================================================
// Explain Panel — Why did it fetch?
// ============================================================================

function ExplainPanel({
  queries,
  events,
}: {
  queries: QueryEntry[];
  events: DebugEvent[];
}) {
  const [selectedQuery, setSelectedQuery] = useState<string | null>(null);
  useAgeTick();

  const active = selectedQuery ?? queries[0]?.name ?? null;
  const query = queries.find((q) => q.name === active);

  const steps = useMemo(() => {
    if (!active || !query) {
      return [];
    }

    return buildExplainSteps(active, query, events);
  }, [active, query, events]);

  if (queries.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
        No queries to explain. Add queries to your system to see causal chains.
      </div>
    );
  }

  if (!query) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Query selector */}
      <div className="flex items-center gap-2">
        <label htmlFor="explain-query-select" className="text-xs text-zinc-500">
          Query:
        </label>
        <select
          id="explain-query-select"
          value={active ?? ""}
          onChange={(e) => setSelectedQuery(e.target.value || null)}
          className="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-200 outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50"
        >
          {queries.map((q) => (
            <option key={q.name} value={q.name}>
              {q.name} ({getEffectiveStatus(q)})
            </option>
          ))}
        </select>
      </div>

      {/* Status summary */}
      <div className="flex items-center gap-3 rounded bg-zinc-800/50 px-3 py-2">
        <span
          className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium ${KIND_COLORS[query.kind]}`}
        >
          {KIND_LABELS[query.kind]}
        </span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
            QUERY_STATUS_COLORS[getEffectiveStatus(query)] ??
            QUERY_STATUS_COLORS.disabled
          }`}
        >
          {getEffectiveStatus(query)}
        </span>
        <span className="font-mono text-xs text-zinc-200">{query.name}</span>
        {query.dataUpdatedAt && (
          <span className="ml-auto text-[10px] text-zinc-500">
            Updated {formatAge(query.dataUpdatedAt)}
          </span>
        )}
      </div>

      {/* Causal chain */}
      <div className="space-y-0" role="list" aria-label="Causal chain">
        {steps.map((step, idx) => (
          <div
            key={`${idx}-${step.icon}-${step.label}`}
            className="flex items-start gap-3"
            role="listitem"
          >
            <div className="flex w-5 flex-col items-center">
              <span className={`text-sm ${step.color}`}>{step.icon}</span>
              {idx < steps.length - 1 && (
                <div className="h-4 w-px bg-zinc-700" />
              )}
            </div>
            <div className="pb-2">
              <div className={`text-xs font-medium ${step.color}`}>
                {step.label}
              </div>
              {step.detail && (
                <div className="text-[10px] text-zinc-500">{step.detail}</div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Data preview */}
      {query.data !== null && query.data !== undefined && (
        <details className="rounded border border-zinc-800">
          <summary className="cursor-pointer px-3 py-1.5 text-xs text-zinc-500 hover:text-zinc-300">
            Data preview
          </summary>
          <div className="border-t border-zinc-800 p-2">
            <JsonTree data={query.data} />
          </div>
        </details>
      )}

      {/* Error details */}
      {query.error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {query.error}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// QueryView — Main view with inner tabs
// ============================================================================

interface QueryViewProps {
  events: DebugEvent[];
  // biome-ignore lint/suspicious/noExplicitAny: snapshot has untyped _q_ keys from query system
  snapshot?: any;
}

export function QueryView({ events, snapshot }: QueryViewProps) {
  const [subTab, setSubTab] = useState<SubTab>("list");
  const [filter, setFilter] = useState("");

  const queries = useMemo(
    () => extractQueries(events, snapshot),
    [events, snapshot],
  );

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const tabIds: SubTab[] = ["list", "timeline", "explain"];
      const currentIdx = tabIds.indexOf(subTab);
      let nextIdx = currentIdx;

      if (e.key === "ArrowRight") {
        nextIdx = (currentIdx + 1) % tabIds.length;
      } else if (e.key === "ArrowLeft") {
        nextIdx = (currentIdx - 1 + tabIds.length) % tabIds.length;
      } else if (e.key === "Home") {
        nextIdx = 0;
      } else if (e.key === "End") {
        nextIdx = tabIds.length - 1;
      } else {
        return;
      }

      e.preventDefault();
      setSubTab(tabIds[nextIdx]!);

      const nextTabEl = document.getElementById(`tab-q-${tabIds[nextIdx]}`);
      nextTabEl?.focus();
    },
    [subTab],
  );

  // Summary stats for the status bar
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    let staleCount = 0;
    for (const q of queries) {
      const s = getEffectiveStatus(q);
      counts[s] = (counts[s] ?? 0) + 1;
      if (q.isStale) {
        staleCount++;
      }
    }
    if (staleCount > 0) {
      counts.stale = staleCount;
    }

    return counts;
  }, [queries]);

  const tabs: { id: SubTab; label: string; count?: number }[] = [
    { id: "list", label: "Queries", count: queries.length },
    { id: "timeline", label: "Timeline" },
    { id: "explain", label: "Explain" },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Inner tab bar */}
      <div
        className="flex items-center gap-4 border-b border-zinc-800 px-6 py-2"
        role="tablist"
        aria-label="Query view tabs"
        onKeyDown={handleTabKeyDown}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            id={`tab-q-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            aria-controls={`panel-q-${tab.id}`}
            tabIndex={subTab === tab.id ? 0 : -1}
            onClick={() => setSubTab(tab.id)}
            className={`text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/50 ${
              subTab === tab.id
                ? "border-b-2 border-cyan-500 pb-1 text-cyan-400"
                : "pb-1 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-cyan-500/20 px-1.5 text-[10px] text-cyan-400">
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Summary stats */}
      {queries.length > 0 && (
        <div className="flex items-center gap-3 border-b border-zinc-800/50 px-6 py-1.5 text-[10px] text-zinc-500">
          <span>{queries.length} total</span>
          {Object.entries(stats).map(([status, count]) => (
            <span key={status} className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    QUERY_SPAN_COLORS[status] ??
                    (status === "fetching"
                      ? QUERY_SPAN_COLORS.pending
                      : status === "stale"
                        ? "#f59e0b"
                        : "#71717a"),
                }}
              />
              {count} {status}
            </span>
          ))}
        </div>
      )}

      {/* Panel content */}
      <div
        role="tabpanel"
        id={`panel-q-${subTab}`}
        aria-labelledby={`tab-q-${subTab}`}
        className="flex-1 overflow-y-auto p-6"
      >
        {subTab === "list" && (
          <QueryListPanel
            queries={queries}
            filter={filter}
            onFilterChange={setFilter}
          />
        )}
        {subTab === "timeline" && (
          <TimelinePanel queries={queries} events={events} />
        )}
        {subTab === "explain" && (
          <ExplainPanel queries={queries} events={events} />
        )}
      </div>
    </div>
  );
}

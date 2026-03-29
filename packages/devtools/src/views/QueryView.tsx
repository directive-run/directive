import { useState } from "react";

// ============================================================================
// Types
// ============================================================================

interface QueryEntry {
  name: string;
  status: "pending" | "success" | "error" | "idle";
  data: unknown;
  error: string | null;
  dataUpdatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  failureCount: number;
  cacheKey: string | null;
}

type SubTab = "list" | "timeline" | "explain";

// ============================================================================
// Helpers
// ============================================================================

const STATUS_COLORS: Record<string, string> = {
  success: "bg-emerald-500/20 text-emerald-400",
  pending: "bg-amber-500/20 text-amber-400",
  error: "bg-red-500/20 text-red-400",
  idle: "bg-zinc-500/20 text-zinc-400",
  fetching: "bg-blue-500/20 text-blue-400",
};

function formatAge(updatedAt: number | null): string {
  if (!updatedAt) {
    return "–";
  }
  const ms = Date.now() - updatedAt;
  if (ms < 1000) {
    return "just now";
  }
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s ago`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m ago`;
  }

  return `${Math.round(ms / 3_600_000)}h ago`;
}

// ============================================================================
// Query List Panel
// ============================================================================

function QueryListPanel({ queries }: { queries: QueryEntry[] }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (queries.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
        No queries detected. Add{" "}
        <code className="mx-1 rounded bg-zinc-800 px-1 text-xs text-fuchsia-400">
          devtoolsPlugin()
        </code>{" "}
        to your system plugins.
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {queries.map((q) => {
        const statusLabel = q.isFetching ? "fetching" : q.status;
        const isSelected = selected === q.name;

        return (
          <div key={q.name}>
            <button
              type="button"
              onClick={() => setSelected(isSelected ? null : q.name)}
              className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-xs transition-colors ${
                isSelected
                  ? "bg-zinc-800"
                  : "hover:bg-zinc-800/50"
              }`}
            >
              {/* Status badge */}
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  STATUS_COLORS[statusLabel] ?? STATUS_COLORS.idle
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

              {/* Failure count */}
              {q.failureCount > 0 && (
                <span className="rounded-full bg-red-500/20 px-1.5 text-[10px] text-red-400">
                  {q.failureCount}x
                </span>
              )}
            </button>

            {/* Expanded details */}
            {isSelected && (
              <div className="ml-4 border-l border-zinc-700 py-2 pl-4 text-xs text-zinc-400">
                {q.cacheKey && (
                  <div>
                    <span className="text-zinc-500">Cache key:</span>{" "}
                    <code className="text-zinc-300">{q.cacheKey}</code>
                  </div>
                )}
                {q.error && (
                  <div className="mt-1 text-red-400">
                    Error: {q.error}
                  </div>
                )}
                {q.data !== null && q.data !== undefined && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-zinc-500 hover:text-zinc-300">
                      Data preview
                    </summary>
                    <pre className="mt-1 max-h-32 overflow-auto rounded bg-zinc-900 p-2 text-[10px] text-zinc-300">
                      {JSON.stringify(q.data, null, 2)?.slice(0, 500)}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================================
// Timeline Panel (Phase 2 placeholder)
// ============================================================================

function TimelinePanel() {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
      Causal timeline – coming soon
    </div>
  );
}

// ============================================================================
// Explain Panel (Phase 2 placeholder)
// ============================================================================

function ExplainPanel() {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-zinc-500">
      Why did it fetch? – coming soon
    </div>
  );
}

// ============================================================================
// QueryView — Main view with inner tabs
// ============================================================================

interface QueryViewProps {
  // biome-ignore lint/suspicious/noExplicitAny: DevToolsSnapshot type varies
  events: Array<any>;
  // biome-ignore lint/suspicious/noExplicitAny: DevToolsSnapshot type varies
  snapshot?: any;
}

export function QueryView({ events, snapshot }: QueryViewProps) {
  const [subTab, setSubTab] = useState<SubTab>("list");

  // Extract query entries from events/snapshot
  // Phase 1: parse _q_ prefixed facts from snapshot
  const queries: QueryEntry[] = [];

  if (snapshot) {
    const seen = new Set<string>();
    for (const key of Object.keys(snapshot)) {
      if (!key.startsWith("_q_") || !key.endsWith("_state")) {
        continue;
      }

      // Extract query name: _q_{name}_state -> name
      const name = key.slice(3, -6);
      if (seen.has(name)) {
        continue;
      }
      seen.add(name);

      const state = snapshot[key] as Record<string, unknown> | undefined;
      if (!state) {
        continue;
      }

      queries.push({
        name,
        status: (state.status as "pending" | "success" | "error" | "idle") ?? "idle",
        data: state.data ?? null,
        error: state.error instanceof Error
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

  // Also extract from events for systems without snapshots
  if (queries.length === 0 && events.length > 0) {
    const queryNames = new Set<string>();
    for (const event of events) {
      const id = (event.id ?? event.constraintId ?? event.resolverId ?? "") as string;
      if (typeof id === "string" && id.startsWith("_q_")) {
        const match = id.match(/^_q_([^_]+)_/);
        if (match) {
          queryNames.add(match[1]!);
        }
      }
    }
    for (const name of queryNames) {
      queries.push({
        name,
        status: "idle",
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

  // Sort: fetching first, then success, then pending, then error
  const statusOrder = { fetching: 0, pending: 1, success: 2, error: 3, idle: 4 };
  queries.sort(
    (a, b) =>
      (statusOrder[a.isFetching ? "fetching" : a.status] ?? 9) -
      (statusOrder[b.isFetching ? "fetching" : b.status] ?? 9),
  );

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
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={subTab === tab.id}
            onClick={() => setSubTab(tab.id)}
            className={`text-xs font-medium transition-colors ${
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

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto p-4">
        {subTab === "list" && <QueryListPanel queries={queries} />}
        {subTab === "timeline" && <TimelinePanel />}
        {subTab === "explain" && <ExplainPanel />}
      </div>
    </div>
  );
}

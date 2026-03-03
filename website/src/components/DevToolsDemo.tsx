"use client";

import { useCallback, useState } from "react";

// Pre-loaded demo session: a research pipeline with 3 agents
// Field names match real DebugEvent shape (E7)
const DEMO_EVENTS = [
  {
    id: 1,
    type: "pattern_start",
    agentId: null,
    label: "pipeline",
    timestamp: 0,
    durationMs: 5200,
  },
  {
    id: 2,
    type: "agent_start",
    agentId: "researcher",
    label: "Start",
    timestamp: 50,
    durationMs: 0,
  },
  {
    id: 3,
    type: "guardrail_check",
    agentId: "researcher",
    label: "PII check (pass)",
    timestamp: 80,
    durationMs: 30,
  },
  {
    id: 4,
    type: "agent_complete",
    agentId: "researcher",
    label: "150 tokens",
    timestamp: 1800,
    durationMs: 1750,
  },
  {
    id: 5,
    type: "agent_start",
    agentId: "writer",
    label: "Start",
    timestamp: 1850,
    durationMs: 0,
  },
  {
    id: 6,
    type: "guardrail_check",
    agentId: "writer",
    label: "PII check (pass)",
    timestamp: 1870,
    durationMs: 20,
  },
  {
    id: 7,
    type: "agent_complete",
    agentId: "writer",
    label: "320 tokens",
    timestamp: 3900,
    durationMs: 2050,
  },
  {
    id: 8,
    type: "agent_start",
    agentId: "reviewer",
    label: "Start",
    timestamp: 3950,
    durationMs: 0,
  },
  {
    id: 9,
    type: "agent_complete",
    agentId: "reviewer",
    label: "80 tokens",
    timestamp: 5100,
    durationMs: 1150,
  },
  {
    id: 10,
    type: "pattern_complete",
    agentId: null,
    label: "pipeline (5.2s)",
    timestamp: 5200,
    durationMs: 0,
  },
] as const;

const AGENTS = ["researcher", "writer", "reviewer"] as const;

const VIEWS = ["Timeline", "Cost", "State"] as const;
const DISABLED_VIEWS = ["Graph", "Goal", "Breakpoints"] as const;

const EVENT_COLORS: Record<string, string> = {
  agent_start: "bg-sky-500",
  agent_complete: "bg-emerald-500",
  agent_error: "bg-red-500",
  guardrail_check: "bg-amber-500",
  pattern_start: "bg-violet-500",
  pattern_complete: "bg-violet-500",
};

function TimelineView() {
  const totalMs = 5500;
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="space-y-3">
      {/* Agent lanes */}
      {AGENTS.map((agentId) => {
        const events = DEMO_EVENTS.filter((e) => e.agentId === agentId);

        // Build runtime spans by pairing agent_start → agent_complete
        const runtimeSpans: {
          startTs: number;
          endTs: number;
          durationMs: number;
        }[] = [];
        const starts: number[] = [];
        for (const e of events) {
          if (e.type === "agent_start") {
            starts.push(e.timestamp);
          } else if (e.type === "agent_complete" && starts.length > 0) {
            const startTs = starts.shift()!;
            runtimeSpans.push({
              startTs,
              endTs: e.timestamp,
              durationMs: e.timestamp - startTs,
            });
          }
        }

        return (
          <div key={agentId} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500 text-right">
              {agentId}
            </span>
            <div className="relative h-7 flex-1 rounded bg-zinc-100 dark:bg-zinc-800/50">
              {/* Runtime span bars (background) */}
              {runtimeSpans.map((span, i) => {
                const left = (span.startTs / totalMs) * 100;
                const width = (span.durationMs / totalMs) * 100;

                return (
                  <div
                    key={`span-${i}`}
                    className="pointer-events-none absolute top-1 h-5 rounded-sm bg-emerald-500/15 dark:bg-emerald-400/10"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.5)}%`,
                      minWidth: "4px",
                    }}
                  />
                );
              })}

              {/* Event markers (foreground, z-10) — all thin markers */}
              {events.map((e) => {
                const left = (e.timestamp / totalMs) * 100;

                return (
                  <button
                    key={e.id}
                    className={`absolute top-1 z-10 h-5 rounded-sm ${EVENT_COLORS[e.type] ?? "bg-zinc-400"} opacity-80 hover:opacity-100 transition-opacity cursor-pointer`}
                    style={{ left: `${left}%`, width: "6px" }}
                    onClick={() => setSelected(e.id === selected ? null : e.id)}
                    aria-label={`${e.type}: ${e.agentId ?? "system"}${e.durationMs ? `, ${e.durationMs}ms` : ""}`}
                  />
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Pattern bar */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0 text-xs font-mono text-zinc-400 dark:text-zinc-500 text-right">
          pattern
        </span>
        <div className="relative h-7 flex-1 rounded bg-zinc-100 dark:bg-zinc-800/50">
          <div
            className="absolute top-1 h-5 rounded-sm bg-violet-500/30 border border-violet-500/50"
            style={{ left: "0%", width: `${(5200 / totalMs) * 100}%` }}
          />
        </div>
      </div>

      {/* Time axis */}
      <div className="flex items-center gap-3">
        <span className="w-20 shrink-0" />
        <div className="flex-1 flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
          <span>0s</span>
          <span>1s</span>
          <span>2s</span>
          <span>3s</span>
          <span>4s</span>
          <span>5s</span>
        </div>
      </div>

      {/* Selected event detail */}
      {selected && (
        <div className="mt-2 rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 p-3 text-xs font-mono">
          {(() => {
            const e = DEMO_EVENTS.find((ev) => ev.id === selected);
            if (!e) {
              return null;
            }

            return (
              <div className="space-y-1">
                <div>
                  <span className="text-zinc-500">type:</span> {e.type}
                </div>
                {e.agentId && (
                  <div>
                    <span className="text-zinc-500">agentId:</span> {e.agentId}
                  </div>
                )}
                <div>
                  <span className="text-zinc-500">detail:</span> {e.label}
                </div>
                <div>
                  <span className="text-zinc-500">timestamp:</span>{" "}
                  {e.timestamp}ms
                </div>
                {e.durationMs > 0 && (
                  <div>
                    <span className="text-zinc-500">durationMs:</span>{" "}
                    {e.durationMs}ms
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

function CostView() {
  const costs = [
    { agentId: "researcher", runs: 1, tokens: 150, pct: 27 },
    { agentId: "writer", runs: 1, tokens: 320, pct: 58 },
    { agentId: "reviewer", runs: 1, tokens: 80, pct: 15 },
  ];
  const total = 550;
  const barSummary = costs.map((c) => `${c.agentId}: ${c.pct}%`).join(", ");

  return (
    <div className="space-y-4">
      <div className="flex gap-6 text-xs">
        <div>
          <span className="text-zinc-500 dark:text-zinc-400">Total tokens</span>
          <div className="text-lg font-semibold text-zinc-900 dark:text-white">
            {total}
          </div>
        </div>
      </div>

      {/* Stacked bar */}
      <div
        className="flex h-6 rounded overflow-hidden"
        role="img"
        aria-label={`Token distribution: ${barSummary}`}
      >
        <div
          className="bg-sky-500"
          style={{ width: "27%" }}
          aria-hidden="true"
        />
        <div
          className="bg-emerald-500"
          style={{ width: "58%" }}
          aria-hidden="true"
        />
        <div
          className="bg-amber-500"
          style={{ width: "15%" }}
          aria-hidden="true"
        />
      </div>

      {/* Table */}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-zinc-500 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-700">
            <th className="text-left py-1 font-medium">Agent</th>
            <th className="text-right py-1 font-medium">Runs</th>
            <th className="text-right py-1 font-medium">Tokens</th>
            <th className="text-right py-1 font-medium">%</th>
          </tr>
        </thead>
        <tbody className="text-zinc-700 dark:text-zinc-300">
          {costs.map((c) => (
            <tr
              key={c.agentId}
              className="border-b border-zinc-100 dark:border-zinc-800"
            >
              <td className="py-1.5 font-mono">{c.agentId}</td>
              <td className="py-1.5 text-right">{c.runs}</td>
              <td className="py-1.5 text-right">{c.tokens}</td>
              <td className="py-1.5 text-right">{c.pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StateView() {
  const scratchpad = {
    taskList: "['research', 'write', 'review']",
    completedCount: "3",
    lastUpdate: "'review phase done'",
  };
  const derived = {
    totalTokens: "550",
    allIdle: "true",
    progress: "'3/3 agents done'",
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Scratchpad
        </h4>
        <div className="space-y-1">
          {Object.entries(scratchpad).map(([key, value]) => (
            <div key={key} className="flex text-xs font-mono">
              <span className="text-sky-600 dark:text-sky-400 w-32 shrink-0">
                {key}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
          Derived
        </h4>
        <div className="space-y-1">
          {Object.entries(derived).map(([key, value]) => (
            <div key={key} className="flex text-xs font-mono">
              <span className="text-violet-600 dark:text-violet-400 w-32 shrink-0">
                {key}
              </span>
              <span className="text-zinc-700 dark:text-zinc-300">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DevToolsDemo() {
  const [view, setView] = useState<(typeof VIEWS)[number]>("Timeline");

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const allTabs = [...VIEWS];
      const idx = allTabs.indexOf(view);
      let next = idx;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % allTabs.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + allTabs.length) % allTabs.length;
      } else {
        return;
      }

      e.preventDefault();
      setView(allTabs[next]);
    },
    [view],
  );

  return (
    <div className="not-prose my-8 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-700 px-4 py-2 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div
              className="h-3 w-3 rounded-full bg-red-400"
              aria-hidden="true"
            />
            <div
              className="h-3 w-3 rounded-full bg-amber-400"
              aria-hidden="true"
            />
            <div
              className="h-3 w-3 rounded-full bg-emerald-400"
              aria-hidden="true"
            />
          </div>
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300 ml-2">
            Directive DevTools
          </span>
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
          ws://localhost:4040
        </span>
      </div>

      {/* View tabs — ARIA tab pattern (M8) */}
      <div
        className="flex border-b border-zinc-200 dark:border-zinc-700 px-4 gap-0"
        role="tablist"
        aria-label="DevTools views"
      >
        {VIEWS.map((v) => (
          <button
            key={v}
            role="tab"
            aria-selected={v === view}
            aria-controls={`demo-tabpanel-${v.toLowerCase()}`}
            tabIndex={v === view ? 0 : -1}
            onKeyDown={handleTabKeyDown}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              v === view
                ? "border-sky-500 text-sky-600 dark:text-sky-400"
                : "border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
            }`}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
        {/* Disabled tabs — aria-disabled + title */}
        {DISABLED_VIEWS.map((v) => (
          <span
            key={v}
            role="tab"
            aria-disabled="true"
            aria-selected={false}
            tabIndex={-1}
            title="Coming soon"
            className="px-3 py-2 text-xs font-medium text-zinc-300 dark:text-zinc-600 cursor-not-allowed"
          >
            {v}
          </span>
        ))}
      </div>

      {/* Content */}
      <div
        className="p-4 min-h-[200px]"
        role="tabpanel"
        id={`demo-tabpanel-${view.toLowerCase()}`}
        aria-label={`${view} view`}
      >
        {view === "Timeline" && <TimelineView />}
        {view === "Cost" && <CostView />}
        {view === "State" && <StateView />}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between border-t border-zinc-200 dark:border-zinc-700 px-4 py-1.5 bg-zinc-50 dark:bg-zinc-800/50 text-[10px] text-zinc-400 dark:text-zinc-500 font-mono">
        <span>10 events | 550 tokens | 5.2s</span>
        <span>Demo session (pre-loaded)</span>
      </div>
    </div>
  );
}
